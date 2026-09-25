const { test, expect } = require('@playwright/test');

async function openBoard(page, baseURL) {
  // Observe public Canvas drawing calls in the test browser to locate the
  // rendered date badge. The application has no DOM node for an individual card.
  await page.addInitScript(() => {
    window.__rkCalendarDraws = [];
    const clearRect = CanvasRenderingContext2D.prototype.clearRect;
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.classList.contains('rk-canvas')) window.__rkCalendarDraws = [];
      return clearRect.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.fillText = function (value, x, y, ...rest) {
      if (this.canvas.classList.contains('rk-canvas') && (value.startsWith('#') || value === 'calendar_today')) {
        const matrix = this.getTransform();
        const rect = this.canvas.getBoundingClientRect();
        const ratioX = rect.width / this.canvas.width;
        const ratioY = rect.height / this.canvas.height;
        window.__rkCalendarDraws.push({
          value,
          x: rect.left + (matrix.a * x + matrix.c * y + matrix.e) * ratioX,
          y: rect.top + (matrix.b * x + matrix.d * y + matrix.f) * ratioY,
        });
      }
      return fillText.call(this, value, x, y, ...rest);
    };
  });
  await page.goto(`${baseURL}/login`);
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill(process.env.REDMINE_PASSWORD || 'admin1234');
  await page.getByRole('button', { name: /login|sign in/i }).click();
  await page.goto(`${baseURL}/projects/ecookbook/kanban`);
  await expect(page.locator('.rk-canvas')).toBeVisible();
}

async function openIssueCalendar(page, issueId) {
  const point = await page.waitForFunction((id) => {
    const draws = window.__rkCalendarDraws || [];
    const idLabel = draws.find((entry) => entry.value === `#${id}`);
    if (!idLabel) return null;
    const icon = draws.filter((entry) => entry.value === 'calendar_today'
      && entry.y > idLabel.y && entry.y - idLabel.y < 80
      && entry.x >= idLabel.x && entry.x - idLabel.x < 180)
      .sort((a, b) => a.y - b.y || a.x - b.x)[0];
    return icon ? { x: icon.x + 5, y: icon.y + 6 } : null;
  }, issueId);
  const { x, y } = await point.jsonValue();
  await page.mouse.click(x, y);
  await expect(page.locator('.rk-minimax-datepicker')).toBeVisible();
}

test('calendar placement stays in the viewport at four corners in English and Japanese', async ({ page, baseURL }) => {
  const root = baseURL || 'http://127.0.0.1:3002';
  await page.setViewportSize({ width: 1280, height: 800 });
  await openBoard(page, root);
  const board = await (await page.request.get(`${root}/projects/ecookbook/kanban/data`)).json();
  const issue = board.entities.find((entity) => entity.subject === 'Kanban E2E parent issue');
  expect(issue).toBeTruthy();

  for (const language of ['en', 'ja']) {
    await page.evaluate((lang) => { document.documentElement.lang = lang; }, language);
    for (const [x, y] of [[8, 8], [1272, 8], [8, 792], [1272, 792]]) {
      await openIssueCalendar(page, issue.id);
      // Placement is tested separately from the user click: move the real
      // portal anchor to each viewport edge without calling React internals.
      await page.locator('.rk-date-popup-anchor').evaluate((anchor, point) => {
        anchor.style.left = `${point.x}px`;
        anchor.style.top = `${point.y}px`;
        window.dispatchEvent(new Event('resize'));
      }, { x, y });
      const calendar = page.locator('.rk-minimax-datepicker');
      await expect.poll(async () => {
        const box = await calendar.boundingBox();
        return box && (x < 640 ? box.x < 100 : box.x > 800)
          && (y < 400 ? box.y < 100 : box.y > 350);
      }).toBe(true);
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
  const issue = board.entities.find((entity) => entity.subject === 'Kanban E2E calendar issue');
  expect(issue?.due_date).toBeNull();
  const updates = [];
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && /\/kanban\/issues\/\d+/.test(request.url())) updates.push(request);
  });

  await openIssueCalendar(page, issue.id);
  await expect(page.locator('.rk-minimax-datepicker')).toBeVisible();
  await page.getByRole('combobox', { name: board.labels.calendar_year }).selectOption('2040');
  await page.getByRole('combobox', { name: board.labels.calendar_month }).selectOption('1');
  expect(updates).toHaveLength(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.rk-minimax-datepicker')).toHaveCount(0);
  await expect(page.locator('.rk-canvas')).toBeFocused();
  expect(updates).toHaveLength(0);

  await openIssueCalendar(page, issue.id);
  await page.locator('.rk-root').click({ position: { x: 1, y: 1 } });
  await expect(page.locator('.rk-minimax-datepicker')).toHaveCount(0);
  await expect(page.locator('.rk-canvas')).toBeFocused();
  expect(updates).toHaveLength(0);

  await openIssueCalendar(page, issue.id);
  await page.getByRole('combobox', { name: board.labels.calendar_year }).selectOption('2040');
  await page.getByRole('combobox', { name: board.labels.calendar_month }).selectOption('1');
  expect(updates).toHaveLength(0);
  const response = page.waitForResponse((candidate) => candidate.request().method() === 'PATCH' && candidate.url().includes(`/kanban/issues/${issue.id}`));
  await page.locator('.rk-minimax-datepicker .react-datepicker__day--014:not(.react-datepicker__day--outside-month)').click();
  expect((await response).ok()).toBeTruthy();
  expect(updates).toHaveLength(1);
  await expect.poll(async () => (await (await page.request.get(dataUrl)).json()).entities.find((entity) => entity.id === issue.id)?.due_date).toBe('2040-02-14');

  await openIssueCalendar(page, issue.id);
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
