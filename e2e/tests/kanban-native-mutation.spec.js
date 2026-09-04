const { test, expect } = require('@playwright/test');

test.describe.configure({ mode: 'serial' });

function nativeProjectIdentifier() {
  return process.env.REDMINE_KANBAN_NATIVE_PROJECT || 'kanban-native';
}

function nativeProjectPath(baseURL) {
  return `${baseURL}/projects/${nativeProjectIdentifier()}`;
}

async function adminLogin(page, baseURL) {
  await page.goto(`${baseURL}/login`);
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill(process.env.REDMINE_PASSWORD || 'admin1234');
  await page.getByRole('button', { name: /login|sign in/i }).click();
  await page.waitForURL(url => !url.pathname.endsWith('/login'));
}

async function boardSnapshot(page, baseURL, limit = 5000) {
  const response = await page.request.get(
    `${nativeProjectPath(baseURL)}/kanban/data?board_entity_limit=${limit}`,
  );
  return { response, payload: await response.json() };
}

async function closeIssueDialog(page) {
  const closeButton = page.locator('.rk-iframe-dialog-container .rk-issue-dialog-close');
  if (await closeButton.count()) {
    await closeButton.click();
    await expect(page.locator('iframe.rk-iframe-dialog-frame')).toHaveCount(0);
  }
}

async function openIssueView(page, issueId) {
  const canvas = page.locator('canvas.rk-canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Kanban canvas has no layout box');

  const xCandidates = [230, 330, 480, 650, 820].map((x) => Math.max(10, Math.min(box.width - 10, x)));
  const yCandidates = [65, 90, 120, 155, 195].map((y) => Math.max(45, Math.min(box.height - 10, y)));

  for (const y of yCandidates) {
    for (const x of xCandidates) {
      await canvas.click({ position: { x, y } });
      const frame = page.locator('iframe.rk-iframe-dialog-frame');
      if (!(await frame.count())) continue;

      const src = await frame.getAttribute('src');
      if (src && src.includes(`/issues/${issueId}`)) {
        await expect(page.locator('[data-testid="issue-dialog-footer"] .rk-btn-primary'))
          .toHaveText(/edit issue|編集/i);
        return frame;
      }
      await closeIssueDialog(page);
    }
  }

  throw new Error(`Could not open issue ${issueId} from the canvas`);
}

async function removeIssuesWithSubjectPrefix(page, baseURL, prefix) {
  const { payload } = await boardSnapshot(page, baseURL);
  const issueIds = (payload.entities || [])
    .filter((issue) => issue.subject.startsWith(prefix))
    .map((issue) => ({ id: issue.id, lockVersion: issue.lock_version }));
  if (issueIds.length === 0) return;

  await page.evaluate(async ({ baseURL: root, issueIds: ids, projectIdentifier }) => {
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
    for (const issue of ids) {
      const response = await fetch(`${root}/projects/${projectIdentifier}/kanban/issues/${issue.id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ issue: { lock_version: issue.lockVersion } }),
      });
      if (!response.ok) throw new Error(`Fixture cleanup failed: ${response.status}`);
    }
  }, { baseURL, issueIds, projectIdentifier: nativeProjectIdentifier() });
}

test('native iframe edit converges to one authoritative complete snapshot', async ({ page, baseURL }) => {
  const redmineBase = baseURL || 'http://127.0.0.1:3002';
  const projectPath = nativeProjectPath(redmineBase);
  await adminLogin(page, redmineBase);
  await page.goto(`${projectPath}/kanban`);
  await expect(page.locator('.rk-canvas-board')).toBeVisible();

  const { payload: initial } = await boardSnapshot(page, redmineBase);
  const parent = initial.entities.find((issue) => issue.subject === 'Kanban E2E parent issue');
  expect(parent).toBeTruthy();

  const frame = await openIssueView(page, parent.id);
  await expect(frame).toHaveAttribute('src', expect.stringContaining(`/issues/${parent.id}`));
  await page.locator('[data-testid="issue-dialog-footer"] .rk-btn-primary').click();

  await expect.poll(() => page.frames().some((candidate) => candidate.url().includes(`/issues/${parent.id}/edit`))).toBeTruthy();
  const issueForm = page.frameLocator('iframe.rk-iframe-dialog-frame');
  const statusSelect = issueForm.locator('#issue_status_id');
  await expect(statusSelect).toBeAttached();
  const targetStatusId = await statusSelect.locator('option').evaluateAll((options) => {
    const current = Number(options.find((option) => option.selected)?.value);
    return Number(options.find((option) => Number(option.value) > 0 && Number(option.value) !== current)?.value || current);
  });
  await statusSelect.selectOption(String(targetStatusId));

  const boardResponses = [];
  const onResponse = (response) => {
    if (response.url().includes(`${projectPath}/kanban/data`) && response.request().method() === 'GET') {
      boardResponses.push(response);
    }
  };
  page.on('response', onResponse);
  try {
    const boardReload = page.waitForResponse((response) => (
      response.url().includes(`${projectPath}/kanban/data`) && response.request().method() === 'GET'
    ));
    await page.locator('[data-testid="issue-dialog-footer"] .rk-btn-primary').click();
    const reloadResponse = await boardReload;
    expect(reloadResponse.status()).toBe(200);
    await expect(page.locator('.rk-canvas-board')).toBeVisible();
  } finally {
    page.off('response', onResponse);
  }

  expect(boardResponses.length).toBeLessThanOrEqual(1);
  const { response, payload: authoritative } = await boardSnapshot(page, redmineBase);
  expect(response.ok()).toBeTruthy();
  const updated = authoritative.entities.find((issue) => issue.id === parent.id);
  expect(updated).toMatchObject({ id: parent.id, status_id: targetStatusId });
  expect(authoritative.meta.complete).toBe(true);
  expect(new Set(authoritative.entities.map((issue) => issue.id)).size).toBe(authoritative.entities.length);
});

test('native create at the admission limit leaves the board without a stale complete snapshot', async ({ page, baseURL }) => {
  const redmineBase = baseURL || 'http://127.0.0.1:3002';
  const projectPath = nativeProjectPath(redmineBase);
  const subjectPrefix = 'Kanban E2E native create ';
  await adminLogin(page, redmineBase);
  await removeIssuesWithSubjectPrefix(page, redmineBase, subjectPrefix);
  await removeIssuesWithSubjectPrefix(page, redmineBase, 'Time Entry operation E2E ');
  await page.goto(`${projectPath}/kanban`);
  await expect(page.locator('.rk-canvas-board')).toBeVisible();

  const { payload: initial } = await boardSnapshot(page, redmineBase);
  expect(initial.entities.length).toBe(2);

  const settingsTrigger = page.locator('[role="button"][title="Display settings"]');
  await settingsTrigger.click();
  const settings = page.getByRole('dialog', { name: /display settings/i });
  await settings.locator('input[type="text"]').fill('2');
  const settingsReload = page.waitForResponse((response) => (
    response.url().includes(`${projectPath}/kanban/data`) && response.request().method() === 'GET'
  ));
  await settings.getByRole('button', { name: /^save$/i }).click();
  expect((await settingsReload).status()).toBe(200);
  await expect(page.locator('.rk-canvas-board')).toBeVisible();
  await settingsTrigger.click();
  await expect(settings).toHaveCount(0);

  await page.locator('.rk-toolbar .rk-dropdown-trigger[role="button"]').first().click();
  await expect(page.locator('iframe.rk-iframe-dialog-frame')).toBeVisible();
  const issueForm = page.frameLocator('iframe.rk-iframe-dialog-frame');
  await expect(issueForm.locator('#issue_subject')).toBeVisible();
  const subject = `${subjectPrefix}${Date.now()}`;
  await issueForm.locator('#issue_subject').fill(subject);

  const overflowResponsePromise = page.waitForResponse((response) => (
    response.url().includes(`${projectPath}/kanban/data`) && response.request().method() === 'GET'
  ));
  await page.locator('[data-testid="issue-dialog-footer"] .rk-btn-primary').click();
  const overflowResponse = await overflowResponsePromise;
  expect(overflowResponse.status()).toBe(422);
  const overflowPayload = await overflowResponse.json();
  expect(overflowPayload.error.code).toBe('BOARD_SCOPE_TOO_LARGE');
  await expect(page.locator('.rk-canvas-board')).toHaveCount(0);
  await expect(page.getByText(/maximum display count|最大表示件数/i)).toBeVisible();

  const { payload: persisted } = await boardSnapshot(page, redmineBase);
  const created = persisted.entities.find((issue) => issue.subject === subject);
  expect(created).toBeTruthy();
  await removeIssuesWithSubjectPrefix(page, redmineBase, subjectPrefix);
});


test('timeEntryOnClose saves the target issue through the shared native dialog', async ({ page, baseURL }) => {
  const root = baseURL || 'http://127.0.0.1:3002';
  await adminLogin(page, root);
  await page.goto(`${nativeProjectPath(root)}/kanban`);
  const { payload } = await boardSnapshot(page, root);
  const open = payload.columns.find(column => !column.is_closed);
  const created = await page.evaluate(async ({ endpoint, trackerId, statusId }) => {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content }, body: JSON.stringify({ issue: { subject: `Time Entry operation E2E ${Date.now()}`, tracker_id: trackerId, status_id: statusId } }) });
    return response.json();
  }, { endpoint: `${nativeProjectPath(root)}/kanban/issues`, trackerId: payload.lists.trackers[0].id, statusId: open.id });
  const issue = created.issue ?? created.created_issues?.[0];
  expect(issue).toBeTruthy();
  try {
    const closed = payload.columns.find(column => column.is_closed && issue.allowed_status_ids.includes(column.id));
    expect(closed).toBeTruthy();
    await page.evaluate(({ userId, path }) => { localStorage.setItem(`rk_time_entry_on_close:user:${userId}`, '1'); localStorage.setItem(`rk_lane_type:${path}:user:${userId}`, 'none'); }, { userId: payload.meta.current_user_id, path: `${nativeProjectPath(root)}/kanban`.replace(root, '') });
    // Keep the real mutation and native Redmine form, with a small deterministic board viewport.
    await page.route('**/kanban/data?*', async route => {
      const response = await route.fetch();
      const board = await response.json();
      const target = board.entities.find(candidate => candidate.id === issue.id);
      await route.fulfill({ response, json: { ...board, entities: [target], issues: [],
        tree: { root_ids: [issue.id], children_by_parent_id: {} },
        columns: [open, closed], lanes: [], meta: { ...board.meta, lane_type: 'none', entity_count: 1 } } });
    });
    await page.reload();
    await expect(page.locator('.rk-canvas-board')).toBeVisible();
    const canvas = page.locator('canvas.rk-canvas');
    const box = await canvas.boundingBox();
    const move = page.waitForResponse(response => response.url().includes(`/issues/${issue.id}/move`) && response.request().method() === 'PATCH');
    await page.mouse.move(box.x + 18, box.y + 80);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 80, { steps: 20 });
    await page.mouse.up();
    expect((await move).ok()).toBeTruthy();
    const iframe = page.locator('iframe.rk-iframe-dialog-frame');
    await expect(iframe).toBeVisible();
    const form = page.frameLocator('iframe.rk-iframe-dialog-frame');
    await form.locator('#time_entry_hours').fill('0.02');
    await form.locator('#time_entry_activity_id').selectOption({ index: 1 });
    const saved = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/time_entries'));
    await page.locator('[data-testid="issue-dialog-footer"] .rk-btn-primary').click();
    expect((await saved).status()).toBe(302);
    await expect(iframe).toHaveCount(0);
  } finally {
    await removeIssuesWithSubjectPrefix(page, root, issue.subject);
  }
});
