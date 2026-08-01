import { describe, expect, it } from 'vitest';
import { buildBoardDataUrl, buildBoardEntitiesUrl, buildBoardIssuesUrl, buildBoardQueryKey } from './boardQuery';

describe('buildBoardQueryKey', () => {
  it('includes sorted status-based filters in the cache key', () => {
    expect(
      buildBoardQueryKey('/projects/demo/kanban', [4, 2, 4], [9, 1], new Set([7, 3, 7])),
    ).toEqual(['kanban', 'board', '/projects/demo/kanban', '2,4', '1,9', '3,7', 'default']);
  });
});

describe('buildBoardIssuesUrl', () => {
  it('serializes filters, limit, and offset for the issues page request', () => {
    expect(
      buildBoardIssuesUrl('/projects/demo/kanban', [4, 2, 4], [9, 1], new Set([7, 3, 7]), 100, 200),
    ).toBe(
      '/projects/demo/kanban/issues?project_ids%5B%5D=2&project_ids%5B%5D=4&issue_status_ids%5B%5D=1&issue_status_ids%5B%5D=9&exclude_status_ids%5B%5D=3&exclude_status_ids%5B%5D=7&issue_limit=100&offset=200',
    );
  });

  it('serializes a scoped tree parent for subtree recovery', () => {
    expect(
      buildBoardIssuesUrl('/projects/demo/kanban', [], [], new Set(), 500, 12, 42),
    ).toBe('/projects/demo/kanban/issues?issue_limit=500&offset=12&tree_parent_id=42');
  });
});

it('builds a scoped flat entity reconciliation URL', () => {
  expect(buildBoardEntitiesUrl('/projects/demo/kanban', [4, 2, 4], [12, 7])).toBe(
    '/projects/demo/kanban/issues/entities?project_ids%5B%5D=2&project_ids%5B%5D=4&ids%5B%5D=7&ids%5B%5D=12',
  );
});

describe('buildBoardDataUrl', () => {
  it('serializes sorted filter params for the board API request', () => {
    expect(
      buildBoardDataUrl('/projects/demo/kanban', [4, 2, 4], [9, 1], new Set([7, 3, 7])),
    ).toBe(
      '/projects/demo/kanban/data?project_ids%5B%5D=2&project_ids%5B%5D=4&issue_status_ids%5B%5D=1&issue_status_ids%5B%5D=9&exclude_status_ids%5B%5D=3&exclude_status_ids%5B%5D=7',
    );
  });

  it('omits the query string when no filters are selected', () => {
    expect(buildBoardDataUrl('/projects/demo/kanban', [], [], new Set())).toBe('/projects/demo/kanban/data');
  });
});
