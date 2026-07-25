import type { Issue } from './types';

export type BulkCreateSubtaskInput = {
  subject: string;
  trackerId: number;
};

export type BulkCreateInput = Record<string, unknown> & {
  subtasks: BulkCreateSubtaskInput[];
};

export type BulkCreateRequest = {
  parent: Record<string, unknown>;
  subtasks: Array<{
    subject: string;
    tracker_id: number;
    project_id: unknown;
    priority_id: unknown;
    status_id: unknown;
    assigned_to_id: unknown;
  }>;
};

export function isBulkCreateInput(payload: Record<string, unknown>): payload is BulkCreateInput {
  return Array.isArray(payload.subtasks);
}

export function buildBulkCreateRequest(payload: BulkCreateInput): BulkCreateRequest {
  const { subtasks, ...parent } = payload;
  return {
    parent,
    subtasks: subtasks.map((subtask) => ({
      subject: subtask.subject,
      tracker_id: subtask.trackerId,
      project_id: parent.project_id,
      priority_id: parent.priority_id,
      status_id: parent.status_id,
      assigned_to_id: parent.assigned_to_id,
    })),
  };
}

export function buildRestoreIssuePayload(issue: Issue): Record<string, unknown> {
  return {
    subject: issue.subject,
    project_id: issue.project?.id,
    description: issue.description,
    status_id: issue.status_id,
    assigned_to_id: issue.assigned_to_id,
    tracker_id: issue.tracker_id,
    priority_id: issue.priority_id,
    start_date: issue.start_date,
    due_date: issue.due_date,
  };
}
