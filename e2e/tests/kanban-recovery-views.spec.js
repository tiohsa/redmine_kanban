const { test, expect } = require('@playwright/test');

async function login(page, baseURL) {
  await page.goto(`${baseURL}/login`);
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill('admin1234');
  await page.getByRole('button', { name: /login|sign in/i }).click();
  await page.evaluate(() => localStorage.clear());
}
async function labels(page) {
  return JSON.parse(await page.locator('#redmine-kanban-root').getAttribute('data-labels'));
}
const isSnapshot = (response) => /\/kanban\/data\?/.test(response.url());

// Run with a real server cap of 2 and the standard e2e/setup_redmine.rb fixture.
// The dedicated recovery server can be selected via REDMINE_BASE_URL.
test('first visit recovers from the server cap using project choices without raising the limit', async ({ page, baseURL }) => {
  test.skip(process.env.REDMINE_KANBAN_RECOVERY_TEST !== '1', 'Requires the dedicated server with entity cap 2');
  await login(page, baseURL);
  const failed = page.waitForResponse(isSnapshot);
  await page.goto(`${baseURL}/projects/ecookbook/kanban`);
  const response = await failed;
  expect(response.status()).toBe(422);
  const error = await response.json();
  expect(error.error.code).toBe('BOARD_SCOPE_TOO_LARGE');
  expect(error.error.server_entity_limit).toBe(2);
  expect(error).not.toHaveProperty('entities');
  const l = await labels(page);
  await expect(page.getByRole('region', { name: l.board_recovery })).toBeVisible();
  await expect(page.getByRole('button', { name: l.create, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: l.project, exact: true }).click();
  const menu = page.getByRole('dialog', { name: l.project });
  await menu.getByRole('switch', { name: l.viewable_projects_short }).click();
  const recovered = page.waitForResponse((r) => isSnapshot(r) && r.ok());
  await menu.getByRole('button', { name: 'Kanban Native E2E', exact: true }).click();
  const complete = await (await recovered).json();
  expect(complete.meta.complete).toBe(true);
  expect(complete.entities).toHaveLength(2);
  expect(complete.meta.requested_entity_limit).toBe(1500);
  expect(complete.meta.server_entity_limit).toBe(2);
  await expect(page.getByRole('region', { name: l.board_recovery })).toHaveCount(0);
  await expect(page.getByText(l.board_scope_too_large.replace('%{limit}', '2'), { exact: false })).toHaveCount(0);
});

test('a narrow saved view recovers a fresh failed snapshot and retains its saved source', async ({ page, baseURL }) => {
  test.skip(process.env.REDMINE_KANBAN_RECOVERY_TEST !== '1', 'Requires the dedicated server with entity cap 2');
  await login(page, baseURL);
  const metadata = await (await page.request.get(`${baseURL}/projects/ecookbook/kanban/metadata`)).json();
  const target = metadata.viewable_projects.find((p) => p.name === 'Kanban Native E2E');
  const failed = page.waitForResponse(isSnapshot);
  await page.goto(`${baseURL}/projects/ecookbook/kanban`);
  expect((await failed).status()).toBe(422);
  const userId = Number(await page.locator('#redmine-kanban-root').getAttribute('data-current-user-id'));
  await page.evaluate(({ targetId, userId }) => {
    localStorage.clear();
    localStorage.setItem(`rk_saved_views:/projects/ecookbook/kanban:user:${userId}`, JSON.stringify({ version: 1, views: [{ id: 'narrow', name: 'Narrow', settings: { filters: { projectIds: [targetId], statusIds: [], trackerIds: [], assigneeIds: [], q: '', due: 'all', dueDays: 7, priority: [], priorityFilterEnabled: false }, sortConfig: [{ field: 'updated', direction: 'desc' }], laneType: 'none', hiddenStatusIds: [], viewableProjectsEnabled: true } }] }));
  }, { targetId: target.id, userId });
  const secondFailed = page.waitForResponse(isSnapshot);
  await page.reload();
  expect((await secondFailed).status()).toBe(422);
  const l = await labels(page);
  await page.getByRole('button', { name: l.saved_views, exact: true }).click();
  const menu = page.getByRole('dialog', { name: l.saved_views });
  const requests = [];
  page.on('request', (r) => { if (/\/kanban\/data\?/.test(r.url())) requests.push(r.url()); });
  const recovered = page.waitForResponse((r) => isSnapshot(r) && r.ok());
  await menu.getByRole('button', { name: 'Narrow', exact: true }).click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Narrow', pressed: true })).toBeFocused();
  expect((await (await recovered).json()).meta.complete).toBe(true);
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every((url) => new URL(url).searchParams.getAll('project_ids[]').join() === String(target.id))).toBe(true);
  await expect(page.getByRole('region', { name: l.board_recovery })).toHaveCount(0);
  const raw = await page.evaluate((id) => JSON.parse(localStorage.getItem(`rk_saved_views:/projects/ecookbook/kanban:user:${id}`)), userId);
  expect(raw.views[0].settings.filters.projectIds).toEqual([target.id]);
});

test('an unavailable hidden status is explicitly removed from current conditions before a complete snapshot loads', async ({ page, baseURL }) => {
  await login(page, baseURL);
  await page.goto(`${baseURL}/projects/kanban-native/kanban`);
  const l = await labels(page);
  const userId = Number(await page.locator('#redmine-kanban-root').getAttribute('data-current-user-id'));
  const hiddenKey = `rk_hidden_status_ids:/projects/kanban-native/kanban:user:${userId}`;
  const viewsKey = `rk_saved_views:/projects/kanban-native/kanban:user:${userId}`;
  await page.evaluate(({ hiddenKey, viewsKey }) => {
    localStorage.setItem(hiddenKey, JSON.stringify([99999]));
    localStorage.setItem(viewsKey, JSON.stringify({ version: 1, views: [{ id: 'unchanged', name: 'Unchanged', settings: { filters: { projectIds: [], statusIds: [], trackerIds: [], assigneeIds: [], q: '', due: 'all', priority: [], priorityFilterEnabled: false }, sortConfig: [{ field: 'updated', direction: 'desc' }], laneType: 'none', hiddenStatusIds: [99999], viewableProjectsEnabled: false } }] }));
  }, { hiddenKey, viewsKey });
  const boardRequests = [];
  page.on('request', (request) => { if (isSnapshot(request)) boardRequests.push(request.url()); });
  await page.reload();
  const remove = page.getByRole('button', { name: l.hidden_statuses_remove_unavailable });
  await expect(remove).toBeVisible();
  expect(boardRequests).toHaveLength(0);
  await expect(page.getByText(`${l.hidden_statuses}: 99999`, { exact: false })).toBeVisible();
  await remove.click();
  const confirmation = page.getByRole('group', { name: l.hidden_statuses_remove_unavailable });
  await expect(confirmation).toContainText('99999');
  await confirmation.getByRole('button', { name: l.cancel }).click();
  await expect(remove).toBeVisible();
  expect(boardRequests).toHaveLength(0);
  await remove.click();
  const recovered = page.waitForResponse((response) => isSnapshot(response) && response.ok());
  await confirmation.getByRole('button', { name: l.hidden_statuses_remove_action }).click();
  expect((await (await recovered).json()).meta.complete).toBe(true);
  await expect(remove).toHaveCount(0);
  const persisted = await page.evaluate(({ hiddenKey, viewsKey }) => ({ hidden: JSON.parse(localStorage.getItem(hiddenKey)), view: JSON.parse(localStorage.getItem(viewsKey)).views[0].settings.hiddenStatusIds }), { hiddenKey, viewsKey });
  expect(persisted).toEqual({ hidden: [], view: [99999] });
});

test('toolbar keyboard activation, focus return, outside click and saved view operations', async ({ page, baseURL }) => {
  await login(page, baseURL);
  await page.goto(`${baseURL}/projects/kanban-native/kanban`);
  const l = await labels(page);
  const toolbar = page.locator('.rk-toolbar');
  const create = toolbar.getByRole('button', { name: l.create, exact: true });
  await expect(create).toBeVisible();
  // Reach create from the preceding document control using an actual Tab key.
  await create.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(create).toBeFocused();
  await create.press('Enter');
  await expect(page.locator('.rk-modal-backdrop')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.rk-modal-backdrop')).toHaveCount(0);
  await create.press('Space');
  await expect(page.locator('.rk-modal-backdrop')).toHaveCount(1);
  await page.keyboard.press('Escape');

  const display = toolbar.getByRole('button', { name: l.display_settings, exact: true });
  await display.focus(); await display.press('Enter');
  const settings = page.getByRole('dialog', { name: l.display_settings });
  await expect(settings).toBeVisible();
  await page.keyboard.press('Tab');
  expect(await settings.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await expect(settings.getByRole('combobox', { name: l.font_size })).toHaveValue('13');
  await settings.getByRole('combobox', { name: l.aging_warn_days }).selectOption('0');
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0); await expect(display).toBeFocused();
  await display.press('Space'); await expect(settings).toBeVisible();
  await toolbar.getByRole('button', { name: l.project, exact: true }).click();
  await expect(settings).toHaveCount(0);
  await expect(toolbar.getByRole('button', { name: l.project, exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await page.reload();
  await display.click();
  await expect(settings.getByRole('combobox', { name: l.aging_warn_days })).toHaveValue('0');
  await page.keyboard.press('Escape');

  await toolbar.getByRole('button', { name: l.saved_views, exact: true }).click();
  const views = page.locator('.rk-saved-views[role=dialog]');
  await expect(views.getByRole('combobox')).toHaveCount(0);
  await expect(views.getByText(l.saved_views_empty)).toBeVisible();
  await views.getByRole('button', { name: l.saved_views_new }).click();
  await expect(views.getByRole('textbox', { name: l.saved_views_name })).toBeFocused();
  await views.getByRole('textbox', { name: l.saved_views_name }).fill('My view');
  const save = views.getByRole('button', { name: l.save, exact: true });
  expect(await save.evaluate((el) => getComputedStyle(el).color === getComputedStyle(el).backgroundColor)).toBe(false);
  await save.click();
  await expect(views.getByRole('status')).toHaveText(l.saved_views_saved);
  await expect(views.getByRole('button', { name: l.saved_views_apply, exact: true })).toHaveCount(0);
  const row = views.getByRole('button', { name: 'My view', exact: true });
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  const viewTrigger = toolbar.locator('.rk-saved-views-trigger');
  for (const key of ['Enter', 'Space']) {
    await row.focus();
    await page.keyboard.press('Tab');
    await expect(views.getByRole('button', { name: l.saved_views_new })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(row).toBeFocused();
    await row.press(key);
    await expect(views).toBeVisible();
    await expect(row).toBeFocused();
    await expect(row).toHaveAttribute('aria-pressed', 'true');
    await expect(viewTrigger).toHaveAttribute('aria-expanded', 'true');
  }
  await page.keyboard.press('Escape');
  await expect(views).toHaveCount(0);
  await expect(viewTrigger).toBeFocused();
  await display.click();
  await settings.getByRole('combobox', { name: l.lane_type }).selectOption('none');
  await page.keyboard.press('Escape');
  const activeView = toolbar.getByRole('button', { name: `${l.saved_views}: My view (${l.saved_views_changed})`, exact: true });
  await expect(activeView).toBeVisible(); await activeView.click();
  const storedBeforeClear = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('rk_saved_views:'))));
  await views.getByRole('button', { name: l.saved_views_manage }).focus();
  await page.keyboard.press('Tab');
  await expect(views.getByRole('button', { name: l.saved_views_clear })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(views).toHaveCount(0);
  await expect(viewTrigger).toBeFocused();
  await expect(viewTrigger).toHaveAccessibleName(l.saved_views);
  await display.click();
  await expect(settings.getByRole('combobox', { name: l.lane_type })).toHaveValue('none');
  await page.keyboard.press('Escape');
  await viewTrigger.click();
  await expect(row).toHaveAttribute('aria-pressed', 'false');
  await expect(views.getByRole('button', { name: l.saved_views_overwrite })).toHaveCount(0);
  await expect(views.getByRole('button', { name: l.saved_views_clear })).toHaveCount(0);
  expect(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('rk_saved_views:'))))).toEqual(storedBeforeClear);
  await row.click();
  await expect(views).toBeVisible();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await display.click();
  await expect(settings.getByRole('combobox', { name: l.lane_type })).not.toHaveValue('none');
  await settings.getByRole('combobox', { name: l.lane_type }).selectOption('none');
  await page.keyboard.press('Escape');
  await activeView.click();
  for (const label of [l.saved_views_overwrite, l.saved_views_manage]) {
    const button = views.getByRole('button', { name: label });
    expect(await button.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await views.getByRole('button', { name: l.saved_views_overwrite }).click();
  await expect(views.getByRole('button', { name: l.saved_views_overwrite })).toHaveCount(0);
  await views.getByRole('button', { name: l.saved_views_manage }).click();
  await views.getByRole('button', { name: l.saved_views_actions.replace('%{name}', 'My view') }).click();
  await views.getByRole('button', { name: l.saved_views_rename, exact: true }).click();
  await expect(views.getByRole('textbox', { name: l.saved_views_name })).toBeFocused();
  await views.getByRole('textbox', { name: l.saved_views_name }).fill('Renamed');
  await views.getByRole('button', { name: l.saved_views_rename_submit, exact: true }).click();
  await expect(toolbar.getByRole('button', { name: `${l.saved_views}: Renamed`, exact: true })).toBeVisible();
  await views.getByRole('button', { name: l.saved_views_actions.replace('%{name}', 'Renamed') }).click();
  await views.getByRole('button', { name: l.delete, exact: true }).click();
  await views.getByRole('button', { name: l.cancel, exact: true }).click();
  await expect(toolbar.getByRole('button', { name: `${l.saved_views}: Renamed`, exact: true })).toBeVisible();
  await views.getByRole('button', { name: l.saved_views_actions.replace('%{name}', 'Renamed') }).click();
  await views.getByRole('button', { name: l.delete, exact: true }).click();
  await views.getByRole('button', { name: l.saved_views_confirm_delete }).click();
  await expect(views.getByText(l.saved_views_empty)).toBeVisible();
  await expect(toolbar.getByRole('button', { name: l.saved_views, exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await display.click();
  await expect(settings.getByRole('combobox', { name: l.lane_type })).toHaveValue('none');
});
