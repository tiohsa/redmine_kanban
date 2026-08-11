import { describe, expect, it } from 'vitest';
import { buildDefaultIssueCreateUrl } from './issueDialog';

describe('buildDefaultIssueCreateUrl', () => {
  it('propagates a preferred tracker while preserving status and lane defaults', () => {
    const url = buildDefaultIssueCreateUrl('/projects/demo/kanban', 1, 'assignee', {
      statusId: 2,
      laneId: 8,
      preferredTrackerId: 3,
    });

    expect(url).toBe('/projects/demo/issues/new?project_id=1&issue%5Bstatus_id%5D=2&issue%5Btracker_id%5D=3&issue%5Bassigned_to_id%5D=8');
  });

  it('does not add a tracker when the preferred tracker is absent', () => {
    const url = buildDefaultIssueCreateUrl('/projects/demo/kanban', 1, 'none', { statusId: 2 });

    expect(url).not.toContain('tracker_id');
  });
});
