import { describe, expect, it } from 'vitest';
import type { BoardData, Issue } from '../types';
import { buildBoardState, cellKey, resolveLaneId } from './state';

function makeBoardData(laneType: BoardData['meta']['lane_type']): BoardData {
  return {
    ok: true,
    meta: {
      project_id: 1,
      current_user_id: 10,
      can_move: true,
      can_create: true,
      can_delete: true,
      lane_type: laneType,
      wip_limit_mode: 'column',
      wip_exceed_behavior: 'warn',
      aging_warn_days: 3,
      aging_danger_days: 7,
      aging_exclude_closed: true,
    },
    columns: [
      { id: 1, name: 'Open', is_closed: false, count: 0 },
      { id: 2, name: 'Closed', is_closed: true, count: 0 },
    ],
    lanes: [
      { id: 10, name: 'Me', assigned_to_id: 10 },
      { id: 'unassigned', name: 'Unassigned', assigned_to_id: null },
    ],
    lists: { assignees: [], trackers: [], priorities: [], projects: [] },
    issues: [],
    labels: {},
  };
}

function makeIssue(
  id: number,
  attrs: Partial<Issue> = {}
): Issue {
  return {
    id,
    subject: `Issue ${id}`,
    status_id: 1,
    tracker_id: 1,
    description: '',
    assigned_to_id: null,
    updated_on: '2026-01-01T00:00:00Z',
    urls: { issue: `/issues/${id}`, issue_edit: `/issues/${id}/edit` },
    ...attrs,
  };
}

describe('cellKey', () => {
  it('builds a stable key from status and lane', () => {
    expect(cellKey(2, 'unassigned')).toBe('2:unassigned');
    expect(cellKey(1, 10)).toBe('1:10');
  });
});

describe('resolveLaneId', () => {
  it('returns assignee id or unassigned in assignee lane mode', () => {
    const data = makeBoardData('assignee');
    expect(resolveLaneId(data, makeIssue(1, { assigned_to_id: 10 }))).toBe(10);
    expect(resolveLaneId(data, makeIssue(2, { assigned_to_id: null }))).toBe('unassigned');
  });

  it('always returns none in none lane mode', () => {
    const data = makeBoardData('none');
    expect(resolveLaneId(data, makeIssue(1, { assigned_to_id: 10 }))).toBe('none');
  });
});

describe('buildBoardState', () => {
  it('groups cards per cell and applies sort within each cell', () => {
    const data = makeBoardData('assignee');
    const issues = [
      makeIssue(2, { assigned_to_id: 10, updated_on: '2026-01-01T00:00:00Z' }),
      makeIssue(1, { assigned_to_id: 10, updated_on: '2026-01-03T00:00:00Z' }),
      makeIssue(3, { assigned_to_id: null, updated_on: '2026-01-02T00:00:00Z' }),
    ];

    const state = buildBoardState(data, issues, 'updated_desc', new Map());

    expect(state.columnOrder).toEqual([1, 2]);
    expect(state.laneOrder).toEqual([10, 'unassigned']);
    expect(state.cardsByCell.get('1:10')).toEqual([1, 2]);
    expect(state.cardsByCell.get('1:unassigned')).toEqual([3]);
    expect(state.cardsById.get(1)?.subject).toBe('Issue 1');
  });
});
