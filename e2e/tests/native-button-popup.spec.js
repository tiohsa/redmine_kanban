const { test, expect } = require('@playwright/test');

async function login(page, baseURL) {
  await page.goto(`${baseURL}/login`);
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill(process.env.REDMINE_PASSWORD || 'admin1234');
  await page.getByRole('button', { name: /login|sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}

test('real priority and progress popups use native keyboard activation once and restore focus', async ({ page, baseURL }) => {
  const projectPath = `${baseURL}/projects/${process.env.REDMINE_KANBAN_NATIVE_PROJECT || 'kanban-native'}`;
  await login(page, baseURL);
  const snapshotResponse = await page.request.get(`${projectPath}/kanban/data?board_entity_limit=5000`);
  expect(snapshotResponse.ok()).toBeTruthy();
  const snapshot = await snapshotResponse.json();

  await page.goto(`${projectPath}/kanban`);
  const root = page.locator('#redmine-kanban-root');
  const labels = JSON.parse(await root.getAttribute('data-labels'));
  await expect(page.locator('.rk-canvas-board')).toBeVisible();
  const keyboardActions = page.locator('.rk-board-keyboard-actions');
  await keyboardActions.locator('summary').click();
  const issueSelect = keyboardActions.getByRole('combobox', { name: labels.issue_subject });
  const issueId = Number(await issueSelect.locator('option').first().getAttribute('value'));
  const patchRequests = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() === 'PATCH' && url.pathname.endsWith(`/kanban/issues/${issueId}`)) patchRequests.push(request);
  });

  async function choose(kind, activation, targetName) {
    const label = kind === 'priority' ? labels.issue_priority : labels.issue_done_ratio;
    const source = keyboardActions.getByRole('button', { name: label, exact: true });
    await source.click();
    const popup = page.getByRole('group', { name: label });
    await expect(popup).toBeVisible();
    const selected = popup.getByRole('button', { pressed: true });
    await expect(selected).toBeFocused();
    const target = targetName === 'other'
      ? popup.locator('button[aria-pressed="false"]').first()
      : popup.getByRole('button', { name: targetName, exact: true });
    const saved = page.waitForResponse((response) => (
      response.url().includes(`/kanban/issues/${issueId}`)
      && response.request().method() === 'PATCH'
    ));
    if (activation === 'mouse') await target.click();
    else await target.press(activation);
    expect((await saved).ok()).toBeTruthy();
    await expect(popup).toHaveCount(0);
    await expect(source).toBeFocused();
    expect(patchRequests).toHaveLength(choose.expectedRequestCount += 1);
  }
  choose.expectedRequestCount = 0;

  const issue = snapshot.entities.find((entity) => entity.id === issueId);
  const priority = snapshot.lists.priorities.find((item) => item.id !== issue.priority_id);
  expect(priority).toBeTruthy();
  await choose('priority', 'Enter', priority.name);

  await choose('progress', 'Space', 'other');
  await choose('progress', 'mouse', 'other');

  const progressSource = keyboardActions.getByRole('button', { name: labels.issue_done_ratio, exact: true });
  await progressSource.click();
  const progressPopup = page.getByRole('group', { name: labels.issue_done_ratio });
  await expect(progressPopup).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(progressPopup).toHaveCount(0);
  await expect(progressSource).toBeFocused();
});
