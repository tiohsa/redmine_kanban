import React from 'react';
import type { BoardData, Issue, Lane } from './types';
import { findSubtaskInTree } from './subtasksTree';

export type FitMode = 'none' | 'width';

export type IssueMutationResult = { issue: Issue; warning?: string };

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
};

export type ResolvedBoardIssue = {
  id: number;
  subject: string;
  lockVersion: number | null;
  assignedToId?: number | null;
  issueUrl: string;
  issueEditUrl: string;
  kind: 'issue' | 'subtask';
  trackerId?: number;
  parentIssueId?: number;
};

export function fieldError(fieldErrors: any): string | null {
  if (!fieldErrors) return null;
  if (fieldErrors.subject?.length) return fieldErrors.subject[0];
  return null;
}

export function resolveMutationError(
  error: unknown,
  labels: Record<string, string> | undefined,
  fallback?: string,
): string {
  const status = (error as any)?.status as number | undefined;
  const payloadMessage = (error as any)?.payload?.message as string | undefined;

  if (status === 409) {
    return labels?.conflict ?? '';
  }

  return payloadMessage || fallback || labels?.update_failed || '';
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

export function buildDisplayData(data: BoardData, priorityLaneEnabled: boolean): BoardData {
  if (!priorityLaneEnabled) return data;

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
      ...data.meta,
      lane_type: 'priority',
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
      trackerId: issue.tracker_id,
      parentIssueId: issue.parent_id ?? undefined,
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
      parentIssueId: parent.id,
    };
  }

  return null;
}

export function findSubtask(data: BoardData, subtaskId: number): SubtaskInfo | null {
  const resolved = resolveBoardIssue(data, subtaskId);
  if (!resolved) return null;

  return {
    lockVersion: resolved.lockVersion,
    assignedToId: resolved.assignedToId,
  };
}

export function resolveSubtaskStatus(data: BoardData, currentClosed: boolean): number | null {
  if (currentClosed) {
    return data.columns.find((c) => !c.is_closed)?.id ?? null;
  }
  return data.columns.find((c) => c.is_closed)?.id ?? null;
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
