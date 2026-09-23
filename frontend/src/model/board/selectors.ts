import type { BoardData, Issue, Lane, ResolvedBoardIssue, SubtaskInfo } from './types';
import type { LaneType } from '../view/types';
import { findSubtaskInTree } from './subtasksTree';
import { buildTrackerCatalog, normalizeTrackerId, resolveTrackerName } from '../issue/issue';

export function resolveAssigneeName(data: BoardData, assignedToId: number | null): string | null {
  if (assignedToId === null) return null;
  const assignee = data.lists.assignees.find((a) => a.id === assignedToId);
  return assignee?.name ?? null;
}

export function resolvePriorityName(data: BoardData, priorityId: number | null): string | null {
  if (priorityId === null) return null;
  const priority = data.lists.priorities.find((p) => p.id === priorityId);
  return priority?.name ?? null;
}

export function buildDisplayData(
  data: BoardData,
  laneType: LaneType,
  aging: { warnDays: number; dangerDays: number; excludeClosed: boolean },
): BoardData {
  const meta = {
    ...data.meta,
    lane_type: laneType,
    aging_warn_days: aging.warnDays,
    aging_danger_days: Math.max(aging.warnDays, aging.dangerDays),
    aging_exclude_closed: aging.excludeClosed,
  };
  if (laneType === 'assignee') return { ...data, meta };
  if (laneType === 'none') {
    return { ...data, meta, lanes: [{ id: 'none', name: data.labels.all, assigned_to_id: null }] };
  }

  if (laneType === 'category') {
    const categoryLanes: Lane[] = [
      ...(data.lists.categories ?? []).map((category) => ({
        id: category.id,
        name: category.name,
        category_id: category.id,
        assigned_to_id: null,
      })),
      {
        id: 'no_category',
        name: data.labels.not_set,
        category_id: null,
        assigned_to_id: null,
      },
    ];
    return { ...data, meta, lanes: categoryLanes };
  }

  const prioritiesHighToLow = [...(data.lists.priorities ?? [])].reverse();
  const priorityLanes: Lane[] = [
    ...prioritiesHighToLow.map((priority) => ({
      id: priority.id,
      name: priority.name,
      priority_id: priority.id,
      assigned_to_id: null,
    })),
    {
      id: 'no_priority',
      name: data.labels.not_set,
      priority_id: null,
      assigned_to_id: null,
    },
  ];

  return {
    ...data,
    meta: {
      ...meta,
    },
    lanes: priorityLanes,
  };
}

function buildIssueUrls(issueId: number): Pick<ResolvedBoardIssue, 'issueUrl' | 'issueEditUrl'> {
  return {
    issueUrl: `/issues/${issueId}`,
    issueEditUrl: `/issues/${issueId}/edit`,
  };
}

export function resolveBoardIssue(data: BoardData, issueId: number): ResolvedBoardIssue | null {
  const issue = data.issues.find((it) => it.id === issueId);
  if (issue) {
    return {
      id: issue.id,
      subject: issue.subject,
      lockVersion: issue.lock_version ?? null,
      assignedToId: issue.assigned_to_id ?? null,
      issueUrl: issue.urls.issue,
      issueEditUrl: issue.urls.issue_edit,
      kind: 'issue',
      trackerId: normalizeTrackerId(issue.tracker_id),
      parentIssueId: issue.parent_id ?? undefined,
      projectId: issue.project?.id,
      boardIssue: issue,
      allowedStatusIds: issue.allowed_status_ids,
    };
  }

  for (const parent of data.issues) {
    const subtask = findSubtaskInTree(parent.subtasks, issueId);
    if (!subtask) continue;

    return {
      id: subtask.id,
      subject: subtask.subject,
      lockVersion: subtask.lock_version ?? null,
      assignedToId: undefined,
      ...buildIssueUrls(subtask.id),
      kind: 'subtask',
      trackerId: normalizeTrackerId(subtask.tracker_id),
      parentIssueId: parent.id,
      projectId: subtask.project?.id ?? parent.project?.id,
      allowedStatusIds: subtask.allowed_status_ids,
    };
  }

  return null;
}

export function buildIssueTitle(
  data: BoardData,
  issueId: number,
  fallbackIssue?: Pick<Issue, 'id' | 'subject' | 'tracker_id'>,
): string;
export function buildIssueTitle(
  data: BoardData | null,
  issueId: number,
  fallbackIssue?: Pick<Issue, 'id' | 'subject' | 'tracker_id'>,
): string | undefined;
export function buildIssueTitle(
  data: BoardData | null,
  issueId: number,
  fallbackIssue?: Pick<Issue, 'id' | 'subject' | 'tracker_id'>,
): string | undefined {
  if (!data) return undefined;

  const resolved = resolveBoardIssue(data, issueId);
  const subject = resolved?.subject ?? (fallbackIssue?.id === issueId ? fallbackIssue.subject : undefined);
  if (subject === undefined) return undefined;

  const trackerId = resolved
    ? resolved.trackerId
    : (fallbackIssue?.id === issueId ? fallbackIssue.tracker_id : null);
  const trackerName = resolveTrackerName(buildTrackerCatalog(data.lists.trackers), trackerId);
  return `${trackerName ? `${trackerName} ` : ''}#${issueId} ${subject}`.trim();
}

/** Resolve an Issue-shaped value for both root cards and nested subtask rows. */
export function findIssueInBoard(data: BoardData, issueId: number): Issue | null {
  const direct = data.issues.find((issue) => issue.id === issueId);
  if (direct) return direct;

  for (const issue of data.issues) {
    const nested = findSubtaskInTree(issue.subtasks, issueId);
    if (nested) return nested as unknown as Issue;
  }

  return null;
}

export function findSubtask(data: BoardData, subtaskId: number): SubtaskInfo | null {
  const resolved = resolveBoardIssue(data, subtaskId);
  if (!resolved) return null;

  return {
    lockVersion: resolved.lockVersion,
    assignedToId: resolved.assignedToId,
    allowedStatusIds: resolved.allowedStatusIds,
  };
}

export function resolveSubtaskStatus(data: BoardData, currentClosed: boolean, allowedStatusIds?: number[]): number | null {
  const allowed = allowedStatusIds ? new Set(allowedStatusIds) : null;
  if (currentClosed) {
    return data.columns.find((c) => !c.is_closed && (!allowed || allowed.has(c.id)))?.id ?? null;
  }
  return data.columns.find((c) => c.is_closed && (!allowed || allowed.has(c.id)))?.id ?? null;
}
