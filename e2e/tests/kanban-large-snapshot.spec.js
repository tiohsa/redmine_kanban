const { test, expect } = require('@playwright/test');

async function adminLogin(page, baseURL) {
  await page.goto(`${baseURL}/login`);
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill('admin1234');
  await page.getByRole('button', { name: /login|sign in/i }).click();
}

async function getSnapshot(page, baseURL, limit) {
  const response = await page.request.get(
    `${baseURL}/projects/ecookbook/kanban/data?board_entity_limit=${limit}`,
  );
  return { response, payload: await response.json() };
}

async function getFilteredSnapshot(page, baseURL, limit, query) {
  const response = await page.request.get(
    `${baseURL}/projects/ecookbook/kanban/data?board_entity_limit=${limit}&filter_q=${encodeURIComponent(query)}`,
  );
  return { response, payload: await response.json() };
}

test('actual DB high-fan-out fixture enforces admission and resource bounds', async ({ page, baseURL }) => {
  const redmineBase = baseURL || 'http://127.0.0.1:3002';
  await adminLogin(page, redmineBase);

  const baseline = await getSnapshot(page, redmineBase, 5000);
  expect(baseline.response.ok()).toBeTruthy();
  const totalEntityCount = baseline.payload.meta.entity_count;
  const fanOutParent = baseline.payload.entities.find(
    (issue) => issue.subject === 'Kanban E2E truncation parent',
  );
  expect(fanOutParent).toBeTruthy();
  expect(baseline.payload.tree.children_by_parent_id[String(fanOutParent.id)]).toHaveLength(1505);

  const exactLimit = await getSnapshot(page, redmineBase, totalEntityCount);
  expect(exactLimit.response.ok()).toBeTruthy();
  expect(exactLimit.payload.meta.complete).toBe(true);
  expect(exactLimit.payload.meta.entity_count).toBe(totalEntityCount);
  expect(exactLimit.payload.meta.materialized_row_count).toBeLessThanOrEqual(exactLimit.payload.meta.effective_entity_limit);
  expect(exactLimit.payload.meta.query_count).toBeLessThanOrEqual(20);
  expect(exactLimit.payload.meta.response_bytes).toBe((await exactLimit.response.body()).byteLength);
  expect(exactLimit.payload.meta.response_bytes).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(new Set(exactLimit.payload.entities.map((issue) => issue.id)).size).toBe(totalEntityCount);

  const overLimit = await getSnapshot(page, redmineBase, 1500);
  expect(overLimit.response.status()).toBe(422);
  expect(overLimit.payload.error.code).toBe('BOARD_SCOPE_TOO_LARGE');
  expect(overLimit.payload).not.toHaveProperty('entities');

  const childFilter = 'Kanban E2E truncation child 1505';
  const filteredFanOut = await getFilteredSnapshot(page, redmineBase, 1500, childFilter);
  expect(filteredFanOut.response.status()).toBe(422);
  expect(filteredFanOut.payload.error.code).toBe('BOARD_SCOPE_TOO_LARGE');
  expect(filteredFanOut.payload).not.toHaveProperty('entities');

  const filteredStartedAt = process.hrtime.bigint();
  const filteredComplete = await getFilteredSnapshot(page, redmineBase, 2000, childFilter);
  const filteredElapsedMs = Number(process.hrtime.bigint() - filteredStartedAt) / 1_000_000;
  expect(filteredComplete.response.ok()).toBeTruthy();
  expect(filteredComplete.payload.meta.complete).toBe(true);
  expect(filteredComplete.payload.meta.requested_entity_limit).toBe(2000);
  expect(filteredComplete.payload.meta.server_entity_limit).toBe(10000);
  expect(filteredComplete.payload.meta.entity_count).toBe(1506);
  expect(filteredComplete.payload.entities).toHaveLength(1506);
  const filteredParent = filteredComplete.payload.entities.find((issue) => issue.subject === 'Kanban E2E truncation parent');
  const matchingChild = filteredComplete.payload.entities.find((issue) => issue.subject === childFilter);
  expect(filteredParent).toBeTruthy();
  expect(matchingChild).toBeTruthy();
  expect(filteredComplete.payload.tree.children_by_parent_id[String(filteredParent.id)]).toHaveLength(1505);
  console.log(JSON.stringify({
    high_fan_out_filter: childFilter,
    entity_count: filteredComplete.payload.meta.entity_count,
    query_count: filteredComplete.payload.meta.query_count ?? null,
    response_bytes: (await filteredComplete.response.body()).byteLength,
    elapsed_ms: Number(filteredElapsedMs.toFixed(1)),
  }));
});
