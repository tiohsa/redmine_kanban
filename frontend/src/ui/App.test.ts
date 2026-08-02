import { describe, expect, it } from 'vitest';
import { findIssueForAction, mergeIssuePage, normalizeAssigneeIds, normalizeProjectIds, normalizeTrackerIds, resolveDefaultCreateProjectId } from './App';
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

describe('issue action lookup', () => {
  it('finds a nested issue for mutation lock versions', () => {
    const child = makeIssue(2, { lock_version: 7 });
    const parent = makeIssue(1, { subtasks: [child as never] });

    expect(findIssueForAction(makeBoardData([parent]), child.id)).toMatchObject({ lock_version: 7 });
  });
});

function makeIssue(id: number, overrides: Partial<Issue> = {}): Issue {
  return {
    id,
    subject: `Issue ${id}`,
    status_id: 1,
    tracker_id: 1,
    description: '',
    assigned_to_id: null,
    urls: { issue: `/issues/${id}`, issue_edit: `/issues/${id}/edit` },
    ...overrides,
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

  it('keeps a child root when the current parent tree does not contain it', () => {
    const current = makeBoardData([makeIssue(1)], 1);
    const page = makeBoardData([makeIssue(2)], 1);
    page.issues[0].parent_id = 1;
    page.meta.pagination = {
      issue_limit: 1,
      offset: 1,
      issue_count: 1,
      total_issue_count: 2,
      next_offset: 2,
      has_more_issues: false,
    };

    const next = mergeIssuePage(current, page);

    expect(next.issues.map((issue) => issue.id)).toEqual([1, 2]);
  });

  it('attaches a later child root to an existing parent tree and removes the duplicate root', () => {
    const current = makeBoardData([makeIssue(1)], 1);
    const page = makeBoardData([makeIssue(2)], 1);
    page.issues[0].parent_id = 1;
    page.meta.pagination = {
      issue_limit: 1,
      offset: 1,
      issue_count: 1,
      total_issue_count: 2,
      next_offset: 2,
      has_more_issues: false,
    };
    current.issues[0].subtasks = [{ id: 2, subject: 'Child', status_id: 1, is_closed: false }];

    const next = mergeIssuePage(current, page);

    expect(next.issues.map((issue) => issue.id)).toEqual([1]);
    expect(next.issues[0].subtasks?.map((subtask) => subtask.id)).toEqual([2]);
  });

  it('produces the same canonical tree when pages are merged in reverse order', () => {
    const first = makeBoardData([makeIssue(1)], 1);
    first.issues[0].subtasks = [{ id: 2, subject: 'Child', status_id: 1, is_closed: false }];
    first.meta.pagination = {
      issue_limit: 1,
      offset: 0,
      issue_count: 1,
      total_issue_count: 2,
      next_offset: 1,
      has_more_issues: true,
    };
    const second = makeBoardData([makeIssue(2)], 1);
    second.issues[0].parent_id = 1;
    second.meta.pagination = {
      issue_limit: 1,
      offset: 1,
      issue_count: 1,
      total_issue_count: 2,
      next_offset: 2,
      has_more_issues: false,
    };

    const forward = mergeIssuePage(first, second);
    const reverse = mergeIssuePage(second, first);

    expect(reverse.issues.map((issue) => issue.id)).toEqual(forward.issues.map((issue) => issue.id));
    expect(reverse.issues[0]?.subtasks?.map((subtask) => subtask.id)).toEqual([2]);
  });

  it('does not replace a newer issue with a stale page response', () => {
    const current = makeBoardData([{ ...makeIssue(1), subject: 'New', lock_version: 4 }], 1);
    const page = makeBoardData([{ ...makeIssue(1), subject: 'Old', lock_version: 3 }], 1);
    page.meta.pagination = {
      issue_limit: 1,
      offset: 0,
      issue_count: 1,
      total_issue_count: 1,
      next_offset: 1,
      has_more_issues: false,
    };

    const next = mergeIssuePage(current, page);

    expect(next.issues[0]).toMatchObject({ subject: 'New', lock_version: 4 });
  });

  it('does not replace a newer nested issue with a stale root page response', () => {
    const current = makeBoardData([makeIssue(1)], 1);
    current.issues[0].subtasks = [{
      id: 2,
      subject: 'Fresh nested copy',
      status_id: 1,
      is_closed: false,
      lock_version: 4,
      updated_on: '2026-07-31T00:04:00Z',
    }];
    const page = makeBoardData([{
      ...makeIssue(2),
      parent_id: 1,
      subject: 'Stale root copy',
      lock_version: 3,
      updated_on: '2026-07-31T00:03:00Z',
    }], 1);
    page.meta.pagination = {
      issue_limit: 1,
      offset: 1,
      issue_count: 1,
      total_issue_count: 2,
      next_offset: 2,
      has_more_issues: false,
    };

    const next = mergeIssuePage(current, page);

    expect(next.issues.map((issue) => issue.id)).toEqual([1]);
    expect(next.issues[0]?.subtasks?.[0]).toMatchObject({
      id: 2,
      subject: 'Fresh nested copy',
      lock_version: 4,
    });
  });

  it('keeps truncation active while root pages do not resolve the omitted parent', () => {
    const current = makeBoardData([makeIssue(1)], 1);
    current.meta.tree = {
      node_limit: 1500,
      root_issue_count: 1,
      unique_node_count: 1500,
      serialized_node_count: 1500,
      duplicate_node_count: 0,
      truncated: true,
      truncated_parent_ids: [1],
    };
    const page = makeBoardData([makeIssue(2)], 1);
    page.meta.pagination = {
      issue_limit: 1,
      offset: 1,
      issue_count: 1,
      total_issue_count: 2,
      next_offset: 2,
      has_more_issues: false,
    };
    page.meta.tree = {
      node_limit: 1500,
      root_issue_count: 1,
      unique_node_count: 1,
      serialized_node_count: 1,
      duplicate_node_count: 0,
      truncated: false,
      truncated_parent_ids: [],
    };

    const next = mergeIssuePage(current, page);

    expect(next.meta.tree?.truncated).toBe(true);
    expect(next.meta.tree?.truncated_parent_ids).toEqual([1]);
  });

  it('keeps an unexpanded parent recoverable while merging root pages', () => {
    const current = makeBoardData([makeIssue(1)], 1);
    current.meta.tree = {
      node_limit: 1500,
      root_issue_count: 1,
      unique_node_count: 1,
      serialized_node_count: 1,
      duplicate_node_count: 0,
      truncated: true,
      truncated_parent_ids: [],
      unexpanded_parent_ids: [1],
    };
    const page = makeBoardData([makeIssue(2)], 1);
    page.meta.pagination = {
      issue_limit: 1,
      offset: 1,
      issue_count: 1,
      total_issue_count: 2,
      next_offset: 2,
      has_more_issues: false,
    };
    page.meta.tree = {
      node_limit: 1500,
      root_issue_count: 1,
      unique_node_count: 1,
      serialized_node_count: 1,
      duplicate_node_count: 0,
      truncated: false,
      truncated_parent_ids: [],
      unexpanded_parent_ids: [],
    };

    const next = mergeIssuePage(current, page);

    expect(next.meta.tree?.truncated).toBe(true);
    expect(next.meta.tree?.truncated_parent_ids).toEqual([1]);
    expect(next.meta.tree?.unexpanded_parent_ids).toEqual([1]);
  });

  it('clears a resolved parent after merging its scoped subtree page', () => {
    const current = makeBoardData([makeIssue(1)], 1);
    current.issues[0].subtasks = [{ id: 2, subject: 'Loaded child', status_id: 1, is_closed: false }];
    current.meta.tree = {
      node_limit: 1500,
      root_issue_count: 1,
      unique_node_count: 2,
      serialized_node_count: 2,
      duplicate_node_count: 0,
      truncated: true,
      truncated_parent_ids: [1],
    };
    const page = makeBoardData([{ ...makeIssue(3), parent_id: 1 }], 1);
    page.meta.pagination = {
      issue_limit: 500,
      offset: 1,
      issue_count: 1,
      total_issue_count: 2,
      next_offset: 2,
      has_more_issues: false,
    };
    page.meta.tree = {
      node_limit: 1500,
      root_issue_count: 1,
      unique_node_count: 1,
      serialized_node_count: 1,
      duplicate_node_count: 0,
      truncated: false,
      truncated_parent_ids: [],
    };

    const next = mergeIssuePage(current, page, [1]);

    expect(next.issues.map((issue) => issue.id)).toEqual([1]);
    expect(next.issues[0].subtasks?.map((subtask) => subtask.id)).toEqual([2, 3]);
    expect(next.meta.tree?.truncated).toBe(false);
    expect(next.meta.tree?.truncated_parent_ids).toEqual([]);
  });

  it('does not replace root pagination with scoped subtree pagination', () => {
    const current = makeBoardData([makeIssue(1)], 1);
    current.meta.pagination = {
      issue_limit: 2,
      offset: 0,
      issue_count: 1,
      total_issue_count: 4,
      next_offset: 2,
      has_more_issues: true,
    };
    const page = makeBoardData([{ ...makeIssue(2), parent_id: 1 }], 1);
    page.meta.pagination = {
      issue_limit: 500,
      offset: 0,
      issue_count: 1,
      total_issue_count: 1505,
      next_offset: 500,
      has_more_issues: true,
      tree_parent_id: 1,
    };
    page.meta.tree = {
      node_limit: 1500,
      root_issue_count: 1,
      unique_node_count: 1,
      serialized_node_count: 1,
      duplicate_node_count: 0,
      truncated: false,
      truncated_parent_ids: [],
    };

    const next = mergeIssuePage(current, page, [], [1]);

    expect(next.meta.pagination).toMatchObject({ total_issue_count: 4, next_offset: 2, has_more_issues: true });
  });

  it('attaches an intermediate scoped subtree page without clearing truncation', () => {
    const current = makeBoardData([makeIssue(1)], 1);
    current.issues[0].subtasks = [{ id: 2, subject: 'Loaded child', status_id: 1, is_closed: false }];
    current.meta.tree = {
      node_limit: 1500,
      root_issue_count: 1,
      unique_node_count: 2,
      serialized_node_count: 2,
      duplicate_node_count: 0,
      truncated: true,
      truncated_parent_ids: [1],
    };
    const page = makeBoardData([{ ...makeIssue(3), parent_id: 1 }], 1);
    page.meta.pagination = {
      issue_limit: 1,
      offset: 1,
      issue_count: 1,
      total_issue_count: 3,
      next_offset: 2,
      has_more_issues: true,
    };
    page.meta.tree = {
      node_limit: 1500,
      root_issue_count: 1,
      unique_node_count: 1,
      serialized_node_count: 1,
      duplicate_node_count: 0,
      truncated: false,
      truncated_parent_ids: [],
    };

    const next = mergeIssuePage(current, page, [], [1]);

    expect(next.issues.map((issue) => issue.id)).toEqual([1]);
    expect(next.issues[0].subtasks?.map((subtask) => subtask.id)).toEqual([2, 3]);
    expect(next.meta.tree?.truncated).toBe(true);
    expect(next.meta.tree?.truncated_parent_ids).toEqual([1]);
  });

  it('processes a legacy response without tree metadata', () => {
    const current = makeBoardData([makeIssue(1)], 1);
    const page = makeBoardData([makeIssue(2)], 1);

    const next = mergeIssuePage(current, page);

    expect(next.meta.tree).toBeUndefined();
    expect(next.issues.map((issue) => issue.id)).toEqual([1, 2]);
  });
});
