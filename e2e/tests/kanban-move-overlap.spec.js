const { test, expect } = require('@playwright/test');

const projectPath = (baseURL) => `${baseURL}/projects/kanban-native`;
const subjectPrefix = 'Kanban E2E move overlap ';

async function login(page, baseURL) {
  await page.goto(`${baseURL}/login`);
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill(process.env.REDMINE_PASSWORD || 'admin1234');
  await page.getByRole('button', { name: /login|sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}

async function openIssueAndReturnPosition(page, issueId, columnIndex) {
  const canvas = page.locator('canvas.rk-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Kanban canvas has no layout box');
  const xs = [25, 55, 100, 150, 200, 230].map((x) => Math.min(box.width - 10, columnIndex * 260 + x));
  const ys = Array.from({ length: 12 }, (_, index) => Math.min(box.height - 10, 65 + index * 42));
  for (const y of ys) {
    for (const x of xs) {
      await canvas.click({ position: { x, y } });
      const frame = page.locator('iframe.rk-iframe-dialog-frame');
      if (!(await frame.count())) continue;
      const src = await frame.getAttribute('src');
      if (src?.includes(`/issues/${issueId}`)) {
        await page.locator('.rk-iframe-dialog-container .rk-issue-dialog-close').click();
        await expect(frame).toHaveCount(0);
        // Use the tracker-color strip for the drag, outside the subject's
        // click action. The click above only identifies the card's row.
        return { x: columnIndex * 260 + 14, y };
      }
      await page.locator('.rk-iframe-dialog-container .rk-issue-dialog-close').click();
      await expect(frame).toHaveCount(0);
    }
  }
  throw new Error(`Could not locate issue ${issueId} on the canvas`);
}

async function dragStatus(page, issuePosition, canvasBox, targetColumnIndex) {
  const targetX = canvasBox.x + targetColumnIndex * 260 + 240;
  const targetY = canvasBox.y + issuePosition.y;
  await page.mouse.move(canvasBox.x + issuePosition.x, canvasBox.y + issuePosition.y);
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 20 });
  await page.mouse.up();
}

test('overlapping filtered moves reconcile once after both server responses settle', async ({ page, baseURL }) => {
  const root = baseURL || process.env.REDMINE_BASE_URL || 'http://127.0.0.1:3002';
  const project = projectPath(root);
  await login(page, root);

  const initialResponse = await page.request.get(`${project}/kanban/data?board_entity_limit=5000`);
  expect(initialResponse.ok()).toBeTruthy();
  const initial = await initialResponse.json();
  const userId = initial.meta.current_user_id;
  const trackerId = initial.lists.trackers[0]?.id;
  const sourceStatusId = initial.columns.find((column) => !column.is_closed)?.id ?? initial.columns[0]?.id;
  const sourceAssignee = initial.lists.assignees.find((assignee) => assignee.id == null);
  const priority = initial.lists.priorities[0];
  expect(trackerId).toBeTruthy();
  expect(sourceStatusId).toBeTruthy();
  expect(sourceAssignee).toBeTruthy();
  expect(priority).toBeTruthy();

  const subject = `${subjectPrefix}${Date.now()}`;
  const filterText = subject.toLowerCase();
  const csrfToken = await page.locator('meta[name="csrf-token"]').getAttribute('content');
  const createdIssues = [];
  const cleanupVersions = new Map();
  let releaseFirstResponse;
  let resolveFirstServerSaved;
  let firstServerSaved;
  let moveOneReached;
  let moveTwoReached;
  let pageSnapshotRequests = 0;
  let pageMetadataRequests = 0;
  let routeInstalled = false;

  try {
    for (const suffix of [' first', ' second']) {
      const response = await page.request.post(`${project}/kanban/issues`, {
        headers: { 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' },
        data: { issue: { subject: `${subject}${suffix}`, tracker_id: trackerId, status_id: sourceStatusId,
          assigned_to_id: sourceAssignee.id, priority_id: priority.id } },
      });
      expect(response.ok()).toBeTruthy();
      const payload = await response.json();
      const created = payload.issue ?? payload.created_issues?.[0];
      expect(created).toBeTruthy();
      createdIssues.push(created);
      cleanupVersions.set(created.id, created.lock_version);
    }

    await page.evaluate(({ userId, filterText }) => {
      localStorage.clear();
      localStorage.setItem(`rk_filters:/projects/kanban-native/kanban:user:${userId}`, JSON.stringify({
        assigneeIds: [], q: filterText, due: 'all', dueDays: 7, priority: [],
        priorityFilterEnabled: false, projectIds: [], statusIds: [], trackerIds: [],
      }));
      localStorage.setItem(`rk_lane_type:/projects/kanban-native/kanban:user:${userId}`, 'none');
      localStorage.setItem(`rk_card_display_mode:user:${userId}`, 'single_line');
    }, { userId, filterText });

    page.on('request', (request) => {
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.pathname.endsWith('/kanban/data')) pageSnapshotRequests += 1;
      if (request.method() === 'GET' && url.pathname.endsWith('/kanban/metadata')) pageMetadataRequests += 1;
    });
    const filteredSnapshot = page.waitForResponse((response) => (
      response.url().includes('/kanban/data?') && response.request().method() === 'GET' &&
      new URL(response.url()).searchParams.get('filter_q') === filterText
    ));
    await page.goto(`${project}/kanban`);
    const snapshotResponse = await filteredSnapshot;
    expect(snapshotResponse.ok()).toBeTruthy();
    const snapshot = await snapshotResponse.json();
    expect(snapshot.entities.map((issue) => issue.id)).toEqual(expect.arrayContaining(createdIssues.map((issue) => issue.id)));
    expect(new URL(snapshotResponse.url()).searchParams.get('filter_q')).toBe(filterText);
    await expect(page.locator('.rk-canvas-board')).toBeVisible();

    const canvas = page.locator('canvas.rk-canvas');
    const canvasHandle = await canvas.elementHandle();
    const toolbar = page.locator('.rk-toolbar');
    const toolbarHandle = await toolbar.elementHandle();
    const filterButton = page.locator('.rk-toolbar button[aria-haspopup="dialog"]').first();
    const filterButtonHandle = await filterButton.elementHandle();
    const filterButtonBox = await filterButton.boundingBox();
    expect(canvasHandle).toBeTruthy();
    expect(toolbarHandle).toBeTruthy();
    expect(filterButtonHandle).toBeTruthy();
    expect(pageSnapshotRequests).toBe(1);
    expect(pageMetadataRequests).toBe(1);

    const sourceColumnIndex = snapshot.columns.findIndex((column) => column.id === sourceStatusId);
    const firstIssue = snapshot.entities.find((issue) => issue.id === createdIssues[0].id);
    const secondIssue = snapshot.entities.find((issue) => issue.id === createdIssues[1].id);
    expect(firstIssue).toBeTruthy();
    expect(secondIssue).toBeTruthy();
    const targetStatusId = firstIssue.allowed_status_ids
      .filter((id) => id !== sourceStatusId && snapshot.columns.some((column) => column.id === id))
      .sort((left, right) => Math.abs(snapshot.columns.findIndex((column) => column.id === left) - sourceColumnIndex)
        - Math.abs(snapshot.columns.findIndex((column) => column.id === right) - sourceColumnIndex))[0];
    expect(targetStatusId).toBeTruthy();
    expect(secondIssue.allowed_status_ids).toContain(targetStatusId);
    const targetColumnIndex = snapshot.columns.findIndex((column) => column.id === targetStatusId);
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('Kanban canvas has no layout box');
    const firstPosition = await openIssueAndReturnPosition(page, firstIssue.id, sourceColumnIndex);

    let releaseResponse;
    const responseGate = new Promise((resolve) => { releaseResponse = resolve; });
    const serverSaved = new Promise((resolve) => { resolveFirstServerSaved = resolve; });
    firstServerSaved = serverSaved;
    await page.route(`**/kanban/issues/${firstIssue.id}/move**`, async (route) => {
      const response = await route.fetch();
      resolveFirstServerSaved(response);
      await responseGate;
      await route.fulfill({ response });
    });
    routeInstalled = true;
    releaseFirstResponse = releaseResponse;

    moveOneReached = page.waitForResponse((response) => (
      response.url().includes(`/kanban/issues/${firstIssue.id}/move`) && response.request().method() === 'PATCH'
    ));
    await dragStatus(page, firstPosition, canvasBox, targetColumnIndex);
    const firstSavedResponse = await firstServerSaved;
    expect(firstSavedResponse.ok()).toBeTruthy();

    // The first server write has completed while its client response remains gated.
    await expect(page.locator('.rk-board')).toHaveAttribute('aria-busy', 'false');
    const secondPosition = await openIssueAndReturnPosition(page, secondIssue.id, sourceColumnIndex);
    const currentCanvasBox = await canvas.boundingBox();
    if (!currentCanvasBox) throw new Error('Kanban canvas has no layout box');
    moveTwoReached = page.waitForResponse((response) => (
      response.url().includes(`/kanban/issues/${secondIssue.id}/move`) && response.request().method() === 'PATCH'
    ));
    await dragStatus(page, secondPosition, currentCanvasBox, targetColumnIndex);
    const secondResponse = await moveTwoReached;
    expect(secondResponse.ok()).toBeTruthy();
    const secondResult = await secondResponse.json();
    cleanupVersions.set(secondIssue.id, secondResult.issue?.lock_version
      ?? secondResult.issue_updates?.find((entry) => entry.id === secondIssue.id)?.lock_version
      ?? cleanupVersions.get(secondIssue.id));

    await expect(page.locator('.rk-board')).toHaveAttribute('aria-busy', 'false');
    expect(pageSnapshotRequests).toBe(1);
    expect(await canvas.evaluate((element, original) => element === original, canvasHandle)).toBe(true);
    expect(await toolbar.evaluate((element, original) => element === original, toolbarHandle)).toBe(true);
    expect(await filterButton.evaluate((element, original) => element === original, filterButtonHandle)).toBe(true);
    expect(await filterButton.boundingBox()).toEqual(filterButtonBox);

    releaseFirstResponse();
    releaseFirstResponse = null;
    const firstResponse = await moveOneReached;
    expect(firstResponse.ok()).toBeTruthy();
    const firstResult = await firstResponse.json();
    cleanupVersions.set(firstIssue.id, firstResult.issue?.lock_version
      ?? firstResult.issue_updates?.find((entry) => entry.id === firstIssue.id)?.lock_version
      ?? cleanupVersions.get(firstIssue.id));

    await expect(page.locator('.rk-board')).toHaveAttribute('aria-busy', 'false');
    await expect.poll(() => pageSnapshotRequests).toBe(2);
    expect(await canvas.evaluate((element, original) => element === original, canvasHandle)).toBe(true);
    expect(await toolbar.evaluate((element, original) => element === original, toolbarHandle)).toBe(true);
    expect(await filterButton.evaluate((element, original) => element === original, filterButtonHandle)).toBe(true);
    expect(await filterButton.boundingBox()).toEqual(filterButtonBox);
    expect(pageMetadataRequests).toBe(1);

    const finalResponse = await page.request.get(
      `${project}/kanban/data?board_entity_limit=5000&filter_q=${encodeURIComponent(filterText)}`,
    );
    expect(finalResponse.ok()).toBeTruthy();
    const finalSnapshot = await finalResponse.json();
    for (const created of createdIssues) {
      const issue = finalSnapshot.entities.find((candidate) => candidate.id === created.id);
      expect(issue).toMatchObject({ id: created.id, status_id: targetStatusId, assigned_to_id: sourceAssignee.id });
      expect(issue.lock_version).toBeGreaterThan(created.lock_version);
    }
    expect(finalSnapshot.meta.complete).toBe(true);
    await expect(filterButton).toBeVisible();
    await filterButton.click();
    await expect(page.locator('.rk-search-box input')).toHaveValue(filterText);
    await filterButton.click();
  } finally {
    if (releaseFirstResponse) releaseFirstResponse();
    if (routeInstalled) await page.unroute(`**/kanban/issues/${createdIssues[0]?.id}/move**`).catch(() => {});
    if (createdIssues.length) {
      const latestResponse = await page.request.get(
        `${project}/kanban/data?board_entity_limit=5000&filter_q=${encodeURIComponent(filterText)}`,
        { timeout: 10_000 },
      ).catch(() => null);
      if (latestResponse?.ok()) {
        const latest = await latestResponse.json();
        for (const created of createdIssues) {
          const issue = latest.entities.find((candidate) => candidate.id === created.id);
          if (issue) cleanupVersions.set(created.id, issue.lock_version);
        }
      }
      for (const created of createdIssues) {
        const lockVersion = cleanupVersions.get(created.id);
        if (lockVersion === undefined || lockVersion === null) continue;
        await page.request.delete(`${project}/kanban/issues/${created.id}`, {
          headers: { 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' },
          data: { issue: { lock_version: lockVersion } },
          timeout: 10_000,
        }).catch(() => {});
      }
    }
  }
});
