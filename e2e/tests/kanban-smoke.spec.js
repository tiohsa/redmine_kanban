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

  await page.goto(`${redmineBase}/projects/ecookbook/kanban`);
  await page.waitForLoadState('networkidle');

  await expect(page.locator('#redmine-kanban-root')).toBeVisible();
  await expect(page.locator('.rk-canvas-board')).toBeVisible();

  await expect(page.getByText(/^Loading$/)).toHaveCount(0);
  await expect(page.getByText(/^読み込み中$/)).toHaveCount(0);

  const dataResponse = await page.request.get(`${redmineBase}/projects/ecookbook/kanban/data`);
  expect(dataResponse.ok()).toBeTruthy();
  const dataJson = await dataResponse.json();
  expect(dataJson.ok).toBeTruthy();
  expect(dataJson.labels).toBeTruthy();
  expect(dataJson.labels.all).toBeTruthy();
  expect(dataJson.labels.loading).toBeTruthy();

  expect(requestErrors, requestErrors.join('\n')).toEqual([]);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
});
