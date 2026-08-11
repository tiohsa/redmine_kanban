import { describe, expect, it } from 'vitest';
import { applyBoardDataFilters, buildVisibleIssues, buildPrimaryColumns, resolvePreferredTrackerId, withContextColumns, type Filters } from './boardFilters';
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
  it('projects primary columns from one tracker workflow plus its default status in source order', () => {
    const data = makeBoardData([makeIssue(1, 1, 'Issue')]);
    const projected = buildPrimaryColumns({
      ...data,
      columns: [
        { id: 1, name: 'Open', is_closed: false },
        { id: 2, name: 'Review', is_closed: false },
        { id: 3, name: 'Closed', is_closed: true },
      ],
      lists: {
        ...data.lists,
        trackers: [{ id: 1, name: 'Bug', workflow_status_ids: [2, 2], default_status_id: 1, available_project_ids: [1] }],
      },
    }, [1], []);

    expect(projected.map((column) => column.id)).toEqual([1, 2]);
  });

  it('fails open when selected tracker workflow metadata is missing', () => {
    const data = makeBoardData([makeIssue(1, 1, 'Issue')]);
    expect(buildPrimaryColumns(data, [1], []).map((column) => column.id)).toEqual([1, 2]);
  });

  it('keeps a valid default status when workflow metadata is empty', () => {
    const data = makeBoardData([makeIssue(1, 1, 'Issue')]);
    data.lists.trackers = [{ id: 1, name: 'Bug', workflow_status_ids: [], default_status_id: 2 }];

    expect(buildPrimaryColumns(data, [1], []).map((column) => column.id)).toEqual([2]);
  });

  it('adds the rendered root status without changing the primary column order', () => {
    const data = makeBoardData([makeIssue(1, 2, 'Context parent')]);
    const primary = [data.columns[0]];

    expect(withContextColumns(data, primary, data.issues).map((column) => column.id)).toEqual([1, 2]);
  });

  it('resolves a preferred tracker only when it is available in the target project', () => {
    const data = makeBoardData([makeIssue(1, 1, 'Issue')]);
    data.lists.trackers = [{ id: 1, name: 'Bug', workflow_status_ids: [1], available_project_ids: [1] }];

    expect(resolvePreferredTrackerId(data, [1], 1)).toBe(1);
    expect(resolvePreferredTrackerId(data, [1], 2)).toBeUndefined();
    expect(resolvePreferredTrackerId(data, [1, 2], 1)).toBeUndefined();
  });

  it('keeps local status filtering on placeholder data by hiding columns immediately', () => {
    const data = makeBoardData([
      makeIssue(1, 1, 'Parent'),
      makeIssue(2, 2, 'Filtered status'),
    ]);

    const filtered = applyBoardDataFilters(data, true, [1]);

    expect(filtered?.columns.map((column) => column.id)).toEqual([1]);
    expect(filtered?.issues.map((issue) => issue.id)).toEqual([1, 2]);
  });

  it('keeps a child root when it is not present in the parent tree', () => {
    const data = makeBoardData([
      makeIssue(1, 1, 'Parent'),
      makeIssue(2, 1, 'Child', { parent_id: 1 }),
    ]);

    const filtered = applyBoardDataFilters(data, true, []);

    expect(filtered?.issues.map((issue) => issue.id)).toEqual([1, 2]);
  });

  it('keeps a paged child visible until its parent is loaded', () => {
    const data = makeBoardData([makeIssue(2, 1, 'Child', { parent_id: 1 })]);

    const filtered = applyBoardDataFilters(data, true, []);

    expect(filtered?.issues.map((issue) => issue.id)).toEqual([2]);
  });

  it('keeps a child root when the loaded parent tree does not contain that child', () => {
    const data = makeBoardData([
      makeIssue(1, 1, 'Parent', { subtasks: [] }),
      makeIssue(2, 1, 'Child', { parent_id: 1 }),
    ]);

    const filtered = applyBoardDataFilters(data, true, []);

    expect(filtered?.issues.map((issue) => issue.id)).toEqual([1, 2]);
  });

  it('removes only a child root that is present in the loaded parent tree', () => {
    const data = makeBoardData([
      makeIssue(1, 1, 'Parent', { subtasks: [{ id: 2, subject: 'Child', status_id: 1, is_closed: false }] }),
      makeIssue(2, 1, 'Child', { parent_id: 1 }),
    ]);

    const filtered = applyBoardDataFilters(data, true, []);

    expect(filtered?.issues.map((issue) => issue.id)).toEqual([1]);
  });

  it('keeps the same issue collection when nested display is turned off', () => {
    const data = makeBoardData([
      makeIssue(1, 1, 'Parent', {
        subtasks: [{ id: 2, subject: 'Child', status_id: 1, is_closed: false }],
      }),
    ]);

    const filtered = applyBoardDataFilters(data, false, []);

    expect(filtered?.issues.map((issue) => issue.id)).toEqual([1, 2]);
    expect(filtered?.issues[1]).toMatchObject({ id: 2, parent_id: 1, subtasks: [] });
  });

  it('flattens nested subtasks into cards when subtasks are shown separately', () => {
    const data = makeBoardData([
      makeIssue(1, 1, 'Parent', {
        subtasks: [{ id: 3, subject: 'Nested', status_id: 1, is_closed: false }],
      }),
      makeIssue(2, 1, 'Child', { parent_id: 1 }),
    ]);

    const filtered = applyBoardDataFilters(data, false, []);

    expect(filtered?.issues.map((issue) => issue.id)).toEqual([1, 3, 2]);
    expect(filtered?.issues.every((issue) => issue.subtasks?.length === 0)).toBe(true);
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

  it('keeps hidden-status subtasks and descendants beneath a visible parent', () => {
    const data = makeBoardData([
      makeIssue(1, 1, 'Parent', {
        subtasks: [{
          id: 2,
          subject: 'Hidden child',
          status_id: 2,
          is_closed: true,
          subtasks: [{ id: 3, subject: 'Hidden grandchild', status_id: 2, is_closed: true }],
        }],
      }),
    ]);

    const issues = buildVisibleIssues(data, makeFilters(), new Set([2]), null);

    expect(issues[0]?.subtasks).toMatchObject([{
      id: 2,
      subtasks: [{ id: 3 }],
    }]);
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
