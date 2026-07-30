import { describe, expect, it } from 'vitest';
import { applyBoardDataFilters, buildVisibleIssues, type Filters } from './boardFilters';
import type { BoardData, Issue } from './types';

function makeIssue(id: number, statusId: number, subject: string, attrs: Partial<Issue> = {}): Issue {
  return {
    id,
    subject,
    status_id: statusId,
    tracker_id: 1,
    description: '',
    assigned_to_id: null,
    urls: {
      issue: `/issues/${id}`,
      issue_edit: `/issues/${id}/edit`,
    },
    ...attrs,
  };
}

function makeBoardData(issues: Issue[]): BoardData {
  return {
    ok: true,
    meta: {
      project_id: 1,
      current_user_id: 7,
      can_move: true,
      can_create: true,
      can_delete: true,
      lane_type: 'assignee',
      aging_warn_days: 3,
      aging_danger_days: 7,
      aging_exclude_closed: true,
    },
    columns: [
      { id: 1, name: 'Open', is_closed: false, count: 1 },
      { id: 2, name: 'Closed', is_closed: true, count: 1 },
    ],
    lanes: [{ id: 'unassigned', name: 'Unassigned', assigned_to_id: null }],
    lists: {
      assignees: [{ id: null, name: 'Unassigned' }],
      trackers: [{ id: 1, name: 'Bug' }],
      priorities: [{ id: 1, name: 'Normal' }, { id: 2, name: 'High' }],
      projects: [{ id: 1, name: 'Demo', level: 0 }],
      viewable_projects: [{ id: 1, name: 'Demo', level: 0 }],
      creatable_projects: [{ id: 1, name: 'Demo', level: 0 }],
    },
    issues,
    labels: {
      all: 'All',
    },
  };
}

function makeFilters(overrides: Partial<Filters> = {}): Filters {
  return {
    assigneeIds: [],
    q: '',
    due: 'all',
    dueDays: 7,
    priority: [],
    priorityFilterEnabled: false,
    projectIds: [],
    statusIds: [],
    trackerIds: [],
    ...overrides,
  };
}

describe('applyBoardDataFilters', () => {
  it('keeps local status filtering on placeholder data by hiding columns immediately', () => {
    const data = makeBoardData([
      makeIssue(1, 1, 'Parent'),
      makeIssue(2, 2, 'Filtered status'),
    ]);

    const filtered = applyBoardDataFilters(data, true, [1]);

    expect(filtered?.columns.map((column) => column.id)).toEqual([1]);
    expect(filtered?.issues.map((issue) => issue.id)).toEqual([1, 2]);
  });

  it('removes subtasks from the top-level issue list when disabled', () => {
    const data = makeBoardData([
      makeIssue(1, 1, 'Parent'),
      makeIssue(2, 1, 'Child', { parent_id: 1 }),
    ]);

    const filtered = applyBoardDataFilters(data, true, []);

    expect(filtered?.issues.map((issue) => issue.id)).toEqual([1]);
  });

  it('keeps a paged child visible until its parent is loaded', () => {
    const data = makeBoardData([makeIssue(2, 1, 'Child', { parent_id: 1 })]);

    const filtered = applyBoardDataFilters(data, true, []);

    expect(filtered?.issues.map((issue) => issue.id)).toEqual([2]);
  });

  it('hides nested subtasks from parent cards when subtasks are shown as separate cards', () => {
    const data = makeBoardData([
      makeIssue(1, 1, 'Parent', {
        subtasks: [{ id: 3, subject: 'Nested', status_id: 1, is_closed: false }],
      }),
      makeIssue(2, 1, 'Child', { parent_id: 1 }),
    ]);

    const filtered = applyBoardDataFilters(data, false, []);

    expect(filtered?.issues.map((issue) => issue.id)).toEqual([1, 2]);
    expect(filtered?.issues[0]?.subtasks).toEqual([]);
  });
});

describe('buildVisibleIssues', () => {
  it('hides locally excluded statuses before the refetch completes', () => {
    const data = makeBoardData([
      makeIssue(1, 1, 'Visible'),
      makeIssue(2, 2, 'Hidden'),
    ]);

    const issues = buildVisibleIssues(data, makeFilters(), new Set([2]), null);

    expect(issues.map((issue) => issue.id)).toEqual([1]);
  });

  it('hides a nested excluded status while retaining its visible descendants', () => {
    const data = makeBoardData([
      makeIssue(1, 1, 'Parent', {
        subtasks: [{
          id: 2,
          subject: 'Hidden child',
          status_id: 2,
          is_closed: true,
          subtasks: [{ id: 3, subject: 'Visible grandchild', status_id: 1, is_closed: false }],
        }],
      }),
    ]);

    const issues = buildVisibleIssues(data, makeFilters(), new Set([2]), null);

    expect(issues[0]?.subtasks).toMatchObject([{ id: 3 }]);
  });

  it('removes a hidden nested leaf', () => {
    const data = makeBoardData([
      makeIssue(1, 1, 'Parent', { subtasks: [{ id: 2, subject: 'Hidden child', status_id: 2, is_closed: true }] }),
    ]);

    expect(buildVisibleIssues(data, makeFilters(), new Set([2]), null)[0]?.subtasks).toEqual([]);
  });

  it('filters issues by multiple selected assignees using OR semantics', () => {
    const data = makeBoardData([
      makeIssue(1, 1, 'Mine', { assigned_to_id: 7 }),
      makeIssue(2, 1, 'Other', { assigned_to_id: 8 }),
      makeIssue(3, 1, 'Unassigned', { assigned_to_id: null }),
    ]);

    const issues = buildVisibleIssues(data, makeFilters({ assigneeIds: ['7', '8'] }), new Set(), null);

    expect(issues.map((issue) => issue.id)).toEqual([1, 2]);
  });

  it('includes unassigned issues when unassigned is selected', () => {
    const data = makeBoardData([
      makeIssue(1, 1, 'Assigned', { assigned_to_id: 7 }),
      makeIssue(2, 1, 'Unassigned', { assigned_to_id: null }),
    ]);

    const issues = buildVisibleIssues(data, makeFilters({ assigneeIds: ['unassigned'] }), new Set(), null);

    expect(issues.map((issue) => issue.id)).toEqual([2]);
  });

  it('treats an empty assignee selection as all issues visible', () => {
    const data = makeBoardData([
      makeIssue(1, 1, 'Assigned', { assigned_to_id: 7 }),
      makeIssue(2, 1, 'Unassigned', { assigned_to_id: null }),
    ]);

    const issues = buildVisibleIssues(data, makeFilters({ assigneeIds: [] }), new Set(), null);

    expect(issues.map((issue) => issue.id)).toEqual([1, 2]);
  });

  it('filters issues by multiple selected trackers using OR semantics', () => {
    const data = makeBoardData([
      makeIssue(1, 1, 'Bug', { tracker_id: 1 }),
      makeIssue(2, 1, 'Feature', { tracker_id: 2 }),
      makeIssue(3, 1, 'Task', { tracker_id: 3 }),
    ]);

    const issues = buildVisibleIssues(data, makeFilters({ trackerIds: [1, 3] }), new Set(), null);

    expect(issues.map((issue) => issue.id)).toEqual([1, 3]);
  });

  it('treats an empty tracker selection as all issues visible', () => {
    const data = makeBoardData([
      makeIssue(1, 1, 'Bug', { tracker_id: 1 }),
      makeIssue(2, 1, 'Feature', { tracker_id: 2 }),
    ]);

    const issues = buildVisibleIssues(data, makeFilters({ trackerIds: [] }), new Set(), null);

    expect(issues.map((issue) => issue.id)).toEqual([1, 2]);
  });

  it('keeps matching descendant context and removes nonmatching siblings', () => {
    const data = makeBoardData([
      makeIssue(1, 1, 'Epic', {
        tracker_id: 1,
        subtasks: [
          { id: 2, subject: 'Matching task', status_id: 1, tracker_id: 3, is_closed: false, subtasks: [
            { id: 4, subject: 'Matching grandchild', status_id: 1, tracker_id: 3, is_closed: false },
          ] },
          { id: 3, subject: 'Sibling task', status_id: 1, tracker_id: 2, is_closed: false },
        ],
      }),
    ]);

    const issues = buildVisibleIssues(data, makeFilters({ trackerIds: [3] }), new Set(), null);

    expect(issues.map((issue) => issue.id)).toEqual([1]);
    expect(issues[0].subtasks?.map((issue) => issue.id)).toEqual([2]);
    expect(issues[0].subtasks?.[0].subtasks?.map((issue) => issue.id)).toEqual([4]);
  });

  it('applies the status filter to descendant branches', () => {
    const data = makeBoardData([
      makeIssue(1, 1, 'Open parent', {
        subtasks: [
          { id: 2, subject: 'Closed child', status_id: 2, is_closed: true },
          { id: 3, subject: 'Open child', status_id: 1, is_closed: false },
        ],
      }),
    ]);

    const issues = buildVisibleIssues(data, makeFilters({ statusIds: [1] }), new Set(), null);

    expect(issues).toHaveLength(1);
    expect(issues[0].subtasks?.map((subtask) => subtask.id)).toEqual([3]);
  });

  it('keeps a parent as context when only a descendant matches status and project', () => {
    const data = makeBoardData([
      makeIssue(1, 2, 'Parent', {
        project: { id: 1, name: 'Root' },
        subtasks: [
          {
            id: 2,
            subject: 'Matching child',
            status_id: 1,
            is_closed: false,
            project: { id: 9, name: 'Subproject' },
          },
          {
            id: 3,
            subject: 'Wrong project',
            status_id: 1,
            is_closed: false,
            project: { id: 1, name: 'Root' },
          },
        ],
      }),
    ]);

    const issues = buildVisibleIssues(
      data,
      makeFilters({ statusIds: [1], projectIds: [9] }),
      new Set(),
      null,
    );

    expect(issues.map((issue) => issue.id)).toEqual([1]);
    expect(issues[0].subtasks?.map((subtask) => subtask.id)).toEqual([2]);
  });

  it('hides a parent when neither it nor any descendant matches project', () => {
    const data = makeBoardData([
      makeIssue(1, 1, 'Parent', {
        project: { id: 1, name: 'Root' },
        subtasks: [{
          id: 2,
          subject: 'Child',
          status_id: 1,
          is_closed: false,
          project: { id: 2, name: 'Other' },
        }],
      }),
    ]);

    expect(buildVisibleIssues(
      data,
      makeFilters({ projectIds: [9] }),
      new Set(),
      null,
    )).toEqual([]);
  });

  it('uses text, assignee, priority, and due-date predicates for descendants', () => {
    const todayDate = new Date();
    const today = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`;
    const data = makeBoardData([
      makeIssue(1, 1, 'Parent', {
        assigned_to_id: 1,
        subtasks: [
          { id: 2, subject: 'Needle', status_id: 1, tracker_id: 1, assigned_to_id: 8, priority_id: 2, due_date: today, is_closed: false },
          { id: 3, subject: 'Other', status_id: 1, tracker_id: 1, assigned_to_id: 9, priority_id: 1, due_date: '2000-01-01', is_closed: false },
        ],
      }),
    ]);

    for (const filters of [
      makeFilters({ q: 'needle' }),
      makeFilters({ assigneeIds: ['8'] }),
      makeFilters({ priority: ['2'], priorityFilterEnabled: true }),
      makeFilters({ due: '7days' }),
    ]) {
      const issues = buildVisibleIssues(data, filters, new Set(), null);
      expect(issues).toHaveLength(1);
      expect(issues[0].subtasks?.map((subtask) => subtask.id)).toEqual([2]);
    }
  });

  it('hides a parent when neither it nor any descendant matches', () => {
    const data = makeBoardData([makeIssue(1, 1, 'Parent', {
      subtasks: [{ id: 2, subject: 'Child', status_id: 1, tracker_id: 1, assigned_to_id: 3, is_closed: false }],
    })]);

    expect(buildVisibleIssues(data, makeFilters({ q: 'absent' }), new Set(), null)).toEqual([]);
    expect(buildVisibleIssues(data, makeFilters({ assigneeIds: ['8'] }), new Set(), null)).toEqual([]);
  });

  it('includes no-priority issues when no_priority is selected', () => {
    const data = makeBoardData([
      makeIssue(1, 1, 'Prioritized', { priority_id: 1 }),
      makeIssue(2, 1, 'No priority', { priority_id: null }),
    ]);

    const issues = buildVisibleIssues(
      data,
      makeFilters({ priority: ['no_priority'], priorityFilterEnabled: true }),
      new Set(),
      null,
    );

    expect(issues.map((issue) => issue.id)).toEqual([2]);
  });

  it('matches numeric priorities and no_priority with OR semantics', () => {
    const data = makeBoardData([
      makeIssue(1, 1, 'Normal', { priority_id: 1 }),
      makeIssue(2, 1, 'No priority', { priority_id: null }),
      makeIssue(3, 1, 'High', { priority_id: 2 }),
    ]);

    const issues = buildVisibleIssues(
      data,
      makeFilters({ priority: ['1', 'no_priority'], priorityFilterEnabled: true }),
      new Set(),
      null,
    );

    expect(issues.map((issue) => issue.id)).toEqual([1, 2]);
  });
});
