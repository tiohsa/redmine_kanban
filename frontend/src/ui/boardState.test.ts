import { describe, expect, it } from 'vitest';
import type { BoardData, Issue } from './types';
import {
  applyBoardResponse,
  createNormalizedBoardState,
  selectBoardIssues,
  type BoardResponse,
  type NormalizedBoardState,
} from './boardState';

function issue(id: number, overrides: Partial<Issue> = {}): Issue {
  return {
    id,
    subject: `Issue ${id}`,
    status_id: 1,
    status_is_closed: false,
    tracker_id: 1,
    description: '',
    assigned_to_id: null,
    lock_version: 1,
    urls: { issue: `/issues/${id}`, issue_edit: `/issues/${id}/edit` },
    ...overrides,
  };
}

function board(issues: Issue[]): BoardData {
  return {
    ok: true,
    meta: {
      project_id: 1,
      project_ids: [1],
      current_user_id: 1,
      can_move: true,
      can_create: true,
      can_delete: true,
      lane_type: 'assignee',
      aging_warn_days: 7,
      aging_danger_days: 14,
      aging_exclude_closed: false,
    },
    columns: [{ id: 1, name: 'Open', is_closed: false }],
    lanes: [],
    lists: { assignees: [], trackers: [], priorities: [], projects: [], viewable_projects: [], creatable_projects: [] },
    issues,
    labels: {},
  };
}

function root(state: NormalizedBoardState, id: number) {
  return state.entitiesById.get(id);
}

describe('normalized board state', () => {
  it('merges an equal-version entity when the response adds fields', () => {
    const current = board([issue(1, { subject: 'Current', description: '' })]);
    const next = applyBoardResponse(createNormalizedBoardState(current), {
      kind: 'mutation',
      issue_updates: [issue(1, { subject: 'Enriched', description: 'Loaded by reconciliation', lock_version: 1 })],
      scopeFingerprint: current.meta.scope_fingerprint,
    });

    expect(next.entitiesById.get(1)).toMatchObject({
      subject: 'Current',
      description: 'Loaded by reconciliation',
      lock_version: 1,
    });
  });

  it('stores one entity for a root and its recursive child', () => {
    const state = createNormalizedBoardState(board([
      issue(1, { subtasks: [issue(2, { parent_id: 1 }) as never] }),
      issue(2, { parent_id: null, subject: 'Duplicate representation' }),
    ]));

    expect(state.entitiesById.size).toBe(2);
    expect(root(state, 2)?.subject).toBe('Issue 2');
    expect(state.tree.childrenByParentId.get(1)).toEqual([2]);
    expect(state.tree.rootCandidateIds).toEqual([1]);
  });

  it('merges a partial response without replacing an existing complete subtree', () => {
    const initial = createNormalizedBoardState(board([
      issue(1, { subtasks: [issue(2, { parent_id: 1 }) as never] }),
    ]));
    initial.tree.parentStates.set(1, { completeness: 'complete', nextCursor: null, loadedCount: 1 });

    const partial: BoardResponse = {
      kind: 'tree_page',
      issues: [issue(1, { subtasks: [] })],
      parentId: 1,
      completeness: 'partial',
      nextCursor: 'cursor-2',
    };

    const next = applyBoardResponse(initial, partial);
    expect(next.tree.childrenByParentId.get(1)).toEqual([2]);
    expect(next.tree.parentStates.get(1)).toEqual({ completeness: 'complete', nextCursor: null, loadedCount: 1 });
  });

  it('rejects stale scalar entities and stale tree pages', () => {
    const initial = createNormalizedBoardState(board([issue(1, { lock_version: 4, updated_on: '2026-08-01T00:00:00Z' })]));
    const response: BoardResponse = {
      kind: 'mutation',
      issue_updates: [issue(1, { subject: 'Old', lock_version: 3, updated_on: '2026-07-31T00:00:00Z' })],
      operationId: 'older-operation',
      scopeFingerprint: initial.scope.fingerprint,
    };

    const next = applyBoardResponse(initial, response);
    expect(root(next, 1)?.subject).toBe('Issue 1');
  });

  it('is idempotent and does not let the root cursor move backwards', () => {
    const initial = createNormalizedBoardState(board([issue(1)]));
    const page: BoardResponse = {
      kind: 'root_page',
      issues: [issue(2, { updated_on: '2026-07-30T00:00:00Z' })],
      nextCursor: 'cursor-2',
      scopeFingerprint: initial.scope.fingerprint,
    };

    const once = applyBoardResponse(initial, page);
    const twice = applyBoardResponse(once, page);
    const older = applyBoardResponse(twice, { ...page, nextCursor: 'cursor-1' });

    expect(selectBoardIssues(twice)).toEqual(selectBoardIssues(once));
    expect(older.rootPage.nextCursor).toBe('cursor-2');
    expect(older.entitiesById.size).toBe(2);
  });

  it('rejects responses from another scope', () => {
    const initial = createNormalizedBoardState(board([issue(1)]));
    const next = applyBoardResponse(initial, {
      kind: 'root_page',
      issues: [issue(2)],
      nextCursor: 'other-scope',
      scopeFingerprint: 'sha256:other',
    });

    expect(next.entitiesById.has(2)).toBe(false);
  });

  it('rejects a late tree page whose request cursor is no longer current', () => {
    const initial = createNormalizedBoardState(board([issue(1)]));
    initial.tree.parentStates.set(1, { completeness: 'partial', nextCursor: 'tree-2', loadedCount: 1 });

    const next = applyBoardResponse(initial, {
      kind: 'tree_page',
      parentId: 1,
      requestCursor: 'tree-1',
      issues: [issue(3, { parent_id: 1 }) as never],
      completeness: 'partial',
      nextCursor: 'tree-3',
      scopeFingerprint: initial.scope.fingerprint,
    });

    expect(next.entitiesById.has(3)).toBe(false);
    expect(next.tree.parentStates.get(1)?.nextCursor).toBe('tree-2');
  });

  it('does not resurrect an issue deleted before a late response arrives', () => {
    const initial = createNormalizedBoardState(board([issue(1)]));
    const deleted = applyBoardResponse(initial, {
      kind: 'mutation',
      deleted_issue_ids: [1],
    });
    const late = applyBoardResponse(deleted, {
      kind: 'root_page',
      issues: [issue(1, { subject: 'Late copy', lock_version: 99 })],
      nextCursor: 'root-2',
      scopeFingerprint: initial.scope.fingerprint,
    });

    expect(late.entitiesById.has(1)).toBe(false);
    expect(late.deletedIssueIds.has(1)).toBe(true);
  });

  it('keeps invariants through a deterministic response sequence and replay', () => {
    let state = createNormalizedBoardState(board([issue(1)]));
    const responses: BoardResponse[] = [
      { kind: 'root_page', issues: [issue(2)], nextCursor: 'root-2', hasMore: true },
      { kind: 'tree_page', parentId: 1, issues: [issue(3, { parent_id: 1 }) as never], completeness: 'complete' },
      { kind: 'mutation', issue_updates: [issue(1, { subject: 'Updated', lock_version: 2 })] },
      { kind: 'mutation', tree_changes: [{ type: 'attach', parent_id: 2, child_id: 3 }] },
      { kind: 'mutation', tree_changes: [{ type: 'detach', parent_id: 2, child_id: 3 }] },
      { kind: 'mutation', deleted_issue_ids: [2] },
    ];

    for (const response of responses) {
      const before = new Set(state.entitiesById.keys());
      state = applyBoardResponse(state, response);
      const parents = new Set<number>();
      for (const [parentId, children] of state.tree.childrenByParentId) {
        for (const childId of children) {
          expect(parents.has(childId)).toBe(false);
          parents.add(childId);
          expect(state.tree.parentByChildId.get(childId)).toBe(parentId);
        }
      }
      for (const id of before) {
        if (!(response.deleted_issue_ids ?? []).includes(id)) expect(state.entitiesById.has(id)).toBe(true);
      }
    }

    const replay = applyBoardResponse(state, responses[2]);
    expect(selectBoardIssues(replay)).toEqual(selectBoardIssues(state));
  });
});
