import type { BoardSnapshotV3Dto } from '../../infrastructure/api/contracts';

export function makeBoardSnapshot(): BoardSnapshotV3Dto {
  return {
    ok: true,
    contract_version: 3,
    scope_fingerprint: 'sha256:test',
    meta: {
      project_id: 4, project_ids: [4], current_user_id: 7,
      scope_status_ids: [2], dependency_status_ids: [2], scope_fingerprint: 'sha256:test',
      can_move: true, can_create: true, can_delete: true, lane_type: 'assignee',
      complete: true, entity_count: 1,
      requested_entity_limit: 1500, effective_entity_limit: 1500, server_entity_limit: 5000,
    },
    columns: [{ id: 2, name: 'Open', is_closed: false, count: 1 }],
    lanes: [{ id: 'unassigned', name: 'Unassigned', assigned_to_id: null }],
    lists: {
      assignees: [{ id: null, name: 'Unassigned' }, { id: 7, name: 'User' }],
      trackers: [{ id: 1, name: 'Bug', workflow_status_ids: [2], default_status_id: 2, available_project_ids: [4] }],
      priorities: [{ id: 1, name: 'Normal' }],
      categories: [{ id: 1, name: 'General', project_id: 4 }],
      projects: [{ id: 4, name: 'Demo', level: 0 }],
      viewable_projects: [{ id: 4, name: 'Demo', level: 0 }],
      creatable_projects: [{ id: 4, name: 'Demo', level: 0 }],
    },
    entities: [{
      id: 9, parent_id: null, subject: 'Issue', status_id: 2,
      tracker_id: 1, description: '', assigned_to_id: null, assigned_to_name: null,
      start_date: null, due_date: null, priority_id: 1, priority_name: 'Normal',
      category_id: null, category_name: null, lock_version: 0,
      status_is_closed: false, can_log_time: true,
      done_ratio: 0, updated_on: '2026-09-23T10:00:00Z', aging_days: 0,
      project: { id: 4, name: 'Demo' },
      permissions: { can_move: true, can_edit: true, can_delete: true },
      allowed_status_ids: [2],
      urls: { issue: '/redmine/issues/9', issue_edit: '/redmine/issues/9/edit' },
    }],
    tree: { root_ids: [9], children_by_parent_id: {} },
    labels: { load_failed: 'Load failed', all: 'All', not_set: 'Not set' },
  };
}
