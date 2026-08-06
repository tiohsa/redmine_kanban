const { test, expect } = require('@playwright/test');

async function adminLogin(page, baseURL) {
  await page.goto(`${baseURL}/login`);
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill('admin1234');
  await page.getByRole('button', { name: /login|sign in/i }).click();
}

test('board API returns a complete bounded flat snapshot without pagination controls', async ({ page, baseURL }) => {
  const redmineBase = baseURL || 'http://127.0.0.1:3002';
  await adminLogin(page, redmineBase);
  const response = await page.request.get(`${redmineBase}/projects/ecookbook/kanban/data?board_entity_limit=1500`);
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.contract_version).toBe(3);
  expect(payload.meta.complete).toBe(true);
  expect(payload.entities.length).toBe(payload.meta.entity_count);
  expect(new Set(payload.entities.map((entity) => entity.id)).size).toBe(payload.entities.length);
  expect(payload.meta.entity_count).toBeLessThanOrEqual(payload.meta.effective_entity_limit);
  expect(payload.tree.root_ids).toBeTruthy();
  expect(payload).not.toHaveProperty('pagination');
  await page.goto(`${redmineBase}/projects/ecookbook/kanban`);
  await expect(page.getByText(/load more/i)).toHaveCount(0);
});

test('board API rejects an over-limit snapshot without returning partial entities', async ({ page, baseURL }) => {
  const redmineBase = baseURL || 'http://127.0.0.1:3002';
  await adminLogin(page, redmineBase);
  const response = await page.request.get(`${redmineBase}/projects/ecookbook/kanban/data?board_entity_limit=1`);
  expect(response.status()).toBe(422);
  const payload = await response.json();
  expect(payload.error.code).toBe('BOARD_SCOPE_TOO_LARGE');
  expect(payload).not.toHaveProperty('entities');
});
