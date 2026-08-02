import React from 'react';
import type { BoardData, Issue, Lane, Subtask } from './types';
import { findSubtaskInTree } from './subtasksTree';
import { isHttpError } from './http';
import type { LaneType } from './useKanbanPreferences';

export type FitMode = 'none' | 'width';

export type AncestorIssueUpdate = {
  id: number;
  done_ratio: number;
  lock_version: number;
  updated_on: string | null;
  aging_days: number;
};

export type IssueMutationResult = {
  issue: Issue;
  contract_version?: number;
  operation_id?: string;
  scope_fingerprint?: string;
  issue_updates?: Issue[];
  created_issues?: Issue[];
  deleted_issue_ids?: number[];
  tree_changes?: Array<{ type: 'attach' | 'detach'; parent_id: number; child_id: number }>;
  invalidations?: { issue_ids?: number[]; parent_ids?: number[]; column_counts?: boolean; root_order?: boolean };
  column_counts?: Record<string, number>;
  warning?: string;
  ancestor_updates?: AncestorIssueUpdate[];
};

export type MovePayload = {
  issueId: number;
  statusId: number;
  assignedToId?: number | null;
  priorityId?: number | null;
  lockVersion: number | null;
};

export type UpdatePayload = {
  issueId: number;
  patch: Record<string, unknown>;
  lockVersion: number | null;
};

export type SubtaskInfo = {
  lockVersion: number | null;
  assignedToId?: number | null;
  allowedStatusIds?: number[];
};

export type ResolvedBoardIssue = {
  id: number;
  subject: string;
  lockVersion: number | null;
  assignedToId?: number | null;
  allowedStatusIds?: number[];
  issueUrl: string;
  issueEditUrl: string;
  kind: 'issue' | 'subtask';
  trackerId: number | null;
  parentIssueId?: number;
  projectId?: number;
  boardIssue?: Issue;
};

export type TrackerCatalog = ReadonlyMap<number, string>;

export function normalizeTrackerId(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

export function buildTrackerCatalog(trackers: BoardData['lists']['trackers']): TrackerCatalog {
  const catalog = new Map<number, string>();
  for (const tracker of trackers ?? []) {
    if (normalizeTrackerId(tracker.id) === null) continue;
    if (!tracker.name.trim() || catalog.has(tracker.id)) continue;
    catalog.set(tracker.id, tracker.name);
  }
  return catalog;
}

export function resolveTrackerName(catalog: TrackerCatalog, trackerId: number | null | undefined): string | null {
  const normalizedTrackerId = normalizeTrackerId(trackerId);
  if (normalizedTrackerId === null) return null;
  return catalog.get(normalizedTrackerId) ?? null;
}

function normalizeSubtask(subtask: Subtask): Subtask {
  return {
    ...subtask,
    tracker_id: normalizeTrackerId(subtask.tracker_id),
    ...(subtask.subtasks ? { subtasks: subtask.subtasks.map(normalizeSubtask) } : {}),
  };
}

function normalizeIssue(issue: Issue): Issue {
  return {
    ...issue,
    tracker_id: normalizeTrackerId(issue.tracker_id),
    ...(issue.subtasks ? { subtasks: issue.subtasks.map(normalizeSubtask) } : {}),
  };
}

export function normalizeBoardData(data: BoardData): BoardData {
  return {
    ...data,
    issues: data.issues.map(normalizeIssue),
  };
}

type FieldErrors = {
  subject?: string[];
};

type ErrorPayload = {
  message?: string;
  field_errors?: FieldErrors;
};

function errorPayload(error: unknown): ErrorPayload | null {
  if (!isHttpError<ErrorPayload>(error) || !error.payload || typeof error.payload !== 'object') return null;
  return error.payload;
}

export function fieldError(fieldErrors: unknown): string | null {
  if (!fieldErrors || typeof fieldErrors !== 'object' || !('subject' in fieldErrors)) return null;

  const subject = (fieldErrors as FieldErrors).subject;
  if (subject?.length) return subject[0];
  return null;
}

export function payloadMessage(error: unknown): string | null {
  const payload = errorPayload(error);
  return payload?.message ?? null;
}

export function payloadFieldError(error: unknown): string | null {
  return fieldError(errorPayload(error)?.field_errors);
}

export function resolveMutationError(
  error: unknown,
  labels: Record<string, string> | undefined,
  fallback?: string,
): string {
  const status = isHttpError<ErrorPayload>(error) ? error.status : undefined;
  const message = payloadMessage(error);

  if (status === 409) {
    return labels?.conflict ?? '';
  }

  return message || fallback || labels?.update_failed || '';
}

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

export function linkifyText(text: string): React.ReactNode[] {
  const re = /https?:\/\/[^\s<>()]+/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    const raw = match[0];
    if (start > lastIndex) nodes.push(text.slice(lastIndex, start));

    let url = raw;
    while (/[),.;:!?]$/.test(url)) url = url.slice(0, -1);
    const trailing = raw.slice(url.length);

    nodes.push(
      <a key={`${start}:${url}`} href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </a>,
    );
    if (trailing) nodes.push(trailing);

    lastIndex = start + raw.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}
