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
  tracker_id?: number;
  assigned_to_id?: number | null;
  due_date?: string | null;
  priority_id?: number | null;
  is_closed: boolean;
  lock_version?: number;
  updated_on?: string | null;
  aging_days?: number;
  done_ratio?: number;
  permissions?: IssuePermissions;
  allowed_status_ids?: number[];
  project?: { id: number; name: string };
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
  can_log_time?: boolean;
  lock_version?: number;
  tracker_id: number;
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
  current_user_id: number;
  can_move: boolean;
  can_create: boolean;
  can_delete: boolean;
  lane_type: 'none' | 'assignee' | 'priority';
  aging_warn_days: number;
  aging_danger_days: number;
  aging_exclude_closed: boolean;
  tree?: TreeMeta;
  pagination?: {
    issue_limit: number;
    offset: number;
    issue_count: number;
    total_issue_count: number;
    next_offset: number;
    has_more_issues: boolean;
    tree_parent_id?: number;
  };
};

export type TreeMeta = {
  node_limit: number;
  root_issue_count: number;
  unique_node_count: number;
  serialized_node_count: number;
  duplicate_node_count: number;
  truncated: boolean;
  truncated_parent_ids?: number[];
  loaded_node_count?: number;
  db_row_count?: number;
};

export type BoardData = {
  ok: boolean;
  meta: Meta;
  columns: Column[];
  lanes: Lane[];
  lists: Lists;
  issues: Issue[];
  labels: Record<string, string>;
};
