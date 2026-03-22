import { describe, expect, it } from 'vitest';
import { findSubtask, resolveBoardIssue } from './kanbanShared';
import type { BoardData, Issue } from './types';

function makeIssue(id: number, attrs: Partial<Issue> = {}): Issue {
  return {
    id,
    subject: `Issue ${id}`,
    status_id: 1,
    tracker_id: 1,
    description: '',
    assigned_to_id: null,
    lock_version: 3,
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
      wip_limit_mode: 'column',
      wip_exceed_behavior: 'block',
      aging_warn_days: 3,
      aging_danger_days: 7,
      aging_exclude_closed: true,
    },
    columns: [
      { id: 1, name: 'Open', is_closed: false, count: 1 },
      { id: 2, name: 'Closed', is_closed: true, count: 0 },
    ],
    lanes: [],
    lists: {
      assignees: [],
      trackers: [{ id: 1, name: 'Bug' }],
      priorities: [],
      projects: [],
      viewable_projects: [],
      creatable_projects: [],
    },
    issues,
    labels: {},
  };
}

describe('resolveBoardIssue', () => {
  it('resolves top-level issues with existing urls', () => {
    const data = makeBoardData([makeIssue(10, { subject: 'Top level' })]);

    expect(resolveBoardIssue(data, 10)).toEqual({
      id: 10,
      subject: 'Top level',
      lockVersion: 3,
      assignedToId: null,
      issueUrl: '/issues/10',
      issueEditUrl: '/issues/10/edit',
      kind: 'issue',
      trackerId: 1,
      parentIssueId: undefined,
    });
  });

  it('resolves nested subtasks and builds urls from the id', () => {
    const data = makeBoardData([
      makeIssue(10, {
        subtasks: [
          {
            id: 20,
            subject: 'Child',
            status_id: 1,
            is_closed: true,
            lock_version: 5,
            subtasks: [
              {
                id: 30,
                subject: 'Grandchild',
                status_id: 2,
                is_closed: false,
                lock_version: 8,
              },
            ],
          },
        ],
      }),
    ]);

    expect(resolveBoardIssue(data, 30)).toEqual({
      id: 30,
      subject: 'Grandchild',
      lockVersion: 8,
      assignedToId: undefined,
      issueUrl: '/issues/30',
      issueEditUrl: '/issues/30/edit',
      kind: 'subtask',
      parentIssueId: 10,
    });
  });

  it('returns null for unknown ids', () => {
    const data = makeBoardData([makeIssue(10)]);
    expect(resolveBoardIssue(data, 99)).toBeNull();
  });
});

describe('findSubtask', () => {
  it('reuses the shared resolver for subtask mutation info', () => {
    const data = makeBoardData([
      makeIssue(10, {
        subtasks: [
          {
            id: 20,
            subject: 'Child',
            status_id: 1,
            is_closed: false,
            lock_version: 11,
          },
        ],
      }),
    ]);

    expect(findSubtask(data, 20)).toEqual({
      lockVersion: 11,
      assignedToId: undefined,
    });
  });
});
