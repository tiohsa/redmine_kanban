import { describe, expect, it } from 'vitest';
import {
  applyBoardResponse,
  createNormalizedBoardState,
  selectBoardData,
  type BoardResponse,
  type NormalizedBoardState,
} from './boardState';
import { normalizeMaximumBoardEntityCount, parseMaximumBoardEntityCount } from './useKanbanPreferences';
import type { BoardData, Issue } from './types';

type ModelEntity = {
  id: number;
  parentId: number | null;
  lockVersion: number | undefined;
  updatedOn: string | null | undefined;
  value: string;
  projectId: number | undefined;
};

type ModelState = {
  scope: string;
  projectIds: number[];
  limit: number;
  complete: boolean;
  entities: Map<number, ModelEntity>;
  roots: number[];
  childrenByParentId: Map<number, number[]>;
  deletedIds: Set<number>;
};

type Operation =
  | { type: 'loadSnapshot' | 'changeScope' | 'nativeReset'; board: BoardData }
  | { type: 'applyMutation' | 'applyStaleMutation' | 'retryMutation'; response: BoardResponse }
  | { type: 'scopeEvict' | 'physicalDelete'; issueId: number; scopeFingerprint: string };

type Projection = {
  entityIds: number[];
  revisions: Array<[number, number | undefined, string | null | undefined, string]>;
  relations: Array<[number, number[]]>;
  rootIds: number[];
  deletedIds: number[];
  scope: string;
  complete: boolean;
  limit: number;
};

const issue = (
  id: number,
  parent_id: number | null = null,
  lock_version = 1,
  subject = `Issue ${id}`,
  projectId = 1,
): Issue => ({
  id,
  parent_id,
  subject,
  status_id: 1,
  tracker_id: null,
  description: '',
  assigned_to_id: null,
  urls: { issue: `/issues/${id}`, issue_edit: `/issues/${id}/edit` },
  subtasks: [],
  lock_version,
  updated_on: `2026-08-10T00:00:${String(lock_version).padStart(2, '0')}Z`,
  project: { id: projectId, name: `Project ${projectId}` },
});

function countIssues(issues: Issue[]): number {
  return issues.reduce((count, current) => count + 1 + (current.subtasks ? countSubtasks(current.subtasks) : 0), 0);
}

function countSubtasks(subtasks: NonNullable<Issue['subtasks']>): number {
  return subtasks.reduce((count, current) => count + 1 + (current.subtasks ? countSubtasks(current.subtasks as never) : 0), 0);
}

function board(
  issues: Issue[],
  scopeFingerprint: string,
  projectIds: number[],
  limit = 4,
): BoardData {
  const entityCount = countIssues(issues);
  return {
    ok: true,
    contract_version: 3,
    scope_fingerprint: scopeFingerprint,
    meta: {
      project_id: projectIds[0] ?? 1,
      project_ids: projectIds,
      scope_fingerprint: scopeFingerprint,
      current_user_id: 1,
      can_move: true,
      can_create: true,
      can_delete: true,
      lane_type: 'none',
      aging_warn_days: 7,
      aging_danger_days: 14,
      aging_exclude_closed: false,
      complete: true,
      entity_count: entityCount,
      requested_entity_limit: limit,
      effective_entity_limit: limit,
      server_entity_limit: 5000,
    },
    columns: [{ id: 1, name: 'Open', is_closed: false, count: entityCount }],
    lanes: [],
    lists: { assignees: [], trackers: [], priorities: [], projects: [], viewable_projects: [], creatable_projects: [] },
    issues,
    labels: {},
  };
}

function modelEntityFromIssue(nextIssue: Issue, current?: ModelEntity): ModelEntity {
  return {
    id: nextIssue.id,
    parentId: Object.prototype.hasOwnProperty.call(nextIssue, 'parent_id')
      ? nextIssue.parent_id ?? null
      : current?.parentId ?? null,
    lockVersion: nextIssue.lock_version,
    updatedOn: nextIssue.updated_on,
    value: nextIssue.subject,
    projectId: nextIssue.project?.id ?? current?.projectId,
  };
}

function modelSnapshot(data: BoardData): ModelState {
  const state: ModelState = {
    scope: data.scope_fingerprint ?? data.meta.scope_fingerprint ?? `project:${(data.meta.project_ids ?? [data.meta.project_id]).join(',')}`,
    projectIds: [...(data.meta.project_ids ?? [data.meta.project_id])],
    limit: data.meta.effective_entity_limit ?? data.meta.requested_entity_limit ?? 1500,
    complete: data.meta.complete ?? true,
    entities: new Map(),
    roots: [],
    childrenByParentId: new Map(),
    deletedIds: new Set(),
  };

  const collect = (nextIssue: Issue, parentId?: number) => {
    const current = state.entities.get(nextIssue.id);
    state.entities.set(nextIssue.id, modelEntityFromIssue(nextIssue, current));
    if (parentId === undefined) {
      if (!state.roots.includes(nextIssue.id)) state.roots.push(nextIssue.id);
    } else {
      modelAttach(state, parentId, nextIssue.id);
    }
    for (const child of nextIssue.subtasks ?? []) collect(child as unknown as Issue, nextIssue.id);
  };

  for (const nextIssue of data.issues) collect(nextIssue);
  state.roots = state.roots.filter((id) => !modelParentByChild(state).has(id));
  return state;
}

function cloneModelState(state: ModelState): ModelState {
  return {
    ...state,
    projectIds: [...state.projectIds],
    entities: new Map(Array.from(state.entities, ([id, entity]) => [id, { ...entity }])),
    roots: [...state.roots],
    childrenByParentId: new Map(Array.from(state.childrenByParentId, ([id, childIds]) => [id, [...childIds]])),
    deletedIds: new Set(state.deletedIds),
  };
}

function modelParentByChild(state: ModelState): Map<number, number> {
  const parentByChild = new Map<number, number>();
  for (const [parentId, childIds] of state.childrenByParentId) {
    for (const childId of childIds) parentByChild.set(childId, parentId);
  }
  return parentByChild;
}

function modelWouldCreateCycle(state: ModelState, parentId: number, childId: number): boolean {
  const seen = new Set<number>([childId]);
  let current: number | undefined = parentId;
  const parentByChild = modelParentByChild(state);
  while (current !== undefined) {
    if (seen.has(current)) return true;
    seen.add(current);
    current = parentByChild.get(current);
  }
  return false;
}

function modelAttach(state: ModelState, parentId: number, childId: number): void {
  if (parentId === childId || !state.entities.has(parentId) || !state.entities.has(childId) || modelWouldCreateCycle(state, parentId, childId)) return;
  const parentByChild = modelParentByChild(state);
  const previousParentId = parentByChild.get(childId);
  if (previousParentId !== undefined && previousParentId !== parentId) modelDetach(state, previousParentId, childId);
  state.childrenByParentId.set(parentId, [...new Set([...(state.childrenByParentId.get(parentId) ?? []), childId])]);
  state.roots = state.roots.filter((id) => id !== childId);
}

function modelDetach(state: ModelState, parentId: number, childId: number): void {
  if (modelParentByChild(state).get(childId) !== parentId) return;
  state.childrenByParentId.set(parentId, (state.childrenByParentId.get(parentId) ?? []).filter((id) => id !== childId));
}

function modelEvict(state: ModelState, issueId: number, tombstone = false): void {
  state.entities.delete(issueId);
  if (tombstone) state.deletedIds.add(issueId);
  state.roots = state.roots.filter((id) => id !== issueId);
  const parentId = modelParentByChild(state).get(issueId);
  if (parentId !== undefined) modelDetach(state, parentId, issueId);
  for (const childId of state.childrenByParentId.get(issueId) ?? []) {
    if (state.entities.has(childId) && !state.roots.includes(childId)) state.roots.push(childId);
  }
  state.childrenByParentId.delete(issueId);
}

function modelIsOutsideProjectScope(state: ModelState, nextIssue: Issue): boolean {
  return nextIssue.project?.id !== undefined && !state.projectIds.includes(nextIssue.project.id);
}

function modelIsFresh(current: ModelEntity | undefined, incoming: ModelEntity): boolean {
  if (!current) return true;
  if (typeof current.lockVersion === 'number' && typeof incoming.lockVersion === 'number') {
    return incoming.lockVersion >= current.lockVersion;
  }
  if (current.updatedOn && incoming.updatedOn) {
    const currentTime = Date.parse(current.updatedOn);
    const incomingTime = Date.parse(incoming.updatedOn);
    if (!Number.isNaN(currentTime) && !Number.isNaN(incomingTime)) return incomingTime >= currentTime;
  }
  return true;
}

function modelHasSameRevision(current: ModelEntity, incoming: ModelEntity): boolean {
  if (typeof current.lockVersion === 'number' && typeof incoming.lockVersion === 'number') {
    return current.lockVersion === incoming.lockVersion;
  }
  if (current.updatedOn && incoming.updatedOn) {
    const currentTime = Date.parse(current.updatedOn);
    const incomingTime = Date.parse(incoming.updatedOn);
    return !Number.isNaN(currentTime) && currentTime === incomingTime;
  }
  return false;
}

function modelMergeEntity(state: ModelState, nextIssue: Issue): boolean {
  const current = state.entities.get(nextIssue.id);
  const incoming = modelEntityFromIssue(nextIssue, current);
  if (state.deletedIds.has(incoming.id) || !modelIsFresh(current, incoming)) return false;
  if (!current || !modelHasSameRevision(current, incoming)) {
    state.entities.set(incoming.id, incoming);
  } else {
    state.entities.set(incoming.id, {
      ...current,
      value: current.value || incoming.value,
      updatedOn: current.updatedOn ?? incoming.updatedOn,
      projectId: current.projectId ?? incoming.projectId,
    });
  }
  return true;
}

function modelReconcileParent(state: ModelState, nextIssue: Issue): void {
  if (!Object.prototype.hasOwnProperty.call(nextIssue, 'parent_id')) return;
  const oldParentId = modelParentByChild(state).get(nextIssue.id);
  if (oldParentId !== undefined) modelDetach(state, oldParentId, nextIssue.id);
  const newParentId = nextIssue.parent_id ?? undefined;
  if (newParentId !== undefined && state.entities.has(newParentId)) modelAttach(state, newParentId, nextIssue.id);
  else if (!state.roots.includes(nextIssue.id)) state.roots.push(nextIssue.id);
}

function modelApplyIssueUpdate(state: ModelState, nextIssue: Issue, created: boolean): void {
  if (modelIsOutsideProjectScope(state, nextIssue)) {
    modelEvict(state, nextIssue.id);
    return;
  }
  if (!modelMergeEntity(state, nextIssue)) return;
  if (created) {
    const parentId = nextIssue.parent_id ?? undefined;
    if (parentId !== undefined && state.entities.has(parentId)) modelAttach(state, parentId, nextIssue.id);
    else if (!state.roots.includes(nextIssue.id)) state.roots.push(nextIssue.id);
  } else {
    modelReconcileParent(state, nextIssue);
  }
}

function modelApplyResponse(state: ModelState, response: BoardResponse): ModelState {
  if (response.scopeFingerprint && response.scopeFingerprint !== state.scope) return state;
  const next = cloneModelState(state);
  for (const nextIssue of response.issue_updates ?? []) modelApplyIssueUpdate(next, nextIssue, false);
  for (const nextIssue of response.created_issues ?? []) modelApplyIssueUpdate(next, nextIssue, true);
  for (const change of response.tree_changes ?? []) {
    if (change.type === 'attach') modelAttach(next, change.parent_id, change.child_id);
    else modelDetach(next, change.parent_id, change.child_id);
  }
  for (const issueId of response.deleted_issue_ids ?? []) modelEvict(next, issueId, true);
  for (const issueId of response.evicted_issue_ids ?? []) modelEvict(next, issueId);
  return next;
}

function referenceOperation(state: ModelState | undefined, operation: Operation): ModelState {
  if (operation.type === 'loadSnapshot' || operation.type === 'changeScope' || operation.type === 'nativeReset') return modelSnapshot(operation.board);
  if (!state) throw new Error(`Operation ${operation.type} requires a loaded snapshot`);
  if (operation.type === 'scopeEvict') {
    return modelApplyResponse(state, { kind: 'mutation', scopeFingerprint: operation.scopeFingerprint, evicted_issue_ids: [operation.issueId] });
  }
  if (operation.type === 'physicalDelete') {
    return modelApplyResponse(state, { kind: 'mutation', scopeFingerprint: operation.scopeFingerprint, deleted_issue_ids: [operation.issueId] });
  }
  if ('response' in operation) return modelApplyResponse(state, operation.response);
  throw new Error(`Unsupported operation ${operation.type}`);
}

function productionOperation(state: NormalizedBoardState | undefined, operation: Operation): NormalizedBoardState {
  if (operation.type === 'loadSnapshot' || operation.type === 'changeScope' || operation.type === 'nativeReset') return createNormalizedBoardState(operation.board);
  if (!state) throw new Error(`Operation ${operation.type} requires a loaded snapshot`);
  if (operation.type === 'scopeEvict') {
    return applyBoardResponse(state, { kind: 'mutation', scopeFingerprint: operation.scopeFingerprint, evicted_issue_ids: [operation.issueId] });
  }
  if (operation.type === 'physicalDelete') {
    return applyBoardResponse(state, { kind: 'mutation', scopeFingerprint: operation.scopeFingerprint, deleted_issue_ids: [operation.issueId] });
  }
  if ('response' in operation) return applyBoardResponse(state, operation.response);
  throw new Error(`Unsupported operation ${operation.type}`);
}

function sortRelations(relations: Array<[number, number[]]>): Array<[number, number[]]> {
  return relations
    .filter(([, childIds]) => childIds.length > 0)
    .map(([parentId, childIds]) => [parentId, [...childIds].sort((left, right) => left - right)] as [number, number[]])
    .sort(([left], [right]) => left - right);
}

function projectModel(state: ModelState): Projection {
  const parentByChild = modelParentByChild(state);
  return {
    entityIds: [...state.entities.keys()].sort((left, right) => left - right),
    revisions: Array.from(state.entities.values())
      .map((entity) => [entity.id, entity.lockVersion, entity.updatedOn, entity.value] as [number, number | undefined, string | null | undefined, string])
      .sort(([left], [right]) => left - right),
    relations: sortRelations(Array.from(state.childrenByParentId)),
    rootIds: state.roots.filter((id) => !parentByChild.has(id)).sort((left, right) => left - right),
    deletedIds: [...state.deletedIds].sort((left, right) => left - right),
    scope: state.scope,
    complete: state.complete,
    limit: state.limit,
  };
}

function projectProduction(state: NormalizedBoardState): Projection {
  const data = selectBoardData(state);
  return {
    entityIds: (data.entities ?? []).map((entity) => entity.id).sort((left, right) => left - right),
    revisions: (data.entities ?? [])
      .map((entity) => [entity.id, entity.lock_version, entity.updated_on, entity.subject] as [number, number | undefined, string | null | undefined, string])
      .sort(([left], [right]) => left - right),
    relations: sortRelations(Object.entries(data.tree?.children_by_parent_id ?? {}).map(([parentId, childIds]) => [Number(parentId), childIds])),
    rootIds: [...(data.tree?.root_ids ?? [])].sort((left, right) => left - right),
    deletedIds: [...state.deletedIssueIds].sort((left, right) => left - right),
    scope: state.scope.fingerprint,
    complete: data.meta.complete ?? false,
    limit: data.meta.effective_entity_limit ?? data.meta.requested_entity_limit ?? 1500,
  };
}

function assertProjectionInvariants(projection: Projection): void {
  expect(new Set(projection.entityIds).size).toBe(projection.entityIds.length);
  expect(projection.complete ? projection.entityIds.length <= projection.limit : true).toBe(true);

  const entities = new Set(projection.entityIds);
  const parentByChild = new Map<number, number>();
  for (const [parentId, childIds] of projection.relations) {
    expect(entities.has(parentId)).toBe(true);
    expect(new Set(childIds).size).toBe(childIds.length);
    for (const childId of childIds) {
      expect(entities.has(childId)).toBe(true);
      expect(parentByChild.has(childId)).toBe(false);
      parentByChild.set(childId, parentId);
    }
  }
  for (const rootId of projection.rootIds) {
    expect(entities.has(rootId)).toBe(true);
    expect(parentByChild.has(rootId)).toBe(false);
  }

  const visiting = new Set<number>();
  const visited = new Set<number>();
  const childrenByParent = new Map(projection.relations);
  const visit = (issueId: number) => {
    if (visiting.has(issueId)) throw new Error(`cycle at ${issueId}`);
    if (visited.has(issueId)) return;
    visiting.add(issueId);
    for (const childId of childrenByParent.get(issueId) ?? []) visit(childId);
    visiting.delete(issueId);
    visited.add(issueId);
  };
  for (const issueId of projection.entityIds) visit(issueId);
}

function assertDifferentialState(
  reference: ModelState,
  production: NormalizedBoardState,
  operation: Operation,
): void {
  const referenceProjection = projectModel(reference);
  const productionProjection = projectProduction(production);
  expect(productionProjection, `Production diverged after ${operation.type}`).toEqual(referenceProjection);
  assertProjectionInvariants(referenceProjection);
  assertProjectionInvariants(productionProjection);
}

describe('snapshot admission preference state machine', () => {
  it.each(['0', '-1', '1.5', '1e5', 'NaN', 'Infinity'])('rejects non-positive, fractional, or non-finite input %s', (value) => {
    expect(parseMaximumBoardEntityCount(value)).toBeNull();
  });

  it('normalizes missing and blank values to the product default', () => {
    expect(normalizeMaximumBoardEntityCount(undefined)).toBe(1500);
    expect(normalizeMaximumBoardEntityCount('')).toBe(1500);
    expect(normalizeMaximumBoardEntityCount(' 1500 ')).toBe(1500);
  });

  it('accepts positive integer values only', () => {
    expect(parseMaximumBoardEntityCount('1')).toBe(1);
    expect(parseMaximumBoardEntityCount('5000')).toBe(5000);
  });
});

describe('production differential normalized snapshot state machine', () => {
  it('keeps the reference model and production state equal after every lifecycle step', () => {
    const initialParent = issue(1);
    initialParent.subtasks = [issue(2, 1) as never];
    const initial = board([initialParent], 'scope-a', [1]);
    const scopeB = board([issue(3, null, 1, 'scope-b issue', 2)], 'scope-b', [2]);
    const nativeSnapshot = board([issue(3, null, 5, 'native authoritative issue', 2)], 'scope-b', [2]);
    const operations: Operation[] = [
      { type: 'loadSnapshot', board: initial },
      {
        type: 'applyMutation',
        response: {
          kind: 'mutation',
          scopeFingerprint: 'scope-a',
          issue_updates: [issue(1, null, 2, 'parent v2'), issue(2, 1, 2, 'child v2')],
        },
      },
      {
        type: 'applyStaleMutation',
        response: {
          kind: 'mutation',
          scopeFingerprint: 'scope-a',
          issue_updates: [issue(1, null, 1, 'stale parent'), issue(2, 1, 3, 'child v3')],
        },
      },
      { type: 'changeScope', board: scopeB },
      {
        type: 'applyStaleMutation',
        response: {
          kind: 'mutation',
          scopeFingerprint: 'scope-a',
          issue_updates: [issue(1, null, 4, 'old scope response')],
        },
      },
      { type: 'scopeEvict', issueId: 3, scopeFingerprint: 'scope-b' },
      {
        type: 'retryMutation',
        response: { kind: 'mutation', scopeFingerprint: 'scope-b', issue_updates: [issue(3, null, 2, 'scope re-entry', 2)] },
      },
      { type: 'physicalDelete', issueId: 3, scopeFingerprint: 'scope-b' },
      {
        type: 'retryMutation',
        response: { kind: 'mutation', scopeFingerprint: 'scope-b', issue_updates: [issue(3, null, 3, 'deleted retry', 2)] },
      },
      { type: 'nativeReset', board: nativeSnapshot },
      {
        type: 'retryMutation',
        response: { kind: 'mutation', scopeFingerprint: 'scope-b', issue_updates: [issue(3, null, 4, 'old mutation after native reset', 2)] },
      },
    ];

    let reference: ModelState | undefined;
    let production: NormalizedBoardState | undefined;
    for (const operation of operations) {
      reference = referenceOperation(reference, operation);
      production = productionOperation(production, operation);
      assertDifferentialState(reference, production, operation);

      if (operation.type === 'scopeEvict') {
        expect(reference.entities.has(operation.issueId)).toBe(false);
        expect(reference.deletedIds.has(operation.issueId)).toBe(false);
        expect(production.entitiesById.has(operation.issueId)).toBe(false);
        expect(production.deletedIssueIds.has(operation.issueId)).toBe(false);
      }
      if (operation.type === 'physicalDelete') {
        expect(reference.entities.has(operation.issueId)).toBe(false);
        expect(reference.deletedIds.has(operation.issueId)).toBe(true);
        expect(production.entitiesById.has(operation.issueId)).toBe(false);
        expect(production.deletedIssueIds.has(operation.issueId)).toBe(true);
      }
    }

    if (!reference || !production) throw new Error('State machine did not load its initial snapshot');

    expect(reference.deletedIds).toEqual(new Set());
    expect(production.deletedIssueIds).toEqual(new Set());
    expect(selectBoardData(production).issues[0].subject).toBe('native authoritative issue');
  });
});
