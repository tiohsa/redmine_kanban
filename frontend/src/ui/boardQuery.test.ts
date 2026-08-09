import { describe, expect, it } from 'vitest';
import { appendScopeStatusParams, buildBoardDataUrl, buildBoardEntitiesUrl, buildBoardQueryKey, effectiveScopeStatusIds } from './boardQuery';
import type { BoardData } from './types';

const snapshot = (scope_status_ids?: number[]): BoardData => ({
  ok: true,
  meta: { project_id: 1, current_user_id: 1, can_move: true, can_create: true, can_delete: true, lane_type: 'none', aging_warn_days: 7, aging_danger_days: 14, aging_exclude_closed: false, scope_status_ids },
  columns: [{ id: 1, name: 'Open', is_closed: false }, { id: 2, name: 'Closed', is_closed: true }],
  lanes: [],
  lists: { assignees: [], trackers: [], priorities: [], projects: [], viewable_projects: [], creatable_projects: [] },
  issues: [],
  labels: {},
});

describe('snapshot board query', () => {
  it('resolves explicit, empty, and legacy status scopes consistently', () => {
    expect(effectiveScopeStatusIds(snapshot([2]))).toEqual([2]);
    expect(effectiveScopeStatusIds(snapshot([]))).toEqual([]);
    expect(effectiveScopeStatusIds(snapshot())).toEqual([1, 2]);
  });
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

  it('encodes nonempty entity reconciliation scope explicitly', () => {
    expect(buildBoardEntitiesUrl('/projects/demo/kanban', [2, 1], [9], [3, 2])).toBe('/projects/demo/kanban/issues/entities?project_ids%5B%5D=1&project_ids%5B%5D=2&ids%5B%5D=9&scope_status_ids_present=1&scope_status_ids%5B%5D=2&scope_status_ids%5B%5D=3&dependency_status_ids_present=1&dependency_status_ids%5B%5D=2&dependency_status_ids%5B%5D=3');
  });

  it('preserves explicit empty scope in entity reconciliation', () => {
    expect(buildBoardEntitiesUrl('/projects/demo/kanban', [2, 1], [9], [])).toBe('/projects/demo/kanban/issues/entities?project_ids%5B%5D=1&project_ids%5B%5D=2&ids%5B%5D=9&scope_status_ids_present=1&dependency_status_ids_present=1');
    const params = new URLSearchParams();
    appendScopeStatusParams(params, []);
    expect(params.toString()).toBe('scope_status_ids_present=1');
  });
});
