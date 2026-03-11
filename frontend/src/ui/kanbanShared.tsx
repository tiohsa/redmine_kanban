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

export function findSubtask(data: BoardData, subtaskId: number): SubtaskInfo | null {
  const issue = data.issues.find((it) => it.id === subtaskId);
  if (issue) {
    return {
      lockVersion: issue.lock_version ?? null,
      assignedToId: issue.assigned_to_id ?? null,
    };
  }

  for (const parent of data.issues) {
    const subtask = findSubtaskInTree(parent.subtasks, subtaskId);
    if (subtask) {
      return {
        lockVersion: subtask.lock_version ?? null,
        assignedToId: undefined,
      };
    }
  }

  return null;
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
