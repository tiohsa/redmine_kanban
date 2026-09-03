const { test, expect } = require('@playwright/test');

async function adminLogin(page, baseURL) {
  await page.goto(`${baseURL}/login`);
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill(process.env.REDMINE_PASSWORD || 'admin1234');
  await page.getByRole('button', { name: /login|sign in/i }).click();
}

async function prepareBoard(page, redmineBase) {
  const boardUrl = `${redmineBase}/projects/ecookbook/kanban`;
  await page.goto(boardUrl);
  await expect(page.locator('.rk-canvas-board')).toBeVisible();
  const snapshot = await page.request.get(`${boardUrl}/data?board_entity_limit=5000`);
  expect(snapshot.ok()).toBeTruthy();
  const data = await snapshot.json();
  const issue = data.entities.find((candidate) => candidate.can_log_time);
  expect(issue).toBeTruthy();
  const instanceKey = new URL(redmineBase).origin + new URL(redmineBase).pathname.replace(/\/$/, '');
  return { boardUrl, data, issue, instanceKey, sessionKey: `redmine_canvas_gantt_timer_session:${encodeURIComponent(instanceKey)}:user:${data.meta.current_user_id}` };
}

async function seedSession(page, key, issue, userId, state = 'running') {
  const now = Date.now();
  await page.evaluate(({ sessionKey, targetIssue, currentUserId, timestamp, sessionState }) => {
    localStorage.setItem(sessionKey, JSON.stringify({
      version: 4,
      sessionId: `worktime-e2e-${timestamp}`,
      revision: 1,
      issueId: targetIssue.id,
      subject: targetIssue.subject,
      autoStop: false,
      deadlineAt: timestamp + 30 * 60_000,
      state: sessionState,
      segments: [{ startedAt: timestamp - 8_000, ...(sessionState === 'stopped_pending_record' ? { stoppedAt: timestamp } : {}) }],
      userId: currentUserId,
      createdAt: timestamp - 8_000,
      updatedAt: timestamp,
    }));
  }, { sessionKey: key, targetIssue: issue, currentUserId: userId, timestamp: now, sessionState: state });
}

test('Worktime running and pending surfaces keep the complete operation flow', async ({ page, baseURL }) => {
  const redmineBase = baseURL || 'http://127.0.0.1:3002';
  await adminLogin(page, redmineBase);
  const { boardUrl, data, issue, sessionKey } = await prepareBoard(page, redmineBase);
  await seedSession(page, sessionKey, issue, data.meta.current_user_id);
  await page.reload();

  const timer = page.getByTestId('global-timer');
  await expect(timer).toHaveAttribute('data-state', 'running');
  await expect(timer).toHaveClass(/rk-work-timer-running/);
  await expect(page.getByTestId('global-timer-remaining')).toBeVisible();
  await expect(page.getByTestId('global-timer-elapsed')).toBeVisible();
  await page.getByTestId('global-timer-quick-extend').click();
  await page.getByTestId('global-timer-extend-menu-toggle').click();
  await page.getByRole('menuitem', { name: /30/ }).click();
  await page.getByTestId('global-timer-stop-button').click();
  await expect(page.locator('iframe.rk-iframe-dialog-frame')).toBeVisible();
  await page.getByTestId('issue-dialog-footer').locator('button').first().click();

  await expect(timer).toHaveAttribute('data-state', 'stopped_pending_record');
  await expect(timer).toHaveClass(/rk-work-timer-pending/);
  await expect(page.getByTestId('global-timer-record-button')).toBeVisible();
  await page.getByTestId('global-timer-manage-button').click();
  await expect(page.getByTestId('pending-work-modal')).toBeVisible();
  await expect(page.getByTestId('pending-work-resume-button-15')).toBeVisible();

  await page.goto(boardUrl);
});

test('simultaneous stops across tabs create only one recording owner', async ({ page, context, baseURL }) => {
  const redmineBase = baseURL || 'http://127.0.0.1:3002';
  await adminLogin(page, redmineBase);
  const { boardUrl, data, issue, sessionKey } = await prepareBoard(page, redmineBase);
  await seedSession(page, sessionKey, issue, data.meta.current_user_id);
  const pageB = await context.newPage();
  await Promise.all([page.reload(), pageB.goto(boardUrl)]);
  await Promise.all([expect(page.getByTestId('global-timer-stop-button')).toBeVisible(), expect(pageB.getByTestId('global-timer-stop-button')).toBeVisible()]);

  await Promise.all([
    page.evaluate(() => document.querySelector('[data-testid="global-timer-stop-button"]')?.click()),
    pageB.evaluate(() => document.querySelector('[data-testid="global-timer-stop-button"]')?.click()),
  ]);

  await expect.poll(async () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null')?.recordingAttempt?.ownerTabId, sessionKey)).toBeTruthy();
  await expect.poll(async () => (await page.locator('iframe.rk-iframe-dialog-frame').count()) + (await pageB.locator('iframe.rk-iframe-dialog-frame').count())).toBe(1);
});

test('successful Worktime registration clears TimerSession without nesting Kanban', async ({ page, baseURL }) => {
  const redmineBase = baseURL || 'http://127.0.0.1:3002';
  const boardUrl = `${redmineBase}/projects/ecookbook/kanban`;
  await adminLogin(page, redmineBase);
  await page.goto(boardUrl);
  await expect(page.locator('.rk-canvas-board')).toBeVisible();

  const snapshot = await page.request.get(`${boardUrl}/data?board_entity_limit=5000`);
  expect(snapshot.ok()).toBeTruthy();
  const data = await snapshot.json();
  const issue = data.entities.find((candidate) => candidate.can_log_time);
  expect(issue).toBeTruthy();

  const now = Date.now();
  const instanceKey = new URL(redmineBase).origin + new URL(redmineBase).pathname.replace(/\/$/, '');
  const sessionKey = `redmine_canvas_gantt_timer_session:${encodeURIComponent(instanceKey)}:user:${data.meta.current_user_id}`;
  await page.evaluate(({ key, issueId, subject, userId, timestamp }) => {
    localStorage.setItem(key, JSON.stringify({
      version: 4,
      sessionId: `worktime-e2e-${timestamp}`,
      revision: 1,
      issueId,
      subject,
      autoStop: false,
      state: 'stopped_pending_record',
      segments: [{ startedAt: timestamp - 60_000, stoppedAt: timestamp }],
      userId,
      createdAt: timestamp - 60_000,
      updatedAt: timestamp,
    }));
  }, { key: sessionKey, issueId: issue.id, subject: issue.subject, userId: data.meta.current_user_id, timestamp: now });
  await page.reload();

  const nestedKanbanNavigations = [];
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame() && frame.url().includes('/projects/ecookbook/kanban')) {
      nestedKanbanNavigations.push(frame.url());
    }
  });

  await page.getByRole('button', { name: /record work time|作業時間を記録/i }).click();
  const iframe = page.locator('iframe.rk-iframe-dialog-frame');
  await expect(iframe).toBeVisible();
  const src = new URL(await iframe.getAttribute('src'));
  expect(src.searchParams.get('back_url')).toBe(`${instanceKey}/issues/${issue.id}`);

  const timeEntry = page.frameLocator('iframe.rk-iframe-dialog-frame');
  await timeEntry.locator('#time_entry_hours').fill('0.02');
  const createResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/time_entries')
  ));
  await page.locator('[data-testid="issue-dialog-footer"] .rk-btn-primary').click();
  expect((await createResponse).status()).toBe(302);

  await expect(iframe).toHaveCount(0);
  await expect(page.locator('.rk-work-timer')).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), sessionKey)).toBeNull();
  expect(nestedKanbanNavigations).toEqual([]);
});
