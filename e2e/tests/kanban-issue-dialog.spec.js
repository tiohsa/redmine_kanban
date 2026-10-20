const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

// Exercise the shipped bundle and real iframe navigation without a Redmine database.
const pluginRoot = path.resolve(__dirname, '../..');
let origin;
let server;
let posts = [];
const labels = {
  create: 'Create', create_issue: 'Create issue', creating: 'Creating',
  save: 'Save', saving: 'Saving', edit_issue: 'Edit issue', close: 'Close', cancel: 'Cancel',
  saved: 'Saved %{id}', created: 'Created %{id}', save_comment: 'Save comment', saving_comment: 'Saving comment',
  issue_create_dialog_title: 'New issue', issue_edit_dialog_title: 'Edit issue', issue_info_dialog_title: 'Issue',
  open_in_redmine: 'Open in Redmine', all: 'All', not_set: 'Not set', none: 'None',
  bulk_subtask_title: 'Subtasks', bulk_subtask_placeholder: 'One subject per line',
  bulk_subtask_mode: 'Input mode', bulk_subtask_text_mode: 'Text', bulk_subtask_table_mode: 'Table',
  bulk_subtask_default_tracker: 'Default tracker', select_tracker: 'Select tracker',
  issue_tracker: 'Tracker', display_settings: 'Display settings', font_size: 'Font size',
};
const tracker = { id: 1, name: 'Bug', workflow_status_ids: [2], default_status_id: 2, available_project_ids: [4] };
const project = { id: 4, name: 'Demo', level: 0 };
const column = { id: 2, name: 'Open', is_closed: false, count: 1 };
const snapshot = {
  ok: true, contract_version: 3, scope_fingerprint: 'sha256:dialog-test',
  meta: { project_id: 4, project_ids: [4], current_user_id: 7, scope_status_ids: [2], dependency_status_ids: [2],
    can_move: true, can_create: true, can_delete: true, lane_type: 'assignee', complete: true, entity_count: 1, server_entity_limit: 5000 },
  columns: [column], lanes: [{ id: 'unassigned', name: 'Unassigned', assigned_to_id: null }],
  lists: { assignees: [{ id: null, name: 'Unassigned' }], trackers: [tracker], priorities: [{ id: 1, name: 'Normal' }], categories: [], projects: [project],
    viewable_projects: [project], creatable_projects: [project] },
  entities: [{ id: 1, parent_id: null, subject: 'Fixture issue', status_id: 2, status_is_closed: false,
    tracker_id: 1, description: '', assigned_to_id: null, assigned_to_name: null,
    start_date: null, due_date: null, priority_id: 1, priority_name: 'Normal', category_id: null, category_name: null,
    lock_version: 0, done_ratio: 0, updated_on: '2026-10-20T00:00:00Z', aging_days: 0, can_log_time: true,
    project: { id: 4, name: 'Demo' }, permissions: { can_move: true, can_edit: true, can_delete: true },
    allowed_status_ids: [2], urls: { issue: '/issues/1', issue_edit: '/issues/1/edit' } }],
  tree: { root_ids: [1], children_by_parent_id: {} }, labels,
};
const metadata = {
  ok: true, board: { id: 4, name: 'Demo', identifier: 'demo' }, projects: [project], viewable_projects: [project],
  statuses: [column], server_entity_limit: 5000, filter_options_complete: true,
  filter_options: { assignees: [], trackers: [tracker], priorities: [{ id: 1, name: 'Normal' }] },
};
const shell = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/assets/stylesheets/redmine_kanban_spa.css"></head>
<body style="margin:0"><div id="redmine-kanban-root" data-data-url="/projects/demo/kanban/data" data-current-user-id="7"></div>
<script src="/assets/javascripts/redmine_kanban_spa.js"></script></body></html>`;

function redminePage(content) {
  return `<!doctype html><html><head><style>input, textarea { box-sizing: border-box; } input { height: 28px; }</style></head><body>
    <div id="top-menu">Top menu</div><div id="header">Redmine header</div><div id="main-menu">Main menu</div>
    <div id="main"><div id="sidebar">Sidebar</div><div id="content">${content}</div></div><div id="footer">Redmine footer</div>
  </body></html>`;
}
function editorPage(action) {
  return redminePage(`<form id="issue-form" action="${action}" method="post">
    <input type="hidden" name="issue[project_id]" value="4">
    <label>Subject <input name="issue[subject]" value="Fixture issue"></label>
    <select name="issue[tracker_id]"><option value="1">Bug</option></select>
    <div style="height:800px">Long form</div><label>Last field <input id="bottom-field" name="issue[notes]"></label>
    <p class="buttons"><button type="submit">Native save</button></p></form>`);
}
const issuePage = redminePage(`<div class="contextual"><a class="icon-edit" href="/issues/1/edit">Native edit</a></div>
  <div class="issue details">Saved issue</div><div class="wiki"><a href="/manual">Manual</a></div>
  <a id="journal-edit" href="/journals/42/edit">Edit comment</a>`);

test.beforeAll(async () => {
  server = http.createServer((request, response) => {
    const url = new URL(request.url, origin);
    const send = (body, type = 'text/html') => {
      response.writeHead(200, { 'Content-Type': type });
      response.end(body);
    };
    if (url.pathname.startsWith('/assets/')) {
      return send(fs.readFileSync(path.join(pluginRoot, url.pathname)),
        url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'font/woff2');
    }
    if (request.method === 'POST') {
      posts.push(url.pathname);
      request.resume();
      response.writeHead(302, { Location: '/issues/1' });
      return response.end();
    }
    if (url.pathname.endsWith('/metadata')) return send(JSON.stringify(metadata), 'application/json');
    if (url.pathname.endsWith('/trackers')) return send(JSON.stringify({ trackers: [tracker] }), 'application/json');
    if (url.pathname.includes('/kanban/')) return send(JSON.stringify(snapshot), 'application/json');
    if (url.pathname.endsWith('/issues/new')) return send(editorPage('/issues'));
    if (url.pathname === '/issues/1/edit') return send(editorPage('/issues/1'));
    if (url.pathname === '/journals/42/edit') return send(redminePage(
      '<form id="journal-42-form" action="/journals/42" method="post"><textarea name="journal[notes]">Comment</textarea><button type="submit">Native save</button></form>'));
    if (url.pathname === '/issues/1') return send(issuePage);
    return send(shell);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

async function openBoard(page, settings) {
  posts = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(value => {
    localStorage.setItem('rk_issue_dialog_size:user:7', JSON.stringify(value));
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...args) {
      if (this.canvas.classList.contains('rk-canvas') && text.includes('Fixture')) {
        const matrix = this.getTransform();
        const rect = this.canvas.getBoundingClientRect();
        window.__issuePoint = { x: rect.left + (matrix.a * x + matrix.c * y + matrix.e) * rect.width / this.canvas.width + 5,
          y: rect.top + (matrix.b * x + matrix.d * y + matrix.f) * rect.height / this.canvas.height + 3 };
      }
      return fillText.call(this, text, x, y, ...args);
    };
  }, settings);
  await page.goto(origin);
  await expect(page.locator('.rk-canvas')).toBeVisible();
  return { posts, errors };
}
const fixed = { widthPx: 900, heightMode: 'fixed', heightPercent: 50, fullScreen: false };

for (const [mode, settings, expectedHeight] of [
  ['fixed 50%', fixed, 320],
  ['fullscreen', { ...fixed, fullScreen: true }, 600],
  ['automatic', { ...fixed, heightMode: 'auto' }, 540],
]) {
  test(`${mode}: the bottom iframe field and expanded subtasks remain operable`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1000, height: 600 });
    const { posts, errors } = await openBoard(page, settings);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    const frame = page.frameLocator('iframe.rk-iframe-dialog-frame');
    await expect(frame.locator('#bottom-field')).toBeAttached();
    await page.locator('.rk-subtask-toggle').click();
    await expect(page.getByRole('textbox', { name: 'Subtasks', exact: true })).toBeVisible();
    const dialog = page.locator('.rk-iframe-dialog-container');
    await expect.poll(async () => (await dialog.boundingBox()).height).toBe(expectedHeight);
    await frame.locator('html').evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const field = frame.locator('#bottom-field');
    const inputBox = await field.boundingBox();
    const visibleRegion = await page.locator('.rk-iframe-wrapper').evaluate(node => {
      const rect = node.parentElement.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    });
    expect(inputBox.y).toBeGreaterThanOrEqual(visibleRegion.top);
    expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(visibleRegion.bottom);
    await page.mouse.click(inputBox.x + inputBox.width / 2, inputBox.y + inputBox.height / 2);
    await expect(field).toBeFocused();
    await page.keyboard.type('Reached the bottom');
    await expect(field).toHaveValue('Reached the bottom');
    const subtasks = page.locator('.rk-subtask-footer');
    await subtasks.evaluate(node => { node.scrollTop = node.scrollHeight; });
    expect(await subtasks.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    await expect(page.locator('[data-testid="issue-dialog-footer"] .rk-btn-primary')).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('expanded-subtasks.png') });
    await page.locator('.rk-issue-dialog-close').click();
    await expect(dialog).toHaveCount(0);
    expect(posts).toEqual([]);
    expect(errors).toEqual([]);
  });
}

for (const target of ['create', 'edit', 'journal']) {
  test(`${target} save hides Redmine chrome and keeps edit and iframe Escape working`, async ({ page }) => {
    const { posts, errors } = await openBoard(page, fixed);
    if (target === 'create') {
      await page.getByRole('button', { name: 'Create', exact: true }).click();
    } else {
      const point = await page.waitForFunction(() => window.__issuePoint, null, { timeout: 10000 });
      const { x, y } = await point.jsonValue();
      await page.mouse.click(x, y);
      await expect(page.frameLocator('iframe').locator('.issue.details')).toBeVisible();
      if (target === 'edit') await page.getByRole('button', { name: 'Edit issue', exact: true }).click();
      else await page.frameLocator('iframe').locator('#journal-edit').click();
    }
    const frame = page.frameLocator('iframe.rk-iframe-dialog-frame');
    await expect(frame.locator(target === 'journal' ? '#journal-42-form' : '#issue-form')).toBeVisible();
    const saveLabel = target === 'create' ? 'Create issue' : target === 'journal' ? 'Save comment' : 'Save';
    await page.getByRole('button', { name: saveLabel, exact: true }).click();
    await expect(frame.locator('.issue.details')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit issue', exact: true })).toBeVisible();
    for (const selector of ['#top-menu', '#header', '#main-menu', '#footer', '#sidebar', '.icon-edit']) {
      await expect(frame.locator(selector)).toBeHidden();
    }
    await expect(frame.getByRole('link', { name: 'Manual', exact: true })).toHaveAttribute('target', '_blank');
    expect(posts).toEqual([target === 'create' ? '/issues' : target === 'edit' ? '/issues/1' : '/journals/42']);
    await page.getByRole('button', { name: 'Edit issue', exact: true }).click();
    await expect(frame.locator('#issue-form')).toBeVisible();
    await frame.locator('input[name="issue[subject]"]').press('Escape');
    await expect(page.locator('iframe.rk-iframe-dialog-frame')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
