import { describe, expect, it } from 'vitest';
import { mergeIssuePage, normalizeAssigneeIds, normalizeProjectIds, normalizeTrackerIds, resolveDefaultCreateProjectId } from './App';
import type { BoardData, Issue } from './types';
import { buildDefaultIssueCreateUrl } from './issueDialog';

describe('buildDefaultIssueCreateUrl', () => {
  it('includes project, status, and assignee for assignee lanes', () => {
    const url = buildDefaultIssueCreateUrl('/projects/demo/kanban', 3, 'assignee', {
      statusId: 5,
      laneId: 11,
    });

    expect(url).toBe('/projects/demo/issues/new?project_id=3&issue%5Bstatus_id%5D=5&issue%5Bassigned_to_id%5D=11');
  });

  it('includes empty priority for no-priority lanes', () => {
    const url = buildDefaultIssueCreateUrl('/projects/demo/kanban', 3, 'priority', {
      statusId: 7,
      laneId: 'no_priority',
    });

    expect(url).toBe('/projects/demo/issues/new?project_id=3&issue%5Bstatus_id%5D=7&issue%5Bpriority_id%5D=');
  });

  it('prefers ctx project id over base project id', () => {
    const url = buildDefaultIssueCreateUrl('/projects/demo/kanban', 3, 'none', {
      statusId: 7,
      projectId: 9,
    });

    expect(url).toBe('/projects/demo/issues/new?project_id=9&issue%5Bstatus_id%5D=7');
  });
});

describe('project filter helpers', () => {
  it('prunes project ids to the allowed option set', () => {
    expect(normalizeProjectIds([1, 4, 2], new Set([2, 3]))).toEqual([2]);
  });

  it('prunes assignee ids to the allowed option set while keeping unassigned', () => {
    expect(normalizeAssigneeIds(['7', 'unassigned', '9'], new Set(['7', '8']))).toEqual(['7', 'unassigned']);
  });

  it('drops stale assignee ids that are no longer selectable', () => {
    expect(normalizeAssigneeIds(['9'], new Set(['7', '8']))).toEqual([]);
  });

  it('prunes tracker ids to the allowed option set', () => {
    expect(normalizeTrackerIds([1, 4, 2], new Set([2, 3]))).toEqual([2]);
  });

  it('prefers selected creatable project for default create target', () => {
    expect(resolveDefaultCreateProjectId([4, 2], new Set([2, 7]), 1)).toBe(2);
    expect(resolveDefaultCreateProjectId([], new Set([1, 7]), 1)).toBe(1);
    expect(resolveDefaultCreateProjectId([4], new Set([7]), 1)).toBeNull();
  });
});

function makeIssue(id: number): Issue {
  return {
    id,
    subject: `Issue ${id}`,
    status_id: 1,
    tracker_id: 1,
    description: '',
    assigned_to_id: null,
    urls: { issue: `/issues/${id}`, issue_edit: `/issues/${id}/edit` },
  };
}

function makeBoardData(issues: Issue[], issueCount = issues.length): BoardData {
  return {
    ok: true,
    meta: {
      project_id: 1,
      current_user_id: 1,
      can_move: true,
      can_create: true,
      can_delete: true,
      lane_type: 'none',
      wip_limit_mode: 'column',
      wip_exceed_behavior: 'warn',
      aging_warn_days: 3,
      aging_danger_days: 7,
      aging_exclude_closed: true,
      pagination: {
        issue_limit: 2,
        offset: 0,
        issue_count: issueCount,
        total_issue_count: 4,
        next_offset: issueCount,
        has_more_issues: issueCount < 4,
      },
    },
    columns: [{ id: 1, name: 'Open', is_closed: false, count: 4 }],
    lanes: [{ id: 'none', name: 'All' }],
    lists: {
      assignees: [],
      trackers: [],
      priorities: [],
      projects: [],
      viewable_projects: [],
      creatable_projects: [],
    },
    issues,
    labels: {},
  };
}

describe('mergeIssuePage', () => {
  it('appends new issues, dedupes existing issues, and keeps cumulative pagination count', () => {
    const current = makeBoardData([makeIssue(1), makeIssue(2)], 2);
    const page = makeBoardData([makeIssue(2), makeIssue(3)], 2);
    page.meta.pagination = {
      issue_limit: 2,
      offset: 2,
      issue_count: 2,
      total_issue_count: 4,
      next_offset: 4,
      has_more_issues: false,
    };

    const next = mergeIssuePage(current, page);

    expect(next.issues.map((issue) => issue.id)).toEqual([1, 2, 3]);
    expect(next.meta.pagination?.issue_count).toBe(3);
    expect(next.meta.pagination?.next_offset).toBe(4);
    expect(next.meta.pagination?.has_more_issues).toBe(false);
  });
});
