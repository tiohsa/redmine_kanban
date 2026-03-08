import { describe, expect, it } from 'vitest';
import { buildBoardDataUrl, buildBoardQueryKey } from './boardQuery';

describe('buildBoardQueryKey', () => {
  it('includes sorted status-based filters in the cache key', () => {
    expect(
      buildBoardQueryKey('/projects/demo/kanban', [4, 2, 4], [9, 1], new Set([7, 3, 7])),
    ).toEqual(['kanban', 'board', '/projects/demo/kanban', '2,4', '1,9', '3,7']);
  });
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
