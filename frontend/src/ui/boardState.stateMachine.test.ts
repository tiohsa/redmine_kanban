import { describe, expect, it } from 'vitest';
import { normalizeMaximumBoardEntityCount, parseMaximumBoardEntityCount } from './useKanbanPreferences';

type ModelEntity = {
  id: number;
  parentId: number | null;
  updatedOn: number;
  value: string;
};

type ModelState = {
  scope: string;
  limit: number;
  complete: boolean;
  entities: Map<number, ModelEntity>;
  roots: number[];
  childrenByParentId: Map<number, number[]>;
};

function modelSnapshot(
  scope: string,
  limit: number,
  entities: ModelEntity[],
  roots: number[],
  childrenByParentId: Array<[number, number[]]>,
): ModelState {
  return {
    scope,
    limit,
    complete: true,
    entities: new Map(entities.map((entity) => [entity.id, entity])),
    roots,
    childrenByParentId: new Map(childrenByParentId),
  };
}

function applyModelResponse(state: ModelState, response: { scope: string; entities: ModelEntity[] }): ModelState {
  if (response.scope !== state.scope) return state;

  const entities = new Map(state.entities);
  for (const entity of response.entities) {
    const cached = entities.get(entity.id);
    if (!cached || entity.updatedOn >= cached.updatedOn) entities.set(entity.id, entity);
  }
  return { ...state, entities };
}

function applyModelDelete(state: ModelState, issueId: number): ModelState {
  const entities = new Map(state.entities);
  entities.delete(issueId);
  const childrenByParentId = new Map(
    [...state.childrenByParentId.entries()]
      .map(([parentId, children]) => [parentId, children.filter((childId) => childId !== issueId)]),
  );
  return {
    ...state,
    entities,
    roots: state.roots.filter((rootId) => rootId !== issueId),
    childrenByParentId,
  };
}

function assertModelInvariants(state: ModelState) {
  expect(new Set(state.entities.keys()).size).toBe(state.entities.size);
  expect(state.complete ? state.entities.size <= state.limit : true).toBe(true);

  const parentByChild = new Map<number, number>();
  for (const [parentId, childIds] of state.childrenByParentId) {
    for (const childId of childIds) {
      expect(state.entities.has(childId)).toBe(true);
      expect(parentByChild.has(childId)).toBe(false);
      parentByChild.set(childId, parentId);
    }
  }

  const visiting = new Set<number>();
  const visited = new Set<number>();
  const visit = (issueId: number) => {
    if (visiting.has(issueId)) throw new Error(`cycle at ${issueId}`);
    if (visited.has(issueId)) return;
    visiting.add(issueId);
    for (const childId of state.childrenByParentId.get(issueId) ?? []) visit(childId);
    visiting.delete(issueId);
    visited.add(issueId);
  };
  for (const rootId of state.roots) visit(rootId);
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

describe('normalized snapshot reference model', () => {
  it('preserves freshness, scope, relation, admission, native reset, and retry invariants', () => {
    let state = modelSnapshot(
      'scope-a',
      3,
      [
        { id: 1, parentId: null, updatedOn: 1, value: 'parent' },
        { id: 2, parentId: 1, updatedOn: 1, value: 'child' },
      ],
      [1],
      [[1, [2]]],
    );
    assertModelInvariants(state);

    // Optimistic A then B: B is newer and must survive A's stale response.
    state = applyModelResponse(state, {
      scope: 'scope-a',
      entities: [{ id: 2, parentId: 1, updatedOn: 3, value: 'optimistic-b' }],
    });
    state = applyModelResponse(state, {
      scope: 'scope-a',
      entities: [{ id: 2, parentId: 1, updatedOn: 2, value: 'stale-a' }],
    });
    expect(state.entities.get(2)?.value).toBe('optimistic-b');
    assertModelInvariants(state);

    // A scope change rejects the old response instead of merging it into the new board.
    state = {
      ...state,
      scope: 'scope-b',
      entities: new Map([[1, state.entities.get(1)!]]),
      roots: [1],
      childrenByParentId: new Map(),
    };
    state = applyModelResponse(state, {
      scope: 'scope-a',
      entities: [{ id: 2, parentId: 1, updatedOn: 4, value: 'old-scope' }],
    });
    expect(state.entities.has(2)).toBe(false);
    assertModelInvariants(state);

    // Native reset is authoritative for the new scope, then delete/re-entry remains normalized.
    state = modelSnapshot(
      'scope-b',
      3,
      [
        { id: 1, parentId: null, updatedOn: 5, value: 'parent-after-native-save' },
        { id: 3, parentId: 1, updatedOn: 5, value: 're-entered-child' },
      ],
      [1],
      [[1, [3]]],
    );
    state = applyModelDelete(state, 3);
    state = applyModelResponse(state, {
      scope: 'scope-b',
      entities: [{ id: 3, parentId: 1, updatedOn: 6, value: 'retried-child' }],
    });
    state.childrenByParentId.set(1, [3]);
    assertModelInvariants(state);
    expect(state.entities.get(3)?.value).toBe('retried-child');
  });
});
