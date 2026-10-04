import { describe, expect, it } from 'vitest';
import { appendScopeStatusParams, buildBoardCountsUrl, buildBoardDataUrl, buildBoardEntitiesUrl, buildBoardMetadataQueryKey, buildBoardMetadataUrl, buildBoardMutationUrl, buildBoardQueryKey, effectiveScopeStatusIds } from './boardQuery';
import type { BoardData } from './types';
import type { BoardFilterScope } from '../model/board/filterScope';
import { boardFilterScopeFromFilters } from '../model/board/filterScope';

const snapshot = (scope_status_ids?: number[]): BoardData => ({
  ok: true,
  meta: { project_id: 1, current_user_id: 1, can_move: true, can_create: true, can_delete: true, lane_type: 'none', aging_warn_days: 7, aging_danger_days: 14, aging_exclude_closed: false, scope_status_ids },
  columns: [{ id: 1, name: 'Open', is_closed: false }, { id: 2, name: 'Closed', is_closed: true }],
  lanes: [],
  lists: { assignees: [], trackers: [], priorities: [], projects: [], viewable_projects: [], creatable_projects: [] },
  issues: [],
  labels: {},
});
const filterScope: BoardFilterScope = {
  q: ' Needle ', assignee_ids: [8, 3, 8], include_unassigned: true,
  tracker_ids: [5, 2], priority_filter_enabled: true, priority_ids: [4, 1],
  include_no_priority: true, due: 'custom', due_days: 6, date_anchor: '2026-10-01',
};

describe('snapshot board query', () => {
  it('canonicalizes metadata project scope in the URL and cache key', () => {
    expect(buildBoardMetadataUrl('/board', [4, 2, 4])).toBe('/board/metadata?project_ids%5B%5D=2&project_ids%5B%5D=4');
    expect(buildBoardMetadataUrl('/board', [])).toBe('/board/metadata');
    expect(buildBoardMetadataQueryKey('/board', 7, 'en', [4, 2, 4])).toEqual(buildBoardMetadataQueryKey('/board', 7, 'en', [2, 4]));
    expect(buildBoardMetadataQueryKey('/board', 7, 'en', [])).not.toEqual(buildBoardMetadataQueryKey('/board', 7, 'en', [2]));
    expect(buildBoardMetadataQueryKey('/board', 7, 'en', [0, -1, 2.5])).toEqual(buildBoardMetadataQueryKey('/board', 7, 'en', []));
  });
  it('resolves explicit, empty, and legacy status scopes consistently', () => {
    expect(effectiveScopeStatusIds(snapshot([2]))).toEqual([2]);
    expect(effectiveScopeStatusIds(snapshot([]))).toEqual([]);
    expect(effectiveScopeStatusIds(snapshot())).toEqual([1, 2]);
  });
  it('omits a user supplied admission limit and never sends page parameters', () => {
    const url = buildBoardDataUrl('/projects/demo/kanban', [3, 1], [7], new Set([9]));
    expect(url).toBe('/projects/demo/kanban/data?project_ids%5B%5D=1&project_ids%5B%5D=3&issue_status_ids%5B%5D=7&exclude_status_ids%5B%5D=9&filter_q=&filter_include_unassigned=0&filter_priority_enabled=0&filter_include_no_priority=0&filter_due=all');
    expect(url).not.toContain('issue_limit');
    expect(url).not.toContain('offset');
    expect(url).not.toContain('cursor');
    expect(url).not.toContain('tree_parent_id');
  });

  it('keys the cache by canonical filter scope', () => {
    expect(buildBoardQueryKey('/board', [], [], [], filterScope)).not.toEqual(
      buildBoardQueryKey('/board', [], [], [], { ...filterScope, q: 'different' }),
    );
    expect(buildBoardQueryKey('/board', [], [], [], { ...filterScope, q: ' Needle ' })).toEqual(
      buildBoardQueryKey('/board', [], [], [], { ...filterScope, q: 'needle', assignee_ids: [3, 8] }),
    );
    for (const changed of [
      { ...filterScope, assignee_ids: [10] },
      { ...filterScope, tracker_ids: [10] },
      { ...filterScope, priority_ids: [10] },
      { ...filterScope, due: '7days' as const },
      { ...filterScope, date_anchor: '2026-10-02' },
    ]) expect(buildBoardQueryKey('/board', [], [], [], changed)).not.toEqual(buildBoardQueryKey('/board', [], [], [], filterScope));
    expect(buildBoardQueryKey('/board', [], [], [], { ...filterScope, priority_filter_enabled: false, priority_ids: [99], include_no_priority: false }))
      .toEqual(buildBoardQueryKey('/board', [], [], [], { ...filterScope, priority_filter_enabled: false, priority_ids: [], include_no_priority: false }));
  });

  it('uses the same cache identity for omitted scope and the canonical inactive scope', () => {
    const inactive = boardFilterScopeFromFilters({
      assigneeIds: [], q: '', due: 'all', priority: [], priorityFilterEnabled: false,
      projectIds: [], statusIds: [], trackerIds: [],
    });
    expect(buildBoardQueryKey('/board', [], [], [])).toEqual(buildBoardQueryKey('/board', [], [], [], inactive));
  });

  it('serializes canonical issue filters on snapshot, mutation, entity, and count requests', () => {
    const dataUrl = buildBoardDataUrl('/board', [], [], [], filterScope);
    const mutationUrl = buildBoardMutationUrl('/board', '/issues/4/move', { projectIds: [], filterScope });
    const entitiesUrl = buildBoardEntitiesUrl('/board', [], [4], [], [], filterScope);
    const countsUrl = buildBoardCountsUrl('/board', [], filterScope, [4, 2], [5, 2]);
    for (const url of [dataUrl, mutationUrl, entitiesUrl, countsUrl]) {
      expect(url).toContain('filter_q=needle');
      expect(url).toContain('filter_assignee_ids%5B%5D=3&filter_assignee_ids%5B%5D=8');
      expect(url).toContain('filter_include_unassigned=1');
      expect(url).toContain('filter_tracker_ids%5B%5D=2&filter_tracker_ids%5B%5D=5');
      expect(url).toContain('filter_priority_enabled=1');
      expect(url).toContain('filter_priority_ids%5B%5D=1&filter_priority_ids%5B%5D=4');
      expect(url).toContain('filter_include_no_priority=1');
      expect(url).toContain('filter_due=custom');
      expect(url).toContain('filter_due_days=6');
      expect(url).toContain('filter_date_anchor=2026-10-01');
    }
    expect(countsUrl).toBe('/board/counts?scope_status_ids_present=1&scope_status_ids%5B%5D=2&scope_status_ids%5B%5D=4&dependency_status_ids_present=1&dependency_status_ids%5B%5D=2&dependency_status_ids%5B%5D=5&filter_q=needle&filter_assignee_ids%5B%5D=3&filter_assignee_ids%5B%5D=8&filter_include_unassigned=1&filter_tracker_ids%5B%5D=2&filter_tracker_ids%5B%5D=5&filter_priority_enabled=1&filter_priority_ids%5B%5D=1&filter_priority_ids%5B%5D=4&filter_include_no_priority=1&filter_due=custom&filter_due_days=6&filter_date_anchor=2026-10-01');
  });

  it('defaults a legacy custom due selection to the existing seven day behavior', () => {
    const scope = boardFilterScopeFromFilters({
      assigneeIds: [], q: '', due: 'custom', priority: [], priorityFilterEnabled: false,
      projectIds: [], statusIds: [], trackerIds: [],
    }, '2026-10-01');
    expect(scope.due_days).toBe(7);
    expect(scope.date_anchor).toBe('2026-10-01');
  });

  it('builds the complete mutation scope without a requested entity limit', () => {
    expect(buildBoardMutationUrl('/projects/demo/kanban', '/issues/bulk', {
      projectIds: [7, 3, 7],
      scopeStatusIds: [4, 2],
      dependencyStatusIds: [5, 2],
    })).toBe('/projects/demo/kanban/issues/bulk?project_ids%5B%5D=3&project_ids%5B%5D=7&scope_status_ids_present=1&scope_status_ids%5B%5D=2&scope_status_ids%5B%5D=4&dependency_status_ids_present=1&dependency_status_ids%5B%5D=2&dependency_status_ids%5B%5D=5&filter_q=&filter_include_unassigned=0&filter_priority_enabled=0&filter_include_no_priority=0&filter_due=all');
  });

  it('encodes nonempty entity reconciliation scope explicitly', () => {
    expect(buildBoardEntitiesUrl('/projects/demo/kanban', [2, 1], [9], [3, 2])).toBe('/projects/demo/kanban/issues/entities?project_ids%5B%5D=1&project_ids%5B%5D=2&ids%5B%5D=9&scope_status_ids_present=1&scope_status_ids%5B%5D=2&scope_status_ids%5B%5D=3&dependency_status_ids_present=1&dependency_status_ids%5B%5D=2&dependency_status_ids%5B%5D=3&filter_q=&filter_include_unassigned=0&filter_priority_enabled=0&filter_include_no_priority=0&filter_due=all');
  });

  it('preserves explicit empty scope in entity reconciliation', () => {
    expect(buildBoardEntitiesUrl('/projects/demo/kanban', [2, 1], [9], [])).toBe('/projects/demo/kanban/issues/entities?project_ids%5B%5D=1&project_ids%5B%5D=2&ids%5B%5D=9&scope_status_ids_present=1&dependency_status_ids_present=1&filter_q=&filter_include_unassigned=0&filter_priority_enabled=0&filter_include_no_priority=0&filter_due=all');
    const params = new URLSearchParams();
    appendScopeStatusParams(params, []);
    expect(params.toString()).toBe('scope_status_ids_present=1');
  });
});
