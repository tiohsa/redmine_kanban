const { test, expect } = require('@playwright/test');

async function adminLogin(page, baseURL) {
  await page.goto(`${baseURL}/login`);
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill('admin1234');
  await page.getByRole('button', { name: /login|sign in/i }).click();

  const passwordChangeField = page.locator('#new_password');
  if (await passwordChangeField.isVisible().catch(() => false)) {
    await passwordChangeField.fill('admin1234');
    await page.locator('#new_password_confirmation').fill('admin1234');
    await page.getByRole('button', { name: /apply|save/i }).click();
  }
}

function collectIds(issues) {
  const ids = [];
  const pending = [...issues];
  while (pending.length > 0) {
    const issue = pending.pop();
    ids.push(issue.id);
    pending.push(...(issue.subtasks || []));
  }
  return ids;
}

function collectFixtureChildIds(issues, ids) {
  const pending = [...issues];
  while (pending.length > 0) {
    const issue = pending.pop();
    if (issue.subject?.startsWith('Kanban E2E truncation child ')) ids.add(issue.id);
    pending.push(...(issue.subtasks || []));
  }
}

function collectDirectChildIds(issues, parentId, ids) {
  const pending = issues.map((issue) => ({ issue, parentId: null }));
  while (pending.length > 0) {
    const { issue, parentId: representedParentId } = pending.pop();
    if (issue.parent_id === parentId || representedParentId === parentId) ids.add(issue.id);
    if (issue.id === parentId) {
      for (const child of issue.subtasks || []) ids.add(child.id);
    }
    for (const child of issue.subtasks || []) {
      pending.push({ issue: child, parentId: issue.id });
    }
  }
}

test('truncated tree is visible and recovers through scoped subtree pages', async ({ page, baseURL }) => {
  const redmineBase = baseURL || 'http://127.0.0.1:3002';
  const dataUrl = `${redmineBase}/projects/ecookbook/kanban/data`;

  await adminLogin(page, redmineBase);
  await page.goto(`${redmineBase}/projects/ecookbook/kanban`);
  await page.waitForLoadState('networkidle');

  const initial = await page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: 'same-origin' });
    return response.json();
  }, dataUrl);
  const parent = initial.issues.find((issue) => issue.subject === 'Kanban E2E truncation parent');

  expect(parent).toBeTruthy();
  expect(initial.meta.tree.truncated).toBe(true);
  expect(initial.meta.tree.truncated_parent_ids).toContain(parent.id);
  const ids = collectIds(initial.issues);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.length).toBe(initial.meta.tree.serialized_node_count);
  expect(ids.length).toBeLessThanOrEqual(initial.meta.tree.node_limit);
  const fixtureChildIds = new Set();
  collectFixtureChildIds(initial.issues, fixtureChildIds);
  const recoveredDirectChildIds = new Set();
  collectDirectChildIds(initial.issues, parent.id, recoveredDirectChildIds);
  let expectedDirectChildCount = null;

  const notice = page.getByRole('status');
  await expect(notice).toContainText(/subtasks are not shown/i);

  for (let attempt = 0; attempt < 8 && await notice.count() > 0; attempt += 1) {
    const responsePromise = page.waitForResponse((response) => {
      if (response.request().method() !== 'GET') return false;
      const url = new URL(response.url());
      return url.searchParams.get('tree_parent_id') === String(parent.id);
    });
    await notice.getByRole('button', { name: 'Load more' }).click();
    const response = await responsePromise;
    expect(response.ok()).toBeTruthy();
    const pagePayload = await response.json();
    collectFixtureChildIds(pagePayload.issues, fixtureChildIds);
    for (const issue of pagePayload.issues) recoveredDirectChildIds.add(issue.id);
    expectedDirectChildCount = pagePayload.meta.pagination.total_issue_count;
    expect(pagePayload.meta.pagination.total_issue_count).toBeGreaterThanOrEqual(1_505);
    if (!pagePayload.meta?.pagination?.has_more_issues) {
      await expect(notice).toHaveCount(0);
      break;
    }
  }

  await expect(notice).toHaveCount(0);
  expect(fixtureChildIds.size).toBeGreaterThanOrEqual(1_505);
  expect(recoveredDirectChildIds.size).toBe(expectedDirectChildCount);
});
