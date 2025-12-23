export type Column = {
  id: number;
  name: string;
  is_closed: boolean;
  wip_limit?: number | null;
  count?: number;
};

export type Lane = {
  id: string | number;
  name: string;
  assigned_to_id: number | null;
};

export type Subtask = {
  id: number;
  subject: string;
  status_id: number;
  is_closed: boolean;
  lock_version?: number;
};

export type Issue = {
  id: number;
  parent_id?: number | null;
  subject: string;
  status_id: number;
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
  urls: {
    issue: string;
    issue_edit: string;
  };
  project?: { id: number; name: string };
  lock_version?: number;
};

export type Lists = {
  assignees: { id: number | null; name: string }[];
  trackers: { id: number; name: string }[];
  priorities: { id: number; name: string }[];
  projects: { id: number; name: string; level: number }[];
};

export type Meta = {
  project_id: number;
  current_user_id: number;
  can_move: boolean;
  can_create: boolean;
  can_delete: boolean;
  lane_type: 'none' | 'assignee';
  wip_limit_mode: 'column' | 'column_lane';
  wip_exceed_behavior: 'block' | 'warn';
  aging_warn_days: number;
  aging_danger_days: number;
  aging_exclude_closed: boolean;
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
