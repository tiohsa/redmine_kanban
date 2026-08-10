export type Column = {
  id: number;
  name: string;
  is_closed: boolean;
  count?: number;
};

export type Lane = {
  id: string | number;
  name: string;
  assigned_to_id?: number | null;
  priority_id?: number | null;
};

export type Subtask = {
  id: number;
  subject: string;
  status_id: number;
  status_is_closed?: boolean;
  tracker_id?: number | null;
  description?: string;
  assigned_to_id?: number | null;
  assigned_to_name?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  priority_id?: number | null;
  priority_name?: string | null;
  is_closed: boolean;
  lock_version?: number;
  updated_on?: string | null;
  aging_days?: number;
  done_ratio?: number;
  permissions?: IssuePermissions;
  allowed_status_ids?: number[];
  project?: { id: number; name: string };
  urls?: { issue: string; issue_edit: string };
  subtasks?: Subtask[];
};

export type IssuePermissions = {
  can_move: boolean;
  can_edit: boolean;
  can_delete: boolean;
};

export type ProjectListItem = {
  id: number;
  name: string;
  level: number;
};

export type Issue = {
  id: number;
  parent_id?: number | null;
  subject: string;
  status_id: number;
  status_is_closed?: boolean;
  is_closed?: boolean;
  can_log_time?: boolean;
  lock_version?: number;
  tracker_id: number | null;
  description: string;
  assigned_to_id: number | null;
  assigned_to_name?: string | null;
  due_date?: string | null;
  priority_id?: number | null;
  priority_name?: string | null;
  start_date?: string | null;
  updated_on?: string | null;
  aging_days?: number;
  done_ratio?: number;
  subtasks?: Subtask[];
  permissions?: IssuePermissions;
  allowed_status_ids?: number[];
  urls: {
    issue: string;
    issue_edit: string;
  };
  project?: { id: number; name: string };
};

export type Lists = {
  assignees: { id: number | null; name: string }[];
  trackers: { id: number; name: string }[];
  priorities: { id: number; name: string }[];
  projects: ProjectListItem[];
  viewable_projects: ProjectListItem[];
  creatable_projects: ProjectListItem[];
};

export type Meta = {
  project_id: number;
  project_ids?: number[];
  scope_status_ids?: number[];
  dependency_status_ids?: number[];
  scope_fingerprint?: string;
  current_user_id: number;
  can_move: boolean;
  can_create: boolean;
  can_delete: boolean;
  lane_type: 'none' | 'assignee' | 'priority';
  aging_warn_days: number;
  aging_danger_days: number;
  aging_exclude_closed: boolean;
  complete?: boolean;
  entity_count?: number;
  requested_entity_limit?: number;
  effective_entity_limit?: number;
  server_entity_limit?: number;
  response_byte_limit?: number;
  response_bytes?: number;
  id_probe_count?: number;
  materialized_row_count?: number;
  query_count?: number;
};

export type BoardSnapshotTree = {
  root_ids: number[];
  children_by_parent_id: Record<string, number[]>;
};

export type BoardData = {
  ok: boolean;
  contract_version?: number;
  scope_fingerprint?: string;
  meta: Meta;
  columns: Column[];
  lanes: Lane[];
  lists: Lists;
  issues: Issue[];
  labels: Record<string, string>;
  entities?: BoardIssueEntity[];
  tree?: BoardSnapshotTree;
};

export type BoardIssueEntity = Omit<Issue, 'subtasks'>;

export type BoardApiResponse = Omit<BoardData, 'issues'> & {
  issues?: Issue[];
  entities: BoardIssueEntity[];
  tree: BoardSnapshotTree;
};

export type BoardErrorResponse = {
  ok: false;
  contract_version: 3;
  scope_fingerprint?: string;
  error: {
    code: string;
    requested_entity_limit?: number;
    effective_entity_limit?: number;
    server_entity_limit?: number;
    count_at_least?: number;
    maximum_response_bytes?: number;
    message?: string;
  };
};
