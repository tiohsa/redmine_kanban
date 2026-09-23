import type { BoardData, BoardIssueEntity, Issue, Subtask } from '../../model/board/types';
import type { BoardSnapshotV3Dto } from './contracts';
import { normalizeTrackerId, resolveClosedState } from '../../model/issue/issue';

function normalizeSubtask(subtask: Subtask, columns?: BoardData['columns']): Subtask {
  return {
    ...subtask,
    is_closed: resolveClosedState(subtask, columns),
    tracker_id: normalizeTrackerId(subtask.tracker_id),
    ...(subtask.subtasks ? { subtasks: subtask.subtasks.map((child) => normalizeSubtask(child, columns)) } : {}),
  };
}

function normalizeIssue(issue: Issue, columns?: BoardData['columns']): Issue {
  return {
    ...issue,
    is_closed: resolveClosedState(issue, columns),
    tracker_id: normalizeTrackerId(issue.tracker_id),
    ...(issue.subtasks ? { subtasks: issue.subtasks.map((child) => normalizeSubtask(child, columns)) } : {}),
  };
}

function snapshotIssues(data: BoardSnapshotV3Dto): Issue[] {
  const entities = new Map<number, BoardIssueEntity>(data.entities.map((entity) => [entity.id, entity]));
  const childrenByParentId = new Map<number, number[]>(
    Object.entries(data.tree.children_by_parent_id).map(([parentId, childIds]) => [Number(parentId), childIds]),
  );
  const building = new Set<number>();
  const toIssue = (id: number, parentId: number | null): Issue | null => {
    const entity = entities.get(id);
    if (!entity || building.has(id)) return null;
    building.add(id);
    const subtasks = (childrenByParentId.get(id) ?? [])
      .map((childId) => toIssue(childId, id))
      .filter((child): child is Issue => child !== null)
      .map((child) => child as unknown as Subtask);
    building.delete(id);
    return { ...entity, parent_id: entity.parent_id ?? parentId, subtasks };
  };

  return data.tree.root_ids
    .map((id) => toIssue(id, null))
    .filter((issue): issue is Issue => issue !== null);
}

export function normalizeBoardData(data: BoardSnapshotV3Dto | BoardData): BoardData {
  const issues = 'entities' in data && data.entities && data.tree
    ? snapshotIssues(data as BoardSnapshotV3Dto)
    : ('issues' in data ? data.issues : []);
  // The compatibility BoardData type still requires display-only aging fields.
  // buildDisplayData supplies those fields before the board is rendered.
  return {
    ...data,
    issues: issues.map((issue) => normalizeIssue(issue, data.columns)),
  } as BoardData;
}

export function parseBoardSnapshotV3(value: unknown): BoardSnapshotV3Dto {
  if (!value || typeof value !== 'object') throw new Error('Invalid board snapshot');
  const data = value as Partial<BoardSnapshotV3Dto>;
  if (data.ok !== true || data.contract_version !== 3 || typeof data.scope_fingerprint !== 'string' || !data.scope_fingerprint ||
    !data.meta || data.meta.complete !== true || !Array.isArray(data.entities) || !data.tree ||
    !Array.isArray(data.tree.root_ids) || !data.tree.children_by_parent_id || typeof data.tree.children_by_parent_id !== 'object' ||
    !Array.isArray(data.columns) || !Array.isArray(data.lanes) || !data.lists || !data.labels) {
    throw new Error('Invalid board snapshot');
  }
  const validId = (id: unknown): id is number => Number.isSafeInteger(id) && Number(id) > 0;
  const entityIds = new Set<number>();
  for (const entity of data.entities) {
    if (!entity || !validId(entity.id) || entityIds.has(entity.id)) throw new Error('Invalid board snapshot');
    entityIds.add(entity.id);
  }
  // The server always supplies this count. Without it, a subset of entities
  // could appear to be a complete tree after a malformed response.
  if (data.meta.entity_count !== entityIds.size) throw new Error('Invalid board snapshot');
  if (data.meta.scope_fingerprint && data.meta.scope_fingerprint !== data.scope_fingerprint) throw new Error('Invalid board snapshot');
  const children = new Map<number, number[]>();
  for (const [parent, ids] of Object.entries(data.tree.children_by_parent_id)) {
    const parentId = Number(parent);
    if (!validId(parentId) || !entityIds.has(parentId) || !Array.isArray(ids) || !ids.every(validId)) throw new Error('Invalid board snapshot');
    children.set(parentId, ids);
  }
  const visited = new Set<number>();
  const pending = [...data.tree.root_ids];
  while (pending.length) {
    const id = pending.pop();
    if (!validId(id) || !entityIds.has(id) || visited.has(id)) throw new Error('Invalid board snapshot');
    visited.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  if (visited.size !== entityIds.size) throw new Error('Invalid board snapshot');
  return data as BoardSnapshotV3Dto;
}
