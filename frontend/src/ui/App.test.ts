import { describe, expect, it } from 'vitest';
import { normalizeAssigneeIds, normalizeProjectIds, resolveDefaultCreateProjectId } from './App';
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

  it('prefers selected creatable project for default create target', () => {
    expect(resolveDefaultCreateProjectId([4, 2], new Set([2, 7]), 1)).toBe(2);
    expect(resolveDefaultCreateProjectId([], new Set([1, 7]), 1)).toBe(1);
    expect(resolveDefaultCreateProjectId([4], new Set([7]), 1)).toBeNull();
  });
});
