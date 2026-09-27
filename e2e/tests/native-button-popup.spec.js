const { test, expect } = require('@playwright/test');

async function login(page, baseURL) {
  await page.goto(`${baseURL}/login`);
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill(process.env.REDMINE_PASSWORD || 'admin1234');
  await page.getByRole('button', { name: /login|sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}

test('does not render the right-side Priority / Progress panel', async ({ page, baseURL }) => {
  const projectPath = `${baseURL}/projects/${process.env.REDMINE_KANBAN_NATIVE_PROJECT || 'kanban-native'}`;
  await login(page, baseURL);
  await page.goto(`${projectPath}/kanban`);
  await expect(page.locator('.rk-canvas-board')).toBeVisible();
  await expect(page.locator('.rk-board-keyboard-actions')).toHaveCount(0);
  await expect(page.locator('.rk-canvas-board details')).toHaveCount(0);
});
