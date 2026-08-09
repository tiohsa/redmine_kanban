import type { Issue, Subtask } from './types';
import { normalizeTrackerId, resolveClosedState } from './kanbanShared';

type TreeNode = Issue | Subtask;

type NodeRecord = {
  data: TreeNode;
  rootSeen: boolean;
  declaredParentId?: number | null;
  parentCandidates: Set<number>;
};

function isIssue(node: TreeNode): node is Issue {
  return 'urls' in node || 'description' in node;
}

function withoutChildren(node: TreeNode): TreeNode {
  const copy = { ...node } as TreeNode;
  if (node.tracker_id === undefined) {
    delete (copy as { tracker_id?: number | null }).tracker_id;
  } else {
    copy.tracker_id = normalizeTrackerId(node.tracker_id);
  }
  delete copy.subtasks;
  return copy;
}

function nodeIsFresh(current: TreeNode, incoming: TreeNode): boolean {
  if (typeof current.lock_version === 'number' && typeof incoming.lock_version === 'number') {
    if (incoming.lock_version < current.lock_version) return false;
    if (incoming.lock_version > current.lock_version) return true;
  }

  const currentUpdated = current.updated_on ? Date.parse(current.updated_on) : null;
  const incomingUpdated = incoming.updated_on ? Date.parse(incoming.updated_on) : null;
  if (currentUpdated !== null && incomingUpdated !== null && !Number.isNaN(currentUpdated) && !Number.isNaN(incomingUpdated)) {
    return incomingUpdated >= currentUpdated;
  }
  if (currentUpdated !== null && !Number.isNaN(currentUpdated) && (incomingUpdated === null || Number.isNaN(incomingUpdated))) {
    return false;
  }
  return true;
}

function mergeNodeData(current: TreeNode, incoming: TreeNode): TreeNode {
  const currentIsIssue = isIssue(current);
  const incomingIsIssue = isIssue(incoming);
  if (incomingIsIssue && !currentIsIssue) {
    return withoutChildren(nodeIsFresh(current, incoming) ? incoming : current);
  }
  if (currentIsIssue && !incomingIsIssue) return withoutChildren(current);

  const preferred = nodeIsFresh(current, incoming) ? incoming : current;
  const fallback = preferred === incoming ? current : incoming;
  return withoutChildren({ ...withoutChildren(fallback), ...withoutChildren(preferred) });
}

function addRepresentation(
  records: Map<number, NodeRecord>,
  node: TreeNode,
  rootSeen: boolean,
  parentId?: number,
): void {
  const existing = records.get(node.id);
  if (existing) {
    existing.data = mergeNodeData(existing.data, node);
    existing.rootSeen ||= rootSeen;
    if (rootSeen && isIssue(node) && node.parent_id !== undefined) existing.declaredParentId = node.parent_id;
    if (parentId !== undefined) existing.parentCandidates.add(parentId);
    return;
  }

  records.set(node.id, {
    data: withoutChildren(node),
    rootSeen,
    declaredParentId: rootSeen && isIssue(node) ? node.parent_id : undefined,
    parentCandidates: parentId === undefined ? new Set() : new Set([parentId]),
  });
}

function collectRepresentations(
  records: Map<number, NodeRecord>,
  node: TreeNode,
  rootSeen: boolean,
  parentId: number | undefined,
  path: Set<number>,
): void {
  if (path.has(node.id)) return;

  addRepresentation(records, node, rootSeen, parentId);
  const nextPath = new Set(path);
  nextPath.add(node.id);
  for (const child of node.subtasks ?? []) {
    collectRepresentations(records, child, false, node.id, nextPath);
  }
}

function wouldCreateCycle(childId: number, parentId: number, parentById: Map<number, number>): boolean {
  const visited = new Set<number>([childId]);
  let current = parentId;
  while (!visited.has(current)) {
    visited.add(current);
    const next = parentById.get(current);
    if (next === undefined) return false;
    current = next;
  }
  return true;
}

function compareNodes(left: TreeNode, right: TreeNode): number {
  const leftUpdated = left.updated_on ?? '';
  const rightUpdated = right.updated_on ?? '';
  if (leftUpdated || rightUpdated) {
    if (!leftUpdated) return 1;
    if (!rightUpdated) return -1;
    const updatedOrder = rightUpdated.localeCompare(leftUpdated);
    if (updatedOrder !== 0) return updatedOrder;
  }
  return left.id - right.id;
}

function toSubtask(node: TreeNode, children: Subtask[]): Subtask {
  const issue = node as Issue & Partial<Subtask>;
  return {
    id: issue.id,
    subject: issue.subject,
    status_id: issue.status_id,
    tracker_id: normalizeTrackerId(issue.tracker_id),
    assigned_to_id: issue.assigned_to_id,
    due_date: issue.due_date,
    priority_id: issue.priority_id,
    is_closed: resolveClosedState(issue),
    lock_version: issue.lock_version,
    updated_on: issue.updated_on,
    aging_days: issue.aging_days,
    done_ratio: issue.done_ratio,
    permissions: issue.permissions,
    allowed_status_ids: issue.allowed_status_ids,
    project: issue.project,
    subtasks: children,
  };
}

function toRootIssue(node: TreeNode, children: Subtask[], parentId: number | null): Issue {
  if (isIssue(node)) {
    return {
      ...node,
      parent_id: node.parent_id ?? parentId,
      tracker_id: normalizeTrackerId(node.tracker_id),
      subtasks: children,
    };
  }

  const subtask = toSubtask(node, children);
  return {
    id: subtask.id,
    parent_id: parentId,
    subject: subtask.subject,
    status_id: subtask.status_id,
    status_is_closed: resolveClosedState(subtask),
    is_closed: resolveClosedState(subtask),
    lock_version: subtask.lock_version,
    tracker_id: normalizeTrackerId(subtask.tracker_id),
    description: '',
    assigned_to_id: subtask.assigned_to_id ?? null,
    due_date: subtask.due_date,
    priority_id: subtask.priority_id,
    updated_on: subtask.updated_on,
    aging_days: subtask.aging_days,
    done_ratio: subtask.done_ratio,
    subtasks: children,
    permissions: subtask.permissions,
    allowed_status_ids: subtask.allowed_status_ids,
    project: subtask.project,
    urls: {
      issue: `/issues/${subtask.id}`,
      issue_edit: `/issues/${subtask.id}/edit`,
    },
  };
}

function buildCanonicalTree(records: Map<number, NodeRecord>): Issue[] {
  const parentById = new Map<number, number>();
  const orderedIds = Array.from(records.keys()).sort((left, right) => left - right);

  for (const id of orderedIds) {
    const record = records.get(id);
    if (!record) continue;

    const candidates = Array.from(record.parentCandidates)
      .filter((parentId) => parentId !== id && records.has(parentId))
      .sort((left, right) => left - right);
    const declaredParent = record.declaredParentId;
    const parentId = declaredParent !== undefined && declaredParent !== null && candidates.includes(declaredParent)
      ? declaredParent
      : candidates[0];
    if (parentId !== undefined && !wouldCreateCycle(id, parentId, parentById)) {
      parentById.set(id, parentId);
    }
  }

  const childrenByParent = new Map<number, number[]>();
  for (const [childId, parentId] of parentById) {
    const children = childrenByParent.get(parentId) ?? [];
    children.push(childId);
    childrenByParent.set(parentId, children);
  }

  for (const children of childrenByParent.values()) {
    children.sort((left, right) => compareNodes(records.get(left)!.data, records.get(right)!.data));
  }

  const building = new Set<number>();
  const buildNode = (id: number, parentId: number | null): TreeNode => {
    const record = records.get(id);
    if (!record || building.has(id)) return record?.data ?? toRootIssue({ id, subject: '', status_id: 0, is_closed: false }, [], parentId);

    building.add(id);
    const children = (childrenByParent.get(id) ?? [])
      .map((childId) => buildNode(childId, id))
      .map((child) => toSubtask(child, child.subtasks ?? []));
    building.delete(id);

    return parentId === null ? toRootIssue(record.data, children, record.declaredParentId ?? null) : toSubtask(record.data, children);
  };

  const roots = orderedIds
    .filter((id) => !parentById.has(id))
    .map((id) => buildNode(id, null))
    .filter((node): node is Issue => isIssue(node));
  roots.sort(compareNodes);
  return roots;
}

export function mergeIssueTrees(current: Issue[], incoming: Issue[], attachRootParentIds: number[] = []): Issue[] {
  const records = new Map<number, NodeRecord>();
  for (const issue of current) collectRepresentations(records, issue, true, undefined, new Set());
  const attachParents = new Set(attachRootParentIds);
  for (const issue of incoming) {
    const parentId = isIssue(issue) && issue.parent_id && attachParents.has(issue.parent_id)
      ? issue.parent_id
      : undefined;
    collectRepresentations(records, issue, parentId === undefined, parentId, new Set());
  }
  return buildCanonicalTree(records);
}

export function nestedIssueIds(issues: Issue[]): Set<number> {
  const ids = new Set<number>();
  const visit = (subtasks: Subtask[] | undefined, path: Set<number>) => {
    for (const subtask of subtasks ?? []) {
      if (path.has(subtask.id)) continue;
      ids.add(subtask.id);
      const nextPath = new Set(path);
      nextPath.add(subtask.id);
      visit(subtask.subtasks, nextPath);
    }
  };

  for (const issue of issues) visit(issue.subtasks, new Set([issue.id]));
  return ids;
}

export function directSubtaskCount(issues: Issue[], issueId: number): number {
  const pending: TreeNode[] = [...issues];
  const visited = new Set<number>();

  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || visited.has(node.id)) continue;
    visited.add(node.id);
    if (node.id === issueId) return node.subtasks?.length ?? 0;
    pending.push(...(node.subtasks ?? []));
  }

  return 0;
}

export function flattenIssueTree(issues: Issue[]): Issue[] {
  const result: Issue[] = [];
  const seen = new Set<number>();

  const visit = (node: TreeNode, parentId: number | null) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    const children = node.subtasks ?? [];
    result.push(toRootIssue(node, [], parentId));
    for (const child of children) visit(child, node.id);
  };

  for (const issue of issues) visit(issue, issue.parent_id ?? null);
  return result;
}
