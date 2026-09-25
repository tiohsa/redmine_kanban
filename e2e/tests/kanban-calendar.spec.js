const { test, expect } = require('@playwright/test');

async function openBoard(page, baseURL) {
  await page.goto(`${baseURL}/login`);
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill(process.env.REDMINE_PASSWORD || 'admin1234');
  await page.getByRole('button', { name: /login|sign in/i }).click();
  await page.goto(`${baseURL}/projects/ecookbook/kanban`);
  await expect(page.locator('.rk-canvas')).toBeVisible();
}

async function openAt(page, issueId, currentDate, x, y) {
  // Canvas cards have no DOM nodes. Invoke their existing date callback to test
  // popover placement at coordinates that the fixture cannot place a card at.
  await page.evaluate(({ issueId: id, currentDate: date, x: left, y: top }) => {
    const canvas = document.querySelector('.rk-canvas');
    const fiberKey = Object.keys(canvas).find((key) => key.startsWith('__reactFiber$'));
    let fiber = canvas[fiberKey];
    while (fiber && typeof fiber.memoizedProps?.onDateClick !== 'function') fiber = fiber.return;
    if (!fiber) throw new Error('Canvas date callback was not found');
    fiber.memoizedProps.onDateClick(id, date, left, top);
  }, { issueId, currentDate, x, y });
  await expect(page.locator('.rk-minimax-datepicker')).toBeVisible();
}

test('calendar stays in the viewport at four corners in English and Japanese', async ({ page, baseURL }) => {
  const root = baseURL || 'http://127.0.0.1:3002';
  await page.setViewportSize({ width: 1280, height: 800 });
  await openBoard(page, root);
  const board = await (await page.request.get(`${root}/projects/ecookbook/kanban/data`)).json();
  const issue = board.entities.find((entity) => entity.subject === 'Kanban E2E parent issue');
  expect(issue).toBeTruthy();

  for (const language of ['en', 'ja']) {
    await page.evaluate((lang) => { document.documentElement.lang = lang; }, language);
    for (const [x, y] of [[2, 2], [1278, 2], [2, 798], [1278, 798]]) {
      await openAt(page, issue.id, issue.due_date, x, y);
      const calendar = page.locator('.rk-minimax-datepicker');
      const box = await calendar.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(1280);
      expect(box.y + box.height).toBeLessThanOrEqual(800);
      const controls = calendar.locator('.rk-minimax-datepicker-select, .rk-minimax-datepicker-nav-btn, .rk-minimax-datepicker-btn');
      for (let index = 0; index < await controls.count(); index += 1) {
        const controlBox = await controls.nth(index).boundingBox();
        expect(controlBox.x).toBeGreaterThanOrEqual(0);
        expect(controlBox.y).toBeGreaterThanOrEqual(0);
        expect(controlBox.x + controlBox.width).toBeLessThanOrEqual(1280);
        expect(controlBox.y + controlBox.height).toBeLessThanOrEqual(800);
      }
      const selects = await calendar.locator('.rk-minimax-datepicker-select').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
      expect(selects[0]).toBe(language === 'ja' ? board.labels.calendar_year : board.labels.calendar_month);
      const firstMonth = await calendar.locator('.rk-minimax-datepicker-select--month option').first().textContent();
      expect(firstMonth).toBe(language === 'ja' ? '1月' : 'January');
      await expect(calendar.locator(':focus')).toHaveCount(1);
      const focusedOutline = await calendar.locator(':focus').evaluate((node) => getComputedStyle(node).outlineStyle);
      expect(focusedOutline).not.toBe('none');
      await page.keyboard.press('Escape');
      await expect(calendar).toHaveCount(0);
      await expect(page.locator('.rk-canvas')).toBeFocused();
    }
  }
});

test('month navigation does not update Redmine and selecting a day updates once', async ({ page, baseURL }) => {
  const root = baseURL || 'http://127.0.0.1:3002';
  await page.setViewportSize({ width: 1280, height: 800 });
  await openBoard(page, root);
  const dataUrl = `${root}/projects/ecookbook/kanban/data`;
  const board = await (await page.request.get(dataUrl)).json();
  const parent = board.entities.find((entity) => entity.subject === 'Kanban E2E parent issue');
  const issue = board.entities.find((entity) => entity.subject === 'Kanban E2E grandchild');
  expect(parent?.due_date).toBeNull();
  expect(issue?.due_date).toBeNull();
  const updates = [];
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && /\/kanban\/issues\/\d+/.test(request.url())) updates.push(request);
  });

  // The seeded parent card's empty-date badge is in its first metadata row.
  await page.locator('.rk-canvas').click({ position: { x: 216, y: 108 } });
  await expect(page.locator('.rk-minimax-datepicker')).toBeVisible();
  await page.getByRole('combobox', { name: board.labels.calendar_year }).selectOption('2040');
  await page.getByRole('combobox', { name: board.labels.calendar_month }).selectOption('1');
  expect(updates).toHaveLength(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.rk-minimax-datepicker')).toHaveCount(0);
  await expect(page.locator('.rk-canvas')).toBeFocused();
  expect(updates).toHaveLength(0);

  await openAt(page, parent.id, null, 216, 298);
  await page.mouse.click(10, 650);
  await expect(page.locator('.rk-minimax-datepicker')).toHaveCount(0);
  await expect(page.locator('.rk-canvas')).toBeFocused();
  expect(updates).toHaveLength(0);

  await openAt(page, issue.id, null, 216, 298);
  await page.getByRole('combobox', { name: board.labels.calendar_year }).selectOption('2040');
  await page.getByRole('combobox', { name: board.labels.calendar_month }).selectOption('1');
  expect(updates).toHaveLength(0);
  const response = page.waitForResponse((candidate) => candidate.request().method() === 'PATCH' && candidate.url().includes(`/kanban/issues/${issue.id}`));
  await page.locator('.rk-minimax-datepicker .react-datepicker__day--014:not(.react-datepicker__day--outside-month)').click();
  expect((await response).ok()).toBeTruthy();
  expect(updates).toHaveLength(1);
  await expect.poll(async () => (await (await page.request.get(dataUrl)).json()).entities.find((entity) => entity.id === issue.id)?.due_date).toBe('2040-02-14');

  await openAt(page, issue.id, '2040-02-14', 216, 298);
  const selected = page.locator('.rk-minimax-datepicker .react-datepicker__day--selected');
  const before = await selected.evaluate((node) => ({ background: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color }));
  await selected.hover();
  const after = await selected.evaluate((node) => ({ background: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color }));
  expect(after).toEqual(before);
  expect(after.color).toBe('rgb(255, 255, 255)');

  const clearResponse = page.waitForResponse((candidate) => candidate.request().method() === 'PATCH' && candidate.url().includes(`/kanban/issues/${issue.id}`));
  await page.getByRole('button', { name: board.labels.calendar_clear }).click();
  expect((await clearResponse).ok()).toBeTruthy();
  expect(updates).toHaveLength(2);
  await expect.poll(async () => (await (await page.request.get(dataUrl)).json()).entities.find((entity) => entity.id === issue.id)?.due_date).toBeNull();
});
