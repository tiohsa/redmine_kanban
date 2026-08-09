import type { BoardData, Issue } from './types';
import { normalizeTrackerId } from './kanbanShared';

export type IssueEntity = Omit<Issue, 'subtasks'>;
export type IssueEntityPatch = Partial<IssueEntity> & { is_closed?: boolean };

export type BoardTreeState = {
  rootCandidateIds: number[];
  childrenByParentId: Map<number, number[]>;
  parentByChildId: Map<number, number>;
};

export type NormalizedBoardState = {
  entitiesById: Map<number, IssueEntity>;
  deletedIssueIds: Set<number>;
  tree: BoardTreeState;
  scope: {
    fingerprint: string;
    projectIds: number[];
    statusIds: number[];
  };
  board: Omit<BoardData, 'issues'>;
};

export type TreeChange =
  | { type: 'attach'; parent_id: number; child_id: number }
  | { type: 'detach'; parent_id: number; child_id: number };

export type BoardResponse = {
  kind: 'mutation';
  issue_updates?: Issue[];
  created_issues?: Issue[];
  deleted_issue_ids?: number[];
  evicted_issue_ids?: number[];
  tree_changes?: TreeChange[];
  operationId?: string;
  scopeFingerprint?: string;
};

function entityOf(issue: Issue): IssueEntity {
  const { subtasks: _subtasks, ...entity } = issue;
  return issue.tracker_id === undefined
    ? entity
    : { ...entity, tracker_id: normalizeTrackerId(issue.tracker_id) };
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
  if (parentId === childId || !state.entitiesById.has(parentId) || !state.entitiesById.has(childId) || wouldCreateCycle(state, parentId, childId)) return;
  const previousParentId = state.tree.parentByChildId.get(childId);
  if (previousParentId !== undefined && previousParentId !== parentId) detachEdge(state, previousParentId, childId);
  state.tree.parentByChildId.set(childId, parentId);
  const children = state.tree.childrenByParentId.get(parentId) ?? [];
  if (!children.includes(childId)) state.tree.childrenByParentId.set(parentId, [...children, childId]);
  state.tree.rootCandidateIds = state.tree.rootCandidateIds.filter((id) => id !== childId);
}

function detachEdge(state: NormalizedBoardState, parentId: number, childId: number): void {
  if (state.tree.parentByChildId.get(childId) !== parentId) return;
  state.tree.parentByChildId.delete(childId);
  state.tree.childrenByParentId.set(parentId, (state.tree.childrenByParentId.get(parentId) ?? []).filter((id) => id !== childId));
}

function mergeEntity(state: NormalizedBoardState, issue: Issue): boolean {
  const incoming = entityOf(issue);
  if (state.deletedIssueIds.has(incoming.id) || !isFresh(state.entitiesById.get(incoming.id), incoming)) return false;
  const current = state.entitiesById.get(incoming.id);
  if (!current || !sameRevision(current, incoming)) {
    state.entitiesById.set(incoming.id, { ...current, ...incoming });
    return true;
  }

  const enriched = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    const currentValue = enriched[key as keyof IssueEntity];
    if ((currentValue === undefined || currentValue === null || currentValue === '') && value !== undefined) {
      (enriched as Record<string, unknown>)[key] = value;
    }
  }
  state.entitiesById.set(incoming.id, enriched);
  return true;
}

function collectIssue(state: NormalizedBoardState, issue: Issue, parentId?: number, rootCandidate = false): void {
  mergeEntity(state, issue);
  if (rootCandidate && !state.tree.rootCandidateIds.includes(issue.id)) state.tree.rootCandidateIds.push(issue.id);
  const effectiveParentId = parentId;
  if (effectiveParentId !== undefined) attachEdge(state, effectiveParentId, issue.id);
  for (const child of issue.subtasks ?? []) collectIssue(state, child as unknown as Issue, issue.id);
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
    },
  scope: { ...state.scope, projectIds: [...state.scope.projectIds], statusIds: [...state.scope.statusIds] },
  };
}

function scopeFingerprint(data: BoardData): string {
  return data.scope_fingerprint ?? data.meta.scope_fingerprint ?? `project:${(data.meta.project_ids ?? [data.meta.project_id]).join(',')}`;
}

export function createNormalizedBoardState(data: BoardData): NormalizedBoardState {
  const { issues: _issues, ...board } = data;
  const state: NormalizedBoardState = {
    entitiesById: new Map(),
    deletedIssueIds: new Set(),
    tree: { rootCandidateIds: [], childrenByParentId: new Map(), parentByChildId: new Map() },
    scope: {
      fingerprint: scopeFingerprint(data),
      projectIds: [...(data.meta.project_ids ?? [data.meta.project_id])],
      statusIds: [...(data.meta.scope_status_ids ?? data.columns.map((column) => column.id))],
    },
    board,
  };
  for (const issue of data.issues) collectIssue(state, issue, undefined, true);
  state.tree.rootCandidateIds = state.tree.rootCandidateIds.filter((id) => !state.tree.parentByChildId.has(id));
  return state;
}

function shouldAcceptResponse(state: NormalizedBoardState, response: BoardResponse): boolean {
  return !response.scopeFingerprint || response.scopeFingerprint === state.scope.fingerprint;
}

function evictEntity(state: NormalizedBoardState, id: number, tombstone = false): void {
  state.entitiesById.delete(id);
  if (tombstone) state.deletedIssueIds.add(id);
  state.tree.rootCandidateIds = state.tree.rootCandidateIds.filter((candidateId) => candidateId !== id);
  const parentId = state.tree.parentByChildId.get(id);
  if (parentId !== undefined) detachEdge(state, parentId, id);
  for (const childId of state.tree.childrenByParentId.get(id) ?? []) {
    state.tree.parentByChildId.delete(childId);
    if (state.entitiesById.has(childId) && !state.tree.rootCandidateIds.includes(childId)) state.tree.rootCandidateIds.push(childId);
  }
  state.tree.childrenByParentId.delete(id);
}

function outsideScope(state: NormalizedBoardState, issue: Issue): boolean {
  const projectIds = state.scope.projectIds;
  const statusIds = state.scope.statusIds;
  return (issue.project?.id !== undefined && !projectIds.includes(issue.project.id))
    || !statusIds.includes(issue.status_id);
}

function reconcileParent(state: NormalizedBoardState, issue: Issue): void {
  if (!Object.prototype.hasOwnProperty.call(issue, 'parent_id')) return;
  const oldParentId = state.tree.parentByChildId.get(issue.id);
  if (oldParentId !== undefined) detachEdge(state, oldParentId, issue.id);
  const newParentId = issue.parent_id ?? undefined;
  if (newParentId !== undefined && state.entitiesById.has(newParentId)) attachEdge(state, newParentId, issue.id);
  else if (!state.tree.rootCandidateIds.includes(issue.id)) state.tree.rootCandidateIds.push(issue.id);
}

export function applyBoardResponse(previous: NormalizedBoardState, response: BoardResponse): NormalizedBoardState {
  if (!shouldAcceptResponse(previous, response)) return previous;
  const state = copyState(previous);

  for (const issue of response.issue_updates ?? []) {
    if (outsideScope(state, issue)) evictEntity(state, issue.id);
    else if (mergeEntity(state, issue)) reconcileParent(state, issue);
  }
  for (const issue of response.created_issues ?? []) {
    if (outsideScope(state, issue)) evictEntity(state, issue.id);
    else if (mergeEntity(state, issue)) {
      const parentId = issue.parent_id ?? undefined;
      if (parentId !== undefined && state.entitiesById.has(parentId)) attachEdge(state, parentId, issue.id);
      else if (!state.tree.rootCandidateIds.includes(issue.id)) state.tree.rootCandidateIds.push(issue.id);
    }
  }
  for (const change of response.tree_changes ?? []) {
    if (change.type === 'attach') attachEdge(state, change.parent_id, change.child_id);
    else detachEdge(state, change.parent_id, change.child_id);
  }
  for (const id of response.deleted_issue_ids ?? []) {
    evictEntity(state, id, true);
  }
  for (const id of response.evicted_issue_ids ?? []) {
    evictEntity(state, id);
  }
  return state;
}

function toIssue(state: NormalizedBoardState, id: number, path: Set<number>): Issue | null {
  const entity = state.entitiesById.get(id);
  if (!entity || path.has(id)) return null;
  const nextPath = new Set(path).add(id);
  const subtasks = (state.tree.childrenByParentId.get(id) ?? [])
    .map((childId) => toIssue(state, childId, nextPath))
    .filter((child): child is Issue => child !== null)
    .map((child) => child as unknown as NonNullable<Issue['subtasks']>[number]);
  return { ...entity, subtasks };
}

export function selectBoardIssues(state: NormalizedBoardState): Issue[] {
  return state.tree.rootCandidateIds
    .filter((id) => !state.tree.parentByChildId.has(id))
    .map((id) => toIssue(state, id, new Set()))
    .filter((issue): issue is Issue => issue !== null);
}

export function selectBoardData(state: NormalizedBoardState): BoardData {
  const rootIds = state.tree.rootCandidateIds.filter((id) => !state.tree.parentByChildId.has(id));
  const tree = {
    root_ids: rootIds,
    children_by_parent_id: Object.fromEntries(Array.from(state.tree.childrenByParentId, ([parentId, childIds]) => [String(parentId), childIds])),
  };
  return {
    ...(state.board as BoardData),
    scope_fingerprint: state.scope.fingerprint,
    meta: { ...state.board.meta, project_ids: state.scope.projectIds, scope_status_ids: state.scope.statusIds, entity_count: state.entitiesById.size, complete: true },
    entities: Array.from(state.entitiesById.values()),
    tree,
    issues: selectBoardIssues(state),
  };
}

export function reduceBoardData(data: BoardData, response: BoardResponse): BoardData {
  return selectBoardData(applyBoardResponse(createNormalizedBoardState(data), response));
}

export function applyLocalIssuePatch(data: BoardData, issueId: number, patch: IssueEntityPatch): BoardData {
  const state = createNormalizedBoardState(data);
  const current = state.entitiesById.get(issueId);
  if (!current) return data;
  const normalizedPatch = patch.tracker_id === undefined ? patch : { ...patch, tracker_id: normalizeTrackerId(patch.tracker_id) };
  state.entitiesById.set(issueId, { ...current, ...normalizedPatch });
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

export function rollbackLocalIssuePatch(data: BoardData, issueId: number, previous: Issue, optimistic: Issue): BoardData {
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
