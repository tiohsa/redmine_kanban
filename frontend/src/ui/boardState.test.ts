import { describe, expect, it } from 'vitest';
import { applyBoardResponse, createNormalizedBoardState, selectBoardData } from './boardState';
import type { BoardData, Issue } from './types';

const issue = (id: number, parent_id: number | null = null): Issue => ({
  id, parent_id, subject: `Issue ${id}`, status_id: 1, tracker_id: null, description: '', assigned_to_id: null,
  urls: { issue: `/issues/${id}`, issue_edit: `/issues/${id}/edit` }, subtasks: [], lock_version: 1,
});

const board = (issues: Issue[], scope_status_ids?: number[]): BoardData => ({
  ok: true, contract_version: 3, scope_fingerprint: 'sha256:test',
  meta: { project_id: 1, project_ids: [1], scope_status_ids, scope_fingerprint: 'sha256:test', current_user_id: 1, can_move: true, can_create: true, can_delete: true, lane_type: 'none', aging_warn_days: 7, aging_danger_days: 14, aging_exclude_closed: false, complete: true, entity_count: issues.length, requested_entity_limit: 1500, effective_entity_limit: 1500, server_entity_limit: 5000 },
  columns: [{ id: 1, name: 'Open', is_closed: false, count: issues.length }], lanes: [],
  lists: { assignees: [], trackers: [], priorities: [], projects: [], viewable_projects: [], creatable_projects: [] }, issues, labels: {},
});

describe('normalized snapshot state', () => {
  it('stores one entity per id and reconstructs the canonical tree', () => {
    const parent = issue(1);
    parent.subtasks = [issue(2, 1) as never];
    const data = selectBoardData(createNormalizedBoardState(board([parent])));
    expect(data.entities).toHaveLength(2);
    expect(data.tree?.root_ids).toEqual([1]);
    expect(data.tree?.children_by_parent_id['1']).toEqual([2]);
    expect(data.issues[0].subtasks?.[0].id).toBe(2);
  });

  it('rejects a mutation from a different scope without dropping fresh entities', () => {
    const initial = createNormalizedBoardState(board([issue(1)]));
    const rejected = applyBoardResponse(initial, { kind: 'mutation', scopeFingerprint: 'sha256:other', issue_updates: [issue(2)] });
    expect(selectBoardData(rejected).entities?.map((entity) => entity.id)).toEqual([1]);

    const accepted = applyBoardResponse(initial, { kind: 'mutation', scopeFingerprint: 'sha256:test', issue_updates: [issue(2)] });
    expect(selectBoardData(accepted).entities?.map((entity) => entity.id)).toEqual([1, 2]);
  });

  it('does not let a stale target response erase another fresh update', () => {
    const initial = createNormalizedBoardState(board([issue(1), issue(2)]));
    const next = applyBoardResponse(initial, { kind: 'mutation', issue_updates: [{ ...issue(1), subject: 'fresh', lock_version: 2 }, { ...issue(2), subject: 'fresh too', lock_version: 2 }] });
    const stale = applyBoardResponse(next, { kind: 'mutation', issue_updates: [{ ...issue(1), subject: 'old', lock_version: 1 }, { ...issue(2), subject: 'newer', lock_version: 3 }] });
    const data = selectBoardData(stale);
    expect(data.issues.find((candidate) => candidate.id === 1)?.subject).toBe('fresh');
    expect(data.issues.find((candidate) => candidate.id === 2)?.subject).toBe('newer');
  });

  it('evicts scope-leaving entities without tombstoning them and accepts re-entry', () => {
    const initial = createNormalizedBoardState(board([{ ...issue(1), project: { id: 1, name: 'Board' } }]));
    initial.scope.statusIds = [1];
    const evicted = applyBoardResponse(initial, {
      kind: 'mutation',
      evicted_issue_ids: [1],
      issue_updates: [{ ...issue(1), status_id: 2, project: { id: 1, name: 'Board' } }],
    });
    expect(selectBoardData(evicted).entities).toEqual([]);
    expect(selectBoardData(evicted).meta.complete).toBe(true);
    expect(evicted.deletedIssueIds.has(1)).toBe(false);

    const reentered = applyBoardResponse(evicted, { kind: 'mutation', issue_updates: [{ ...issue(1), lock_version: 2 }] });
    expect(selectBoardData(reentered).entities?.map((entity) => entity.id)).toEqual([1]);
  });

  it('keeps physical deletion tombstoned and rejects re-entry', () => {
    const initial = createNormalizedBoardState(board([issue(1)]));
    const deleted = applyBoardResponse(initial, { kind: 'mutation', deleted_issue_ids: [1] });
    expect(deleted.deletedIssueIds.has(1)).toBe(true);
    const reentered = applyBoardResponse(deleted, { kind: 'mutation', issue_updates: [{ ...issue(1), lock_version: 2 }] });
    expect(selectBoardData(reentered).entities).toEqual([]);
  });

  it('evicts an entity that leaves the project scope without creating a tombstone', () => {
    const initial = createNormalizedBoardState(board([{ ...issue(1), project: { id: 1, name: 'Board' } }]));
    const next = applyBoardResponse(initial, {
      kind: 'mutation',
      issue_updates: [{ ...issue(1), project: { id: 2, name: 'Other' }, lock_version: 2 }],
    });
    expect(selectBoardData(next).entities).toEqual([]);
    expect(next.deletedIssueIds.has(1)).toBe(false);
  });

  it('does not retain mutation entities in an explicit empty status scope', () => {
    const initial = createNormalizedBoardState(board([], []));
    const next = applyBoardResponse(initial, { kind: 'mutation', issue_updates: [issue(1)], created_issues: [issue(2)] });
    expect(selectBoardData(next).entities).toEqual([]);
    expect(next.deletedIssueIds.size).toBe(0);
  });

  it('falls back to column ids only for legacy snapshots without scope metadata', () => {
    expect(createNormalizedBoardState(board([])).scope.statusIds).toEqual([1]);
  });
});
