import { describe, expect, it } from 'vitest';
import type { BoardData, Issue } from '../types';
import { buildSubtaskKey, laneIdToAssignee, laneIdToPriority, parseCellKey, parseSubtaskKey, resolveBoardLaneId } from './keys';

const baseData: BoardData = {
  ok: true,
  meta: {
    project_id: 1,
    current_user_id: 2,
    can_move: true,
    can_create: true,
    can_delete: true,
    lane_type: 'none',
    wip_limit_mode: 'column',
    wip_exceed_behavior: 'warn',
    aging_warn_days: 3,
    aging_danger_days: 7,
    aging_exclude_closed: true,
  },
  columns: [],
  lanes: [],
  lists: { assignees: [], trackers: [], priorities: [], projects: [], viewable_projects: [], creatable_projects: [] },
  issues: [],
  labels: {},
};

const baseIssue: Issue = {
  id: 10,
  subject: 'Issue',
  status_id: 1,
  tracker_id: 1,
  description: '',
  assigned_to_id: null,
  urls: { issue: '/issues/10', issue_edit: '/issues/10/edit' },
};

describe('board keys helpers', () => {
  it('builds and parses subtask keys', () => {
    const key = buildSubtaskKey(12, 34);
    expect(key).toBe('12:34');
    expect(parseSubtaskKey(key)).toEqual({ issueId: 12, subtaskId: 34 });
  });

  it('parses cell keys for special lanes', () => {
    expect(parseCellKey('5:unassigned', { ...baseData, meta: { ...baseData.meta, lane_type: 'assignee' } })).toEqual([5, 'unassigned']);
    expect(parseCellKey('7:no_priority', { ...baseData, meta: { ...baseData.meta, lane_type: 'priority' } })).toEqual([7, 'no_priority']);
  });

  it('resolves lane ids and payload ids consistently', () => {
    expect(resolveBoardLaneId({ ...baseData, meta: { ...baseData.meta, lane_type: 'assignee' } }, { ...baseIssue, assigned_to_id: 9 })).toBe(9);
    expect(resolveBoardLaneId({ ...baseData, meta: { ...baseData.meta, lane_type: 'priority' } }, { ...baseIssue, priority_id: 4 })).toBe(4);
    expect(laneIdToAssignee({ ...baseData, meta: { ...baseData.meta, lane_type: 'assignee' } }, 'unassigned', 3)).toBeNull();
    expect(laneIdToPriority({ ...baseData, meta: { ...baseData.meta, lane_type: 'priority' } }, 'no_priority', 2)).toBeNull();
  });
});
