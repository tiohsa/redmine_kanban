import { describe, expect, it } from 'vitest';
import type { BoardData, Issue } from './types';
import { applyBoardResponse, createNormalizedBoardState, type BoardResponse, type NormalizedBoardState } from './boardState';

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
    updated_on: `2026-08-01T00:00:${String(id).padStart(2, '0')}Z`,
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
      scope_fingerprint: 'sha256:state-machine',
      current_user_id: 1,
      can_move: true,
      can_create: true,
      can_delete: true,
      lane_type: 'none',
      aging_warn_days: 7,
      aging_danger_days: 14,
      aging_exclude_closed: false,
    },
    columns: [{ id: 1, name: 'Open', is_closed: false, count: issues.length }],
    lanes: [],
    lists: { assignees: [], trackers: [], priorities: [], projects: [], viewable_projects: [], creatable_projects: [] },
    issues,
    labels: {},
  };
}

type Reference = {
  entities: Set<number>;
  edges: Set<string>;
  deleted: Set<number>;
};

function edgeKey(parentId: number, childId: number): string {
  return `${parentId}:${childId}`;
}

function collectReference(reference: Reference, value: Issue, parentId?: number): void {
  if (!reference.deleted.has(value.id)) reference.entities.add(value.id);
  if (parentId !== undefined && !reference.deleted.has(value.id)) reference.edges.add(edgeKey(parentId, value.id));
  for (const child of value.subtasks ?? []) collectReference(reference, child as unknown as Issue, value.id);
}

function applyReference(reference: Reference, response: BoardResponse): void {
  for (const value of response.issues ?? []) collectReference(reference, value, response.kind === 'tree_page' ? response.parentId : undefined);
  for (const value of response.issue_updates ?? []) collectReference(reference, value);
  for (const value of response.created_issues ?? []) collectReference(reference, value);
  for (const change of response.tree_changes ?? []) {
    const key = edgeKey(change.parent_id, change.child_id);
    if (change.type === 'attach' && reference.entities.has(change.child_id) && !reference.deleted.has(change.child_id)) reference.edges.add(key);
    if (change.type === 'detach') reference.edges.delete(key);
  }
  if (response.kind === 'tree_page' && response.parentId !== undefined && response.completeness === 'complete') {
    const authoritative = new Set((response.issues ?? []).map((value) => value.id));
    for (const edge of [...reference.edges]) {
      const [parentId, childId] = edge.split(':').map(Number);
      if (parentId === response.parentId && !authoritative.has(childId)) reference.edges.delete(edge);
    }
  }
  for (const id of response.deleted_issue_ids ?? []) {
    reference.deleted.add(id);
    reference.entities.delete(id);
    for (const edge of [...reference.edges]) {
      if (edge.split(':').map(Number).includes(id)) reference.edges.delete(edge);
    }
  }
}

function referenceFromState(state: NormalizedBoardState): Reference {
  return {
    entities: new Set(state.entitiesById.keys()),
    edges: new Set(Array.from(state.tree.childrenByParentId).flatMap(([parentId, children]) => children.map((childId) => edgeKey(parentId, childId)))),
    deleted: new Set(state.deletedIssueIds),
  };
}

function assertInvariants(state: NormalizedBoardState, reference: Reference): void {
  expect(new Set(state.entitiesById.keys())).toEqual(reference.entities);
  const actualEdges = new Set(
    Array.from(state.tree.childrenByParentId).flatMap(([parentId, children]) => children.map((childId) => edgeKey(parentId, childId))),
  );
  expect(actualEdges).toEqual(reference.edges);

  const seenChildren = new Set<number>();
  for (const [parentId, children] of state.tree.childrenByParentId) {
    expect(new Set(children).size).toBe(children.length);
    for (const childId of children) {
      expect(state.entitiesById.has(childId)).toBe(true);
      expect(seenChildren.has(childId)).toBe(false);
      seenChildren.add(childId);
      expect(state.tree.parentByChildId.get(childId)).toBe(parentId);
    }
  }
  for (const id of state.entitiesById.keys()) expect(state.deletedIssueIds.has(id)).toBe(false);
}

describe('normalized board state state-machine', () => {
  it('preserves entity, edge, deletion, freshness, and pagination invariants across an operation sequence', () => {
    let state = createNormalizedBoardState(board([issue(1, { subtasks: [issue(2, { parent_id: 1 }) as never] })]));
    state.tree.parentStates.set(1, { completeness: 'partial', nextCursor: 'tree-0', loadedCount: 1 });
    const reference = referenceFromState(state);
    const scopeFingerprint = state.scope.fingerprint;
    const responses: BoardResponse[] = [
      { kind: 'root_page', requestCursor: null, issues: [issue(3)], nextCursor: 'root-1', hasMore: true, scopeFingerprint },
      { kind: 'tree_page', parentId: 1, requestCursor: 'tree-0', issues: [issue(4, { parent_id: 1 })], completeness: 'partial', nextCursor: 'tree-1', scopeFingerprint },
      { kind: 'tree_page', parentId: 1, requestCursor: 'tree-1', issues: [issue(5, { parent_id: 1 })], completeness: 'complete', nextCursor: null, scopeFingerprint },
      { kind: 'mutation', operationId: 'create-child', created_issues: [issue(6, { parent_id: 1 })], tree_changes: [{ type: 'attach', parent_id: 1, child_id: 6 }], scopeFingerprint },
      { kind: 'mutation', operationId: 'update-parent', issue_updates: [issue(1, { subject: 'Updated parent', lock_version: 2 })], scopeFingerprint },
      { kind: 'mutation', operationId: 'delete-child', deleted_issue_ids: [4], tree_changes: [{ type: 'detach', parent_id: 1, child_id: 4 }], scopeFingerprint },
    ];

    for (const response of responses) {
      state = applyBoardResponse(state, response);
      applyReference(reference, response);
      assertInvariants(state, reference);
    }

    const afterSequence = state;
    const replay = responses.reduce((current, response) => applyBoardResponse(current, response), afterSequence);
    expect(replay.entitiesById).toEqual(afterSequence.entitiesById);
    expect(replay.tree.childrenByParentId).toEqual(afterSequence.tree.childrenByParentId);
    expect(replay.rootPage).toEqual(afterSequence.rootPage);

    const advanced = applyBoardResponse(replay, {
      kind: 'root_page',
      requestCursor: 'root-1',
      issues: [issue(7)],
      nextCursor: 'root-2',
      hasMore: true,
      scopeFingerprint,
    });
    const stale = applyBoardResponse(advanced, {
      kind: 'root_page',
      requestCursor: 'root-1',
      issues: [issue(8)],
      nextCursor: 'root-old',
      hasMore: true,
      scopeFingerprint,
    });
    expect(stale.entitiesById.has(8)).toBe(false);
    expect(stale.rootPage).toEqual(advanced.rootPage);

    const wrongScope = applyBoardResponse(replay, {
      kind: 'mutation',
      issue_updates: [issue(8)],
      scopeFingerprint: 'sha256:other-scope',
    });
    expect(wrongScope.entitiesById.has(8)).toBe(false);
  });
});
