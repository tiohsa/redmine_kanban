import { describe, expect, it } from 'vitest';
import { buildBoardDataUrl, buildBoardEntitiesUrl, buildBoardQueryKey } from './boardQuery';

describe('snapshot board query', () => {
  it('sends the entity admission limit and never sends page parameters', () => {
    const url = buildBoardDataUrl('/projects/demo/kanban', [3, 1], [7], new Set([9]), 3000);
    expect(url).toBe('/projects/demo/kanban/data?project_ids%5B%5D=1&project_ids%5B%5D=3&issue_status_ids%5B%5D=7&exclude_status_ids%5B%5D=9&board_entity_limit=3000');
    expect(url).not.toContain('issue_limit');
    expect(url).not.toContain('offset');
    expect(url).not.toContain('cursor');
    expect(url).not.toContain('tree_parent_id');
  });

  it('keys the cache by the requested maximum entity count', () => {
    expect(buildBoardQueryKey('/projects/demo/kanban', [], [], [], 1500)).not.toEqual(
      buildBoardQueryKey('/projects/demo/kanban', [], [], [], 3000),
    );
  });

  it('keeps entity reconciliation scoped to project ids', () => {
    expect(buildBoardEntitiesUrl('/projects/demo/kanban', [2, 1], [9])).toBe('/projects/demo/kanban/issues/entities?project_ids%5B%5D=1&project_ids%5B%5D=2&ids%5B%5D=9');
  });
});
