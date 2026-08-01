import type { BoardData, Issue } from './types';

export type IssueEntity = Omit<Issue, 'subtasks'>;
export type IssueEntityPatch = Partial<IssueEntity> & { is_closed?: boolean };

export type TreeCompleteness = 'complete' | 'partial' | 'unexpanded';

export type ParentTreeState = {
  completeness: TreeCompleteness;
  nextCursor: string | null;
  loadedCount: number;
};

export type BoardTreeState = {
  rootCandidateIds: number[];
  childrenByParentId: Map<number, number[]>;
  parentByChildId: Map<number, number>;
  parentStates: Map<number, ParentTreeState>;
};

export type NormalizedBoardState = {
  entitiesById: Map<number, IssueEntity>;
  deletedIssueIds: Set<number>;
  tree: BoardTreeState;
  rootPage: {
    nextCursor: string | null;
    hasMore: boolean;
    lastSequence: number;
  };
  scope: {
    fingerprint: string;
    projectIds: number[];
  };
  board: Omit<BoardData, 'issues'>;
};

export type TreeChange =
  | { type: 'attach'; parent_id: number; child_id: number }
  | { type: 'detach'; parent_id: number; child_id: number };

export type BoardResponse = {
  kind: 'initial' | 'root_page' | 'tree_page' | 'mutation';
  issues?: Issue[];
  issue_updates?: Issue[];
  created_issues?: Issue[];
  deleted_issue_ids?: number[];
  tree_changes?: TreeChange[];
  parentId?: number;
  completeness?: TreeCompleteness;
  nextCursor?: string | null;
  hasMore?: boolean;
  requestCursor?: string | null;
  sequence?: number;
  operationId?: string;
  scopeFingerprint?: string;
  invalidations?: {
    issue_ids?: number[];
    parent_ids?: number[];
  };
};

function entityOf(issue: Issue): IssueEntity {
  const { subtasks: _subtasks, ...entity } = issue;
  return entity;
}

function isFresh(current: IssueEntity | undefined, incoming: IssueEntity): boolean {
  if (!current) return true;
  if (typeof current.lock_version === 'number' && typeof incoming.lock_version === 'number') {
    return incoming.lock_version >= current.lock_version;
  }
  if (current.updated_on && incoming.updated_on) {
    const currentTime = Date.parse(current.updated_on);
    const incomingTime = Date.parse(incoming.updated_on);
    if (!Number.isNaN(currentTime) && !Number.isNaN(incomingTime)) return incomingTime >= currentTime;
  }
  return true;
}

function mergeEntity(state: NormalizedBoardState, issue: Issue): void {
  const incoming = entityOf(issue);
  if (state.deletedIssueIds.has(incoming.id)) return;
  const current = state.entitiesById.get(incoming.id);
  if (isFresh(current, incoming)) {
    if (!current || !sameRevision(current, incoming)) {
      state.entitiesById.set(incoming.id, { ...current, ...incoming });
      return;
    }

    // Equal-version representations can occur when a root page also contains
    // the same issue nested under another root. Keep the first authoritative
    // value, but allow a later partial/reconciliation entity to fill fields
    // that were not loaded previously.
    const enriched = { ...current };
    for (const [key, value] of Object.entries(incoming)) {
      const currentValue = enriched[key as keyof IssueEntity];
      if ((currentValue === undefined || currentValue === null || currentValue === '') && value !== undefined) {
        (enriched as Record<string, unknown>)[key] = value;
      }
    }
    state.entitiesById.set(incoming.id, enriched);
  }
}

function sameRevision(current: IssueEntity, incoming: IssueEntity): boolean {
  if (typeof current.lock_version === 'number' && typeof incoming.lock_version === 'number') {
    return current.lock_version === incoming.lock_version;
  }
  if (current.updated_on && incoming.updated_on) {
    const currentTime = Date.parse(current.updated_on);
    const incomingTime = Date.parse(incoming.updated_on);
    return !Number.isNaN(currentTime) && currentTime === incomingTime;
  }
  return false;
}

function wouldCreateCycle(state: NormalizedBoardState, parentId: number, childId: number): boolean {
  const seen = new Set<number>([childId]);
  let current: number | undefined = parentId;
  while (current !== undefined) {
    if (seen.has(current)) return true;
    seen.add(current);
    current = state.tree.parentByChildId.get(current);
  }
  return false;
}

function attachEdge(state: NormalizedBoardState, parentId: number, childId: number): void {
  if (parentId === childId || !state.entitiesById.has(childId) || wouldCreateCycle(state, parentId, childId)) return;
  const previousParentId = state.tree.parentByChildId.get(childId);
  if (previousParentId !== undefined && previousParentId !== parentId) return;
  state.tree.parentByChildId.set(childId, parentId);
  const children = state.tree.childrenByParentId.get(parentId) ?? [];
  if (!children.includes(childId)) state.tree.childrenByParentId.set(parentId, [...children, childId]);
}

function detachEdge(state: NormalizedBoardState, parentId: number, childId: number): void {
  if (state.tree.parentByChildId.get(childId) !== parentId) return;
  state.tree.parentByChildId.delete(childId);
  state.tree.childrenByParentId.set(
    parentId,
    (state.tree.childrenByParentId.get(parentId) ?? []).filter((id) => id !== childId),
  );
}

function collectIssue(state: NormalizedBoardState, issue: Issue, parentId?: number, rootCandidate = false): void {
  mergeEntity(state, issue);
  if (rootCandidate && !state.tree.rootCandidateIds.includes(issue.id)) {
    state.tree.rootCandidateIds.push(issue.id);
  }
  if (parentId !== undefined) attachEdge(state, parentId, issue.id);
  for (const child of (issue.subtasks ?? []) as unknown as Issue[]) collectIssue(state, child, issue.id);
}

function copyState(state: NormalizedBoardState): NormalizedBoardState {
  return {
    ...state,
    entitiesById: new Map(state.entitiesById),
    deletedIssueIds: new Set(state.deletedIssueIds),
    tree: {
      rootCandidateIds: [...state.tree.rootCandidateIds],
      childrenByParentId: new Map(Array.from(state.tree.childrenByParentId, ([id, children]) => [id, [...children]])),
      parentByChildId: new Map(state.tree.parentByChildId),
      parentStates: new Map(Array.from(state.tree.parentStates, ([id, parent]) => [id, { ...parent }])),
    },
    rootPage: { ...state.rootPage },
    scope: { ...state.scope, projectIds: [...state.scope.projectIds] },
  };
}

function scopeFingerprint(data: BoardData): string {
  return data.meta.scope_fingerprint ?? `project:${(data.meta.project_ids ?? [data.meta.project_id]).join(',')}`;
}

function incompleteParentIds(tree: BoardData['meta']['tree']): Set<number> {
  return new Set([
    ...(tree?.truncated_parent_ids ?? []),
    ...(tree?.unexpanded_parent_ids ?? []),
  ]);
}

export function createNormalizedBoardState(data: BoardData): NormalizedBoardState {
  const { issues: _issues, ...board } = data;
  const state: NormalizedBoardState = {
    entitiesById: new Map(),
    deletedIssueIds: new Set(),
    tree: { rootCandidateIds: [], childrenByParentId: new Map(), parentByChildId: new Map(), parentStates: new Map() },
    rootPage: {
      nextCursor: data.meta.pagination?.next_cursor ?? null,
      hasMore: data.meta.pagination?.has_more_issues ?? false,
      lastSequence: 0,
    },
    scope: {
      fingerprint: scopeFingerprint(data),
      projectIds: [...(data.meta.project_ids ?? [data.meta.project_id])],
    },
    board,
  };
  for (const issue of data.issues) collectIssue(state, issue, undefined, true);
  const incompleteIds = incompleteParentIds(data.meta.tree);
  for (const parentId of state.tree.childrenByParentId.keys()) {
    state.tree.parentStates.set(parentId, {
      completeness: incompleteIds.has(parentId) ? 'partial' : 'complete',
      nextCursor: null,
      loadedCount: state.tree.childrenByParentId.get(parentId)?.length ?? 0,
    });
  }
  for (const [parentId, parentState] of Object.entries(data.meta.tree?.parent_states ?? {})) {
    state.tree.parentStates.set(Number(parentId), {
      completeness: parentState.completeness,
      nextCursor: parentState.next_cursor,
      loadedCount: parentState.loaded_count,
    });
  }
  for (const parentId of incompleteIds) {
    if (!state.tree.parentStates.has(parentId)) {
      state.tree.parentStates.set(parentId, {
        completeness: 'partial',
        nextCursor: null,
        loadedCount: state.tree.childrenByParentId.get(parentId)?.length ?? 0,
      });
    }
  }
  state.tree.rootCandidateIds = state.tree.rootCandidateIds.filter((id) => !state.tree.parentByChildId.has(id));
  return state;
}

function shouldAcceptPage(state: NormalizedBoardState, response: BoardResponse): boolean {
  if (response.scopeFingerprint && response.scopeFingerprint !== state.scope.fingerprint) return false;
  if (response.kind === 'mutation' || response.kind === 'initial') return true;
  if (response.sequence !== undefined && response.sequence < state.rootPage.lastSequence) return false;
  if (response.requestCursor !== undefined) {
    const expectedCursor = response.kind === 'tree_page'
      ? (response.parentId === undefined ? null : state.tree.parentStates.get(response.parentId)?.nextCursor ?? null)
      : state.rootPage.nextCursor;
    if (response.requestCursor !== expectedCursor) return false;
  }
  if (response.kind === 'root_page' && response.requestCursor === undefined && state.rootPage.nextCursor && response.nextCursor !== state.rootPage.nextCursor) return false;
  return true;
}

function applyParentPage(state: NormalizedBoardState, response: BoardResponse): void {
  if (response.parentId === undefined) return;
  const current = state.tree.parentStates.get(response.parentId);
  if (current?.completeness === 'complete' && response.completeness === 'partial') return;
  const children = state.tree.childrenByParentId.get(response.parentId) ?? [];
  state.tree.parentStates.set(response.parentId, {
    completeness: response.completeness ?? 'partial',
    nextCursor: response.nextCursor ?? null,
    loadedCount: children.length,
  });
}

export function applyBoardResponse(previous: NormalizedBoardState, response: BoardResponse): NormalizedBoardState {
  if (!shouldAcceptPage(previous, response)) return previous;
  const state = copyState(previous);

  for (const issue of response.issues ?? []) {
    collectIssue(state, issue, response.kind === 'tree_page' ? response.parentId : undefined, response.kind !== 'tree_page');
  }
  for (const issue of response.issue_updates ?? []) mergeEntity(state, issue);
  for (const issue of response.created_issues ?? []) collectIssue(state, issue);

  if (response.kind === 'tree_page' && response.parentId !== undefined && response.completeness === 'complete') {
    const authoritativeChildIds = new Set((response.issues ?? []).map((issue) => issue.id));
    for (const childId of state.tree.childrenByParentId.get(response.parentId) ?? []) {
      if (!authoritativeChildIds.has(childId)) detachEdge(state, response.parentId, childId);
    }
  }

  for (const change of response.tree_changes ?? []) {
    if (change.type === 'attach') attachEdge(state, change.parent_id, change.child_id);
    else detachEdge(state, change.parent_id, change.child_id);
  }
  for (const id of response.deleted_issue_ids ?? []) {
    state.deletedIssueIds.add(id);
    state.entitiesById.delete(id);
    state.tree.rootCandidateIds = state.tree.rootCandidateIds.filter((candidateId) => candidateId !== id);
    const parentId = state.tree.parentByChildId.get(id);
    if (parentId !== undefined) detachEdge(state, parentId, id);
    for (const childId of state.tree.childrenByParentId.get(id) ?? []) state.tree.parentByChildId.delete(childId);
    state.tree.childrenByParentId.delete(id);
  }

  if (response.kind === 'tree_page') applyParentPage(state, response);
  if (response.kind === 'root_page') {
    state.rootPage = {
      nextCursor: response.nextCursor === undefined ? state.rootPage.nextCursor : response.nextCursor,
      hasMore: response.hasMore === undefined ? state.rootPage.hasMore : response.hasMore,
      lastSequence: response.sequence ?? state.rootPage.lastSequence,
    };
  }
  return state;
}

export function reduceBoardData(data: BoardData, response: BoardResponse): BoardData {
  return selectBoardData(applyBoardResponse(createNormalizedBoardState(data), response));
}

function toIssue(state: NormalizedBoardState, id: number, path: Set<number>): Issue | null {
  const entity = state.entitiesById.get(id);
  if (!entity || path.has(id)) return null;
  const nextPath = new Set(path).add(id);
  const subtasks = (state.tree.childrenByParentId.get(id) ?? [])
    .map((childId) => toIssue(state, childId, nextPath))
    .filter((child): child is Issue => child !== null);
  return { ...entity, subtasks: subtasks as unknown as Issue['subtasks'] };
}

export function selectBoardIssues(state: NormalizedBoardState): Issue[] {
  return state.tree.rootCandidateIds
    .filter((id) => !state.tree.parentByChildId.has(id))
    .map((id) => toIssue(state, id, new Set()))
    .filter((issue): issue is Issue => issue !== null);
}

export function selectBoardData(state: NormalizedBoardState): BoardData {
  const partialParentIds = Array.from(state.tree.parentStates)
    .filter(([, parent]) => parent.completeness !== 'complete')
    .map(([parentId]) => parentId)
    .sort((left, right) => left - right);
  const tree = state.board.meta.tree
      ? {
        ...state.board.meta.tree,
        truncated: partialParentIds.length > 0,
        truncated_parent_ids: partialParentIds,
        unexpanded_parent_ids: (state.board.meta.tree.unexpanded_parent_ids ?? [])
          .filter((parentId) => partialParentIds.includes(parentId)),
        unique_node_count: state.entitiesById.size,
        serialized_node_count: state.entitiesById.size,
        duplicate_node_count: 0,
        parent_states: Object.fromEntries(Array.from(state.tree.parentStates, ([parentId, parent]) => [String(parentId), {
          completeness: parent.completeness,
          next_cursor: parent.nextCursor,
          loaded_count: parent.loadedCount,
        }])),
      }
    : undefined;
  return {
    ...(state.board as BoardData),
    meta: {
      ...state.board.meta,
      project_ids: state.scope.projectIds,
      scope_fingerprint: state.scope.fingerprint,
      ...(tree ? { tree } : {}),
      pagination: {
        ...(state.board.meta.pagination ?? { issue_limit: 0, offset: 0, issue_count: 0, total_issue_count: 0, next_offset: 0, has_more_issues: false }),
        next_cursor: state.rootPage.nextCursor,
        has_more_issues: state.rootPage.hasMore,
      },
    },
    issues: selectBoardIssues(state),
  };
}

export function applyLocalIssuePatch(
  data: BoardData,
  issueId: number,
  patch: IssueEntityPatch,
): BoardData {
  const state = createNormalizedBoardState(data);
  const current = state.entitiesById.get(issueId);
  if (!current) return data;
  state.entitiesById.set(issueId, { ...current, ...patch });

  if (patch.status_id !== undefined && patch.status_id !== current.status_id) {
    state.board = {
      ...state.board,
      columns: state.board.columns.map((column) => {
        if (column.id === current.status_id) return { ...column, count: Math.max(0, (column.count ?? 0) - 1) };
        if (column.id === patch.status_id) return { ...column, count: (column.count ?? 0) + 1 };
        return column;
      }),
    };
  }
  return selectBoardData(state);
}

export function rollbackLocalIssuePatch(
  data: BoardData,
  issueId: number,
  previous: Issue,
  optimistic: Issue,
): BoardData {
  const current = createNormalizedBoardState(data).entitiesById.get(issueId);
  if (!current) return data;
  const patch: IssueEntityPatch = {};
  const currentValues = current as Record<string, unknown>;
  const optimisticValues = optimistic as unknown as Record<string, unknown>;
  const previousValues = previous as unknown as Record<string, unknown>;
  for (const key of Object.keys(optimistic) as Array<keyof IssueEntityPatch>) {
    if (currentValues[key] !== optimisticValues[key]) continue;
    (patch as Record<string, unknown>)[key] = previousValues[key];
  }
  return applyLocalIssuePatch(data, issueId, patch);
}
