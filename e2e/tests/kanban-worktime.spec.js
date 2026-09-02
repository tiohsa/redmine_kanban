const { test, expect } = require('@playwright/test');

async function adminLogin(page, baseURL) {
  await page.goto(`${baseURL}/login`);
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill(process.env.REDMINE_PASSWORD || 'admin1234');
  await page.getByRole('button', { name: /login|sign in/i }).click();
}

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
