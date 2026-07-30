import { describe, expect, it } from 'vitest';
import { buildBulkCreateRequest, buildRestoreIssuePayload } from './kanbanActionPayloads';

describe('buildBulkCreateRequest', () => {
  it('builds one canonical parent and subtask request payload', () => {
    expect(buildBulkCreateRequest({
      subject: 'Parent',
      project_id: 1,
      priority_id: 2,
      status_id: 3,
      assigned_to_id: 4,
      subtasks: [{ subject: 'Child', trackerId: 5 }],
    })).toEqual({
      parent: {
        subject: 'Parent',
        project_id: 1,
        priority_id: 2,
        status_id: 3,
        assigned_to_id: 4,
      },
      subtasks: [{
        subject: 'Child',
        tracker_id: 5,
        project_id: 1,
        priority_id: 2,
        status_id: 3,
        assigned_to_id: 4,
      }],
    });
  });
});

it('preserves the displayed done ratio in a top-level recreation payload', () => {
  expect(buildRestoreIssuePayload({
    id: 1,
    subject: 'Restored',
    status_id: 2,
    tracker_id: 3,
    description: 'Description',
    assigned_to_id: 4,
    priority_id: 5,
    start_date: '2026-01-01',
    due_date: '2026-01-02',
    done_ratio: 60,
    project: { id: 7, name: 'Project' },
    urls: { issue: '/issues/1', issue_edit: '/issues/1/edit' },
  })).toMatchObject({ done_ratio: 60, project_id: 7 });
});
