import { describe, expect, it } from 'vitest';
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
});
