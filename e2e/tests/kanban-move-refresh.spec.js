const { test, expect } = require('@playwright/test');

const projectPath = (baseURL) => `${baseURL}/projects/kanban-native`;
const subjectPrefix = 'Kanban E2E move refresh ';

async function login(page, baseURL) {
  await page.goto(`${baseURL}/login`);
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill(process.env.REDMINE_PASSWORD || 'admin1234');
  await page.getByRole('button', { name: /login|sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}

async function openIssueAndReturnPosition(page, issueId, columnIndex) {
  const canvas = page.locator('canvas.rk-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Kanban canvas has no layout box');
  const xs = [25, 55, 100, 150, 200, 230].map((x) => Math.min(box.width - 10, columnIndex * 260 + x));
  const ys = [65, 90, 120, 155, 195].map((y) => Math.min(box.height - 10, y));
  for (const y of ys) {
    for (const x of xs) {
      await canvas.click({ position: { x, y } });
      const frame = page.locator('iframe.rk-iframe-dialog-frame');
      if (!(await frame.count())) continue;
      const src = await frame.getAttribute('src');
      if (src?.includes(`/issues/${issueId}`)) {
        await page.locator('.rk-iframe-dialog-container .rk-issue-dialog-close').click();
        await expect(frame).toHaveCount(0);
        return { x, y };
      }
      await page.locator('.rk-iframe-dialog-container .rk-issue-dialog-close').click();
      await expect(frame).toHaveCount(0);
    }
  }
  throw new Error(`Could not locate issue ${issueId} on the canvas`);
}

test('filtered moves apply bounded deltas without replacing the board snapshot', async ({ page, baseURL }) => {
  const root = baseURL || process.env.REDMINE_BASE_URL || 'http://127.0.0.1:3002';
  const project = projectPath(root);
  await login(page, root);

  const initialResponse = await page.request.get(`${project}/kanban/data?board_entity_limit=5000`);
  expect(initialResponse.ok()).toBeTruthy();
  const initial = await initialResponse.json();
  const userId = initial.meta.current_user_id;
  const trackerId = initial.lists.trackers[0]?.id;
  const openStatusId = initial.columns.find((column) => !column.is_closed)?.id ?? initial.columns[0]?.id;
  const sourceAssignee = initial.lists.assignees.find((assignee) => assignee.id == null);
  const targetAssignee = initial.lists.assignees.find((assignee) => assignee.id != null);
  const sourcePriority = initial.lists.priorities[0];
  const targetPriority = initial.lists.priorities.find((priority) => String(priority.id) !== String(sourcePriority?.id));
  expect(trackerId).toBeTruthy();
  expect(openStatusId).toBeTruthy();
  expect(sourceAssignee).toBeTruthy();
  expect(targetAssignee).toBeTruthy();
  expect(sourcePriority).toBeTruthy();
  expect(targetPriority).toBeTruthy();
  const subject = `${subjectPrefix}${Date.now()}`;
  const csrfToken = await page.locator('meta[name="csrf-token"]').getAttribute('content');
  const createResponse = await page.request.post(`${project}/kanban/issues`, {
    headers: { 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' },
    data: { issue: { subject, tracker_id: trackerId, status_id: openStatusId, assigned_to_id: sourceAssignee.id, priority_id: sourcePriority.id } },
  });
  expect(createResponse.ok()).toBeTruthy();
  const created = await createResponse.json();
  const createdIssue = created.issue ?? created.created_issues?.[0];
  expect(createdIssue).toBeTruthy();
  const issueId = createdIssue.id;
  let cleanupLockVersion = createdIssue.lock_version;
  let moveCompleted = false;
  const filterText = subject.toLowerCase();
  let issue;

  try {
    const initialFilteredResponse = await page.request.get(`${project}/kanban/data?board_entity_limit=5000&filter_q=${encodeURIComponent(filterText)}`);
    expect(initialFilteredResponse.ok()).toBeTruthy();
    const initialFiltered = await initialFilteredResponse.json();
    issue = initialFiltered.entities.find((candidate) => candidate.id === issueId);
    expect(issue).toBeTruthy();
    const sourceColumnIndex = initialFiltered.columns.findIndex((column) => column.id === issue.status_id);
    const allowedTargets = issue.allowed_status_ids
      .filter((id) => id !== issue.status_id && initialFiltered.columns.some((column) => column.id === id))
      .sort((left, right) => Math.abs(initialFiltered.columns.findIndex((column) => column.id === left) - sourceColumnIndex)
        - Math.abs(initialFiltered.columns.findIndex((column) => column.id === right) - sourceColumnIndex));
    const targetStatusId = allowedTargets[0];
    expect(targetStatusId).toBeTruthy();
    const targetColumnIndex = initialFiltered.columns.findIndex((column) => column.id === targetStatusId);
    const assigneeLanes = initialFiltered.lists.assignees;
    const sourceLaneIndex = assigneeLanes.findIndex((lane) => String(lane.id ?? 'unassigned') === String(issue.assigned_to_id ?? 'unassigned'));
    const targetLaneIndex = assigneeLanes.findIndex((lane) => String(lane.id) === String(targetAssignee.id));
    expect(sourceLaneIndex).toBeGreaterThanOrEqual(0);
    expect(targetLaneIndex).toBeGreaterThanOrEqual(0);

    await page.evaluate(({ userId, filterText }) => {
      localStorage.clear();
      localStorage.setItem(`rk_filters:/projects/kanban-native/kanban:user:${userId}`, JSON.stringify({
        assigneeIds: [], q: filterText, due: 'all', dueDays: 7, priority: [],
        priorityFilterEnabled: false, projectIds: [], statusIds: [], trackerIds: [],
      }));
      localStorage.setItem(`rk_lane_type:/projects/kanban-native/kanban:user:${userId}`, 'assignee');
      localStorage.setItem(`rk_card_display_mode:user:${userId}`, 'single_line');
    }, { userId, filterText });

    let pageSnapshotRequests = 0;
    let pageMetadataRequests = 0;
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.pathname.endsWith('/kanban/data')) pageSnapshotRequests += 1;
      if (request.method() === 'GET' && url.pathname.endsWith('/kanban/metadata')) pageMetadataRequests += 1;
    });

    const firstFilteredSnapshot = page.waitForResponse((response) => (
      response.url().includes('/kanban/data?') && response.request().method() === 'GET' &&
      new URL(response.url()).searchParams.get('filter_q') === filterText
    ));
    await page.goto(`${project}/kanban`);
    const filteredResponse = await firstFilteredSnapshot;
    expect(filteredResponse.ok()).toBeTruthy();
    const filtered = await filteredResponse.json();
    expect(filtered.entities.map((entry) => entry.id)).toContain(issueId);
    expect(new URL(filteredResponse.url()).searchParams.get('filter_q')).toBe(filterText);
    await expect(page.locator('.rk-canvas-board')).toBeVisible();
    const canvas = page.locator('canvas.rk-canvas');
    const canvasHandle = await canvas.elementHandle();
    expect(canvasHandle).toBeTruthy();
    const toolbar = page.locator('.rk-toolbar');
    const toolbarHandle = await toolbar.elementHandle();
    const toolbarBox = await toolbar.boundingBox();
    const createButton = page.locator('.rk-dropdown-trigger').first();
    const filterButton = page.locator('.rk-toolbar button[aria-haspopup="dialog"]').first();
    const filterButtonHandle = await filterButton.elementHandle();
    const filterButtonBox = await filterButton.boundingBox();
    const createButtonHandle = await createButton.elementHandle();
    const createButtonBox = await createButton.boundingBox();
    expect(pageSnapshotRequests).toBe(1);
    expect(pageMetadataRequests).toBe(1);
    await expect(createButton).toBeEnabled();
    const moveResponsePromise = page.waitForResponse((response) => (
      response.url().includes(`/kanban/issues/${issueId}/move`) && response.request().method() === 'PATCH'
    ));
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('Kanban canvas has no layout box');
    // The left tracker-color strip is inside the card but outside its subject
    // click target and hover action buttons.
    const sourceX = canvasBox.x + 120 + sourceColumnIndex * 260 + 14;
    const sourceY = canvasBox.y + 40 + sourceLaneIndex * 32 + 12 + 17;
    const targetX = canvasBox.x + 120 + targetColumnIndex * 260 + 240;
    const targetY = canvasBox.y + 40 + targetLaneIndex * 32
      + (sourceLaneIndex < targetLaneIndex ? 26 : 0) + 12 + 17;
    await page.mouse.move(sourceX, sourceY);
    await page.mouse.down();
    await page.mouse.move(targetX, targetY, { steps: 20 });
    await page.mouse.up();

    const moveResponse = await moveResponsePromise;
    expect(moveResponse.ok()).toBeTruthy();
    moveCompleted = true;
    const moveResult = await moveResponse.json();
    expect(moveResult.invalidations?.board_snapshot).toBe(false);
    cleanupLockVersion = moveResult.issue?.lock_version
      ?? moveResult.issue_updates?.find((entry) => entry.id === issueId)?.lock_version
      ?? cleanupLockVersion;

    await expect(page.locator('.rk-board')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.rk-canvas-board')).toBeVisible();
    expect(await canvas.evaluate((element, original) => element === original, canvasHandle)).toBe(true);
    await expect(createButton).toBeEnabled();
    expect(await createButton.evaluate((element, original) => element === original, createButtonHandle)).toBe(true);
    expect(await createButton.boundingBox()).toEqual(createButtonBox);
    expect(await toolbar.evaluate((element, original) => element === original, toolbarHandle)).toBe(true);
    expect(await toolbar.boundingBox()).toEqual(toolbarBox);
    expect(await filterButton.evaluate((element, original) => element === original, filterButtonHandle)).toBe(true);
    expect(await filterButton.boundingBox()).toEqual(filterButtonBox);
    expect(pageSnapshotRequests).toBe(1);
    expect(pageMetadataRequests).toBe(1);
    await expect(page.locator('.rk-popup-info[role="dialog"]')).toHaveCount(0);
    await filterButton.click();
    const filterInput = page.locator('.rk-search-box input');
    await expect(filterInput).toHaveValue(filterText);
    await filterButton.click();
    await canvas.click({ position: { x: sourceX - canvasBox.x, y: sourceY - canvasBox.y } });
    await expect(page.locator('iframe.rk-iframe-dialog-frame')).toHaveCount(0);
    const wheelPrevented = await canvas.evaluate((element) => {
      const event = new WheelEvent('wheel', { deltaX: 240, bubbles: true, cancelable: true });
      element.parentElement.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(wheelPrevented).toBe(true);

    const afterAssigneeMoveResponse = await page.request.get(
      `${project}/kanban/data?board_entity_limit=5000&filter_q=${encodeURIComponent(filterText)}`,
    );
    expect(afterAssigneeMoveResponse.ok()).toBeTruthy();
    const afterAssigneeMove = await afterAssigneeMoveResponse.json();
    const afterAssigneeMoveIssue = afterAssigneeMove.entities.find((entry) => entry.id === issueId);
    expect(afterAssigneeMoveIssue).toMatchObject({
      id: issueId,
      status_id: targetStatusId,
      assigned_to_id: targetAssignee.id,
      priority_id: sourcePriority.id,
    });
    expect(afterAssigneeMove.meta.complete).toBe(true);
    expect(await canvas.evaluate((element, original) => element === original, canvasHandle)).toBe(true);

    await page.locator('.rk-toolbar button').filter({
      has: page.locator('.rk-icon:text-is("vertical_align_top")'),
    }).click();
    const settingsButton = page.locator('.rk-toolbar button[aria-haspopup="dialog"]').filter({
      has: page.locator('.rk-icon:text-is("tune")'),
    });
    await settingsButton.click();
    const laneTypeSelect = page.locator('.rk-settings-menu select').first();
    await laneTypeSelect.selectOption('priority');
    await settingsButton.click();
    const priorityLanes = [...initialFiltered.lists.priorities].reverse();
    const sourcePriorityLaneIndex = priorityLanes.findIndex((lane) => String(lane.id) === String(afterAssigneeMoveIssue.priority_id));
    const targetPriorityLaneIndex = priorityLanes.findIndex((lane) => String(lane.id) === String(targetPriority.id));
    expect(sourcePriorityLaneIndex).toBeGreaterThanOrEqual(0);
    expect(targetPriorityLaneIndex).toBeGreaterThanOrEqual(0);
    const prioritySourceColumnIndex = afterAssigneeMove.columns.findIndex((column) => column.id === afterAssigneeMoveIssue.status_id);
    const priorityTargetStatusId = afterAssigneeMoveIssue.allowed_status_ids
      .find((id) => id !== afterAssigneeMoveIssue.status_id && afterAssigneeMove.columns.some((column) => column.id === id));
    expect(priorityTargetStatusId).toBeTruthy();
    const priorityTargetColumnIndex = afterAssigneeMove.columns.findIndex((column) => column.id === priorityTargetStatusId);
    const priorityCanvasBox = await canvas.boundingBox();
    if (!priorityCanvasBox) throw new Error('Kanban canvas has no layout box');
    const priorityMoveResponsePromise = page.waitForResponse((response) => (
      response.url().includes(`/kanban/issues/${issueId}/move`) && response.request().method() === 'PATCH'
    ));
    const prioritySourceX = priorityCanvasBox.x + 120 + prioritySourceColumnIndex * 260 + 14;
    const prioritySourceY = priorityCanvasBox.y + 40 + sourcePriorityLaneIndex * 32 + 12 + 17;
    const priorityTargetX = priorityCanvasBox.x + 120 + priorityTargetColumnIndex * 260 + 240;
    const priorityTargetY = priorityCanvasBox.y + 40 + targetPriorityLaneIndex * 32
      + (sourcePriorityLaneIndex < targetPriorityLaneIndex ? 26 : 0) + 12 + 17;
    await page.mouse.move(prioritySourceX, prioritySourceY);
    await page.mouse.down();
    await page.mouse.move(priorityTargetX, priorityTargetY, { steps: 20 });
    await page.mouse.up();
    const priorityMoveResponse = await priorityMoveResponsePromise;
    expect(priorityMoveResponse.ok()).toBeTruthy();
    const priorityMoveResult = await priorityMoveResponse.json();
    expect(priorityMoveResult.invalidations?.board_snapshot).toBe(false);
    cleanupLockVersion = priorityMoveResult.issue?.lock_version
      ?? priorityMoveResult.issue_updates?.find((entry) => entry.id === issueId)?.lock_version
      ?? cleanupLockVersion;
    await expect(page.locator('.rk-board')).toHaveAttribute('aria-busy', 'false');
    await expect(createButton).toBeEnabled();
    expect(await canvas.evaluate((element, original) => element === original, canvasHandle)).toBe(true);
    expect(await createButton.evaluate((element, original) => element === original, createButtonHandle)).toBe(true);
    expect(await createButton.boundingBox()).toEqual(createButtonBox);
    expect(await toolbar.evaluate((element, original) => element === original, toolbarHandle)).toBe(true);
    expect(await toolbar.boundingBox()).toEqual(toolbarBox);
    expect(await filterButton.evaluate((element, original) => element === original, filterButtonHandle)).toBe(true);
    expect(await filterButton.boundingBox()).toEqual(filterButtonBox);
    expect(pageSnapshotRequests).toBe(1);
    expect(pageMetadataRequests).toBe(1);
    await expect(page.locator('.rk-popup-info[role="dialog"]')).toHaveCount(0);

    const afterPriorityMoveResponse = await page.request.get(
      `${project}/kanban/data?board_entity_limit=5000&filter_q=${encodeURIComponent(filterText)}`,
    );
    expect(afterPriorityMoveResponse.ok()).toBeTruthy();
    const afterPriorityMove = await afterPriorityMoveResponse.json();
    const afterPriorityMoveIssue = afterPriorityMove.entities.find((entry) => entry.id === issueId);
    expect(afterPriorityMoveIssue).toMatchObject({
      id: issueId,
      status_id: priorityTargetStatusId,
      assigned_to_id: targetAssignee.id,
      priority_id: targetPriority.id,
    });
    expect(afterPriorityMove.meta.complete).toBe(true);
    expect(await canvas.evaluate((element, original) => element === original, canvasHandle)).toBe(true);

    expect(pageSnapshotRequests).toBe(1);
    expect(pageMetadataRequests).toBe(1);
    } finally {
      if (cleanupLockVersion === undefined || cleanupLockVersion === null
        || (moveCompleted && cleanupLockVersion === createdIssue.lock_version)) {
        const latestResponse = await page.request.get(
          `${project}/kanban/data?board_entity_limit=5000&filter_q=${encodeURIComponent(filterText)}`,
          { timeout: 10_000 },
        );
        if (latestResponse.ok()) {
          const latest = await latestResponse.json();
          cleanupLockVersion = latest.entities.find((candidate) => candidate.id === issueId)?.lock_version ?? cleanupLockVersion;
        }
      }
      if (cleanupLockVersion !== undefined && cleanupLockVersion !== null) {
        await page.request.delete(`${project}/kanban/issues/${issueId}`, {
          headers: { 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' },
          data: { issue: { lock_version: cleanupLockVersion } },
          timeout: 10_000,
        });
      }
    }
});
