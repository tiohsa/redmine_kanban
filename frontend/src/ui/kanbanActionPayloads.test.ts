import { describe, expect, it } from 'vitest';
import { buildBulkCreateRequest } from './kanbanActionPayloads';

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
