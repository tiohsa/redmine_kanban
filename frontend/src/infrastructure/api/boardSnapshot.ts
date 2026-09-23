import type { BoardData, BoardIssueEntity, Column, Issue, Lane, Lists, ProjectListItem, Subtask, TrackerListItem } from '../../model/board/types';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isNonBlankString = (value: unknown): value is string => isString(value) && value.trim().length > 0;
const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const isNonNegativeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isNullableId = (value: unknown): value is number | null => value === null || isId(value);
const isNullableString = (value: unknown): value is string | null => value === null || isString(value);

function isArrayOf<T>(value: unknown, valid: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(valid);
}

const isIds = (value: unknown): value is number[] => isArrayOf(value, isId);
const optional = (value: unknown, valid: (item: unknown) => boolean): boolean => value === undefined || valid(value);

function isNamedId(value: unknown): value is Record<string, unknown> & { id: number; name: string } {
  return isRecord(value) && isId(value.id) && isString(value.name);
}

function isProject(value: unknown): value is ProjectListItem {
  return isNamedId(value) && isNonNegativeInteger(value.level);
}

function isTracker(value: unknown): value is TrackerListItem {
  return isNamedId(value) &&
    optional(value.workflow_status_ids, isIds) && optional(value.available_project_ids, isIds) &&
    optional(value.default_status_id, isNullableId);
}

function isLists(value: unknown): value is Lists {
  return isRecord(value) &&
    isArrayOf(value.assignees, (item): item is Lists['assignees'][number] => isRecord(item) && isNullableId(item.id) && isString(item.name)) &&
    isArrayOf(value.trackers, isTracker) && isArrayOf(value.priorities, isNamedId) &&
    isArrayOf(value.projects, isProject) && isArrayOf(value.viewable_projects, isProject) && isArrayOf(value.creatable_projects, isProject) &&
    optional(value.categories, (items) => isArrayOf(items, (item): item is NonNullable<Lists['categories']>[number] =>
      isNamedId(item) && optional(item.project_id, isId)));
}

function isColumn(value: unknown): value is Column {
  return isNamedId(value) && isBoolean(value.is_closed) && optional(value.count, isNonNegativeInteger);
}

function isLane(value: unknown): value is Lane {
  return isRecord(value) && (isId(value.id) || isNonBlankString(value.id)) && isString(value.name) &&
    ['assigned_to_id', 'priority_id', 'category_id'].every((key) => optional(value[key], isNullableId));
}

function isIssueUrls(value: unknown): value is Issue['urls'] {
  return isRecord(value) && isNonBlankString(value.issue) && isNonBlankString(value.issue_edit);
}

function isIssuePermissions(value: unknown): value is NonNullable<Issue['permissions']> {
  return isRecord(value) && isBoolean(value.can_move) && isBoolean(value.can_edit) && isBoolean(value.can_delete);
}

function isIssueEntity(value: unknown): value is BoardIssueEntity {
  return isRecord(value) && isId(value.id) && isString(value.subject) && isId(value.status_id) &&
    isNullableId(value.tracker_id) && isNullableId(value.assigned_to_id) &&
    // Redmine's presenter returns a nullable description; omission is invalid.
    isNullableString(value.description) && isIssueUrls(value.urls) &&
    ['parent_id', 'priority_id', 'category_id'].every((key) => optional(value[key], isNullableId)) &&
    ['assigned_to_name', 'priority_name', 'category_name', 'start_date', 'due_date', 'updated_on'].every((key) => optional(value[key], isNullableString)) &&
    ['is_closed', 'status_is_closed', 'can_log_time'].every((key) => optional(value[key], isBoolean)) &&
    optional(value.lock_version, isNonNegativeInteger) && optional(value.aging_days, isFiniteNumber) && optional(value.done_ratio, isFiniteNumber) &&
    optional(value.allowed_status_ids, isIds) && optional(value.permissions, isIssuePermissions) && optional(value.project, isNamedId);
}

function isSnapshotMeta(value: unknown): value is BoardSnapshotV3Dto['meta'] {
  return isRecord(value) && value.complete === true && isNonNegativeInteger(value.entity_count) &&
    isId(value.project_id) && isNonNegativeInteger(value.current_user_id) &&
    isBoolean(value.can_move) && isBoolean(value.can_create) && isBoolean(value.can_delete) &&
    ['none', 'assignee', 'priority', 'category'].some((laneType) => value.lane_type === laneType) &&
    ['project_ids', 'scope_status_ids', 'dependency_status_ids'].every((key) => optional(value[key], isIds)) &&
    optional(value.scope_fingerprint, isNonBlankString) &&
    ['requested_entity_limit', 'effective_entity_limit', 'server_entity_limit', 'response_byte_limit'].every((key) => optional(value[key], isId)) &&
    ['response_bytes', 'id_probe_count', 'materialized_row_count', 'query_count'].every((key) => optional(value[key], isNonNegativeInteger));
}

export function parseBoardSnapshotV3(data: unknown): BoardSnapshotV3Dto {
  if (!isRecord(data) || data.ok !== true || data.contract_version !== 3 || !isNonBlankString(data.scope_fingerprint) ||
    !isSnapshotMeta(data.meta) || !isArrayOf(data.entities, isIssueEntity) || !isRecord(data.tree) ||
    !isIds(data.tree.root_ids) || !isRecord(data.tree.children_by_parent_id) ||
    !isArrayOf(data.columns, isColumn) || !isArrayOf(data.lanes, isLane) || !isLists(data.lists) ||
    !isRecord(data.labels) || !Object.values(data.labels).every(isString)) {
    throw new Error('Invalid board snapshot');
  }
  const entityIds = new Set<number>();
  for (const entity of data.entities) {
    if (entityIds.has(entity.id)) throw new Error('Invalid board snapshot');
    entityIds.add(entity.id);
  }
  // The server always supplies this count. Without it, a subset of entities
  // could appear to be a complete tree after a malformed response.
  if (data.meta.entity_count !== entityIds.size) throw new Error('Invalid board snapshot');
  if (data.meta.scope_fingerprint && data.meta.scope_fingerprint !== data.scope_fingerprint) throw new Error('Invalid board snapshot');
  const children = new Map<number, number[]>();
  for (const [parent, ids] of Object.entries(data.tree.children_by_parent_id)) {
    const parentId = Number(parent);
    if (!isId(parentId) || String(parentId) !== parent || !entityIds.has(parentId) || !isIds(ids)) throw new Error('Invalid board snapshot');
    children.set(parentId, ids);
  }
  const visited = new Set<number>();
  const pending = [...data.tree.root_ids];
  while (pending.length) {
    const id = pending.pop();
    if (!isId(id) || !entityIds.has(id) || visited.has(id)) throw new Error('Invalid board snapshot');
    visited.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  if (visited.size !== entityIds.size) throw new Error('Invalid board snapshot');
  return data as BoardSnapshotV3Dto;
}
