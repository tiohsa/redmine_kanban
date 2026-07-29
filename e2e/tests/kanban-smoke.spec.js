const { test, expect } = require('@playwright/test');

const RESOURCE_TYPES_TO_CHECK = new Set([
  'document',
  'stylesheet',
  'script',
  'fetch',
  'xhr',
  'font',
  'image',
]);

async function adminLogin(page, baseURL) {
  const password = 'admin1234';

  await page.goto(`${baseURL}/login`);
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /login|sign in/i }).click();

  const passwordChangeField = page.locator('#new_password');
  if (await passwordChangeField.isVisible().catch(() => false)) {
    await passwordChangeField.fill(password);
    await page.locator('#new_password_confirmation').fill(password);
    await page.getByRole('button', { name: /apply|save/i }).click();
  }
}

test('kanban page loads without request errors and without Loading text', async ({ page, baseURL }) => {
  const redmineBase = baseURL || 'http://127.0.0.1:3002';
  const consoleErrors = [];
  const pageErrors = [];
  const requestErrors = [];
  const kanbanDataPath = '/projects/ecookbook/kanban/data';

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });

  page.on('requestfailed', (request) => {
    requestErrors.push(`requestfailed: ${request.method()} ${request.url()} (${request.failure()?.errorText || 'unknown'})`);
  });

  page.on('response', (response) => {
    const status = response.status();
    if (status < 400) return;

    const request = response.request();
    if (!RESOURCE_TYPES_TO_CHECK.has(request.resourceType())) return;

    requestErrors.push(`http ${status}: ${request.method()} ${response.url()} [${request.resourceType()}]`);
  });

  await adminLogin(page, redmineBase);

  const boardDataResponsePromise = page.waitForResponse((response) => {
    if (!response.url().includes(kanbanDataPath)) return false;
    const request = response.request();
    return request.method() === 'GET' && (request.resourceType() === 'fetch' || request.resourceType() === 'xhr');
  });

  await page.goto(`${redmineBase}/projects/ecookbook/kanban`);
  await page.waitForLoadState('networkidle');

  await expect(page.locator('#redmine-kanban-root')).toBeVisible();
  await expect(page.locator('.rk-canvas-board')).toBeVisible();

  await expect(page.getByText(/^Loading$/)).toHaveCount(0);
  await expect(page.getByText(/^読み込み中$/)).toHaveCount(0);

  const dataResponse = await boardDataResponsePromise;
  expect(dataResponse.ok(), `kanban data request failed: ${dataResponse.status()} ${dataResponse.url()}`).toBeTruthy();
  const dataJson = await dataResponse.json();
  expect(dataJson.ok).toBeTruthy();
  expect(dataJson.labels).toBeTruthy();
  expect(dataJson.labels.all).toBeTruthy();
  expect(dataJson.labels.loading).toBeTruthy();

  expect(requestErrors, requestErrors.join('\n')).toEqual([]);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
});

test('nested child can close and reopen while server column counts return to baseline', async ({ page, baseURL }) => {
  const redmineBase = baseURL || 'http://127.0.0.1:3002';
  const dataUrl = `${redmineBase}/projects/ecookbook/kanban/data`;

  await adminLogin(page, redmineBase);
  await page.goto(`${redmineBase}/projects/ecookbook/kanban`);

  const getBoard = async () => page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: 'same-origin' });
    return response.json();
  }, dataUrl);
  let initial = await getBoard();
  let parent = initial.issues.find((issue) => issue.subject === 'Kanban E2E parent issue');
  let child = parent?.subtasks?.find((subtask) => subtask.subject === 'Kanban E2E nested child');
  expect(parent).toBeTruthy();
  expect(child).toBeTruthy();

  const openColumn = initial.columns.find((column) =>
    !column.is_closed && child.allowed_status_ids.includes(column.id)
  );
  const closedColumn = initial.columns.find((column) =>
    column.is_closed && child.allowed_status_ids.includes(column.id)
  );
  expect(openColumn).toBeTruthy();
  expect(closedColumn).toBeTruthy();

  const moveChild = async (statusId, lockVersion) => page.evaluate(
    async ({ issueId, statusId: targetStatusId, lockVersion: currentLockVersion }) => {
      const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
      const response = await fetch(
        `/projects/ecookbook/kanban/issues/${issueId}/move`,
        {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          body: JSON.stringify({
            issue: {
              status_id: targetStatusId,
              lock_version: currentLockVersion,
            },
          }),
        },
      );
      return { status: response.status, body: await response.json() };
    },
    { issueId: child.id, statusId, lockVersion },
  );

  // A Playwright retry can start after the previous attempt already closed the
  // child. Normalize to the open baseline before asserting count deltas.
  if (child.status_id !== openColumn.id) {
    const normalized = await moveChild(openColumn.id, child.lock_version);
    expect(normalized.status).toBe(200);
    initial = await getBoard();
    parent = initial.issues.find((issue) => issue.subject === 'Kanban E2E parent issue');
    child = parent?.subtasks?.find((subtask) => subtask.subject === 'Kanban E2E nested child');
  }

  const closed = await moveChild(closedColumn.id, child.lock_version);
  expect(closed.status).toBe(200);
  expect(closed.body.issue).toMatchObject({
    id: child.id,
    status_id: closedColumn.id,
    status_is_closed: true,
  });

  const afterClose = await getBoard();
  expect(afterClose.columns.find((column) => column.id === openColumn.id).count).toBe(openColumn.count - 1);
  expect(afterClose.columns.find((column) => column.id === closedColumn.id).count).toBe(closedColumn.count + 1);

  const reopened = await moveChild(openColumn.id, closed.body.issue.lock_version);
  expect(reopened.status).toBe(200);
  expect(reopened.body.issue).toMatchObject({
    id: child.id,
    status_id: openColumn.id,
    status_is_closed: false,
  });

  const afterReopen = await getBoard();
  expect(afterReopen.columns.map((column) => [column.id, column.count])).toEqual(
    initial.columns.map((column) => [column.id, column.count]),
  );
});
