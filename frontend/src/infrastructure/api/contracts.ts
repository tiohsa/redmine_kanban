import type { BoardIssueEntity, BoardSnapshotTree, Column, Issue, Lane, Lists, Meta } from '../../model/board/types';

export type BoardSnapshotV3Dto = {
  ok: true;
  contract_version: 3;
  scope_fingerprint: string;
  meta: Omit<Meta, 'aging_warn_days' | 'aging_danger_days' | 'aging_exclude_closed' | 'entity_count'> & { complete: true; entity_count: number };
  columns: Column[];
  lanes: Lane[];
  lists: Lists;
  labels: Record<string, string>;
  entities: BoardIssueEntity[];
  tree: BoardSnapshotTree;
};

export type AncestorIssueUpdate = {
  id: number;
  done_ratio: number;
  lock_version: number;
  updated_on: string | null;
  aging_days: number;
};

export type IssueMutationResult = {
  issue?: Issue;
  contract_version?: number;
  operation_id?: string;
  scope_fingerprint?: string;
  dependency_status_ids?: number[];
  issue_updates?: Issue[];
  created_issues?: Issue[];
  deleted_issue_ids?: number[];
  evicted_issue_ids?: number[];
  tree_changes?: Array<{ type: 'attach' | 'detach'; parent_id: number; child_id: number }>;
  invalidations?: { issue_ids?: number[]; parent_ids?: number[]; column_counts?: boolean; root_order?: boolean; board_snapshot?: boolean };
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
