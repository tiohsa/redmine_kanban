/**
 * @jest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useKanbanDialogs } from './useKanbanDialogs';
import type { BoardData, Issue } from './types';

function makeIssue(id: number, attrs: Partial<Issue> = {}): Issue {
  return {
    id,
    subject: `Issue ${id}`,
    status_id: 1,
    tracker_id: 1,
    description: '',
    assigned_to_id: null,
    lock_version: 2,
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
      current_user_id: 1,
      can_move: true,
      can_create: true,
      can_delete: true,
      lane_type: 'assignee',
      wip_limit_mode: 'column',
      wip_exceed_behavior: 'warn',
      aging_warn_days: 7,
      aging_danger_days: 14,
      aging_exclude_closed: true,
    },
    columns: [],
    lanes: [],
    lists: {
      trackers: [{ id: 1, name: 'Bug' }],
      priorities: [],
      projects: [],
      viewable_projects: [],
      creatable_projects: [],
      assignees: [],
    },
    issues,
    labels: {},
  };
}

describe('useKanbanDialogs issue resolution', () => {
  it('opens top-level issues with tracker-based title', () => {
    const data = makeBoardData([makeIssue(10, { subject: 'Parent issue' })]);
    const { result } = renderHook(() => useKanbanDialogs('/projects/test/kanban', data, 'assignee'));

    act(() => {
      result.current.openView(10);
    });

    expect(result.current.iframeEditContext).toEqual({
      url: '/issues/10',
      issueId: 10,
      issueTitle: 'Bug #10 Parent issue',
    });
  });

  it('opens nested subtasks for view and edit using synthesized urls', () => {
    const data = makeBoardData([
      makeIssue(10, {
        subject: 'Parent issue',
        subtasks: [
          {
            id: 20,
            subject: 'Closed child',
            status_id: 2,
            is_closed: true,
            lock_version: 6,
          },
        ],
      }),
    ]);
    const { result } = renderHook(() => useKanbanDialogs('/projects/test/kanban', data, 'assignee'));

    act(() => {
      result.current.openView(20);
    });

    expect(result.current.iframeEditContext).toEqual({
      url: '/issues/20',
      issueId: 20,
      issueTitle: '#20 Closed child',
    });

    act(() => {
      result.current.openEdit(20);
    });

    expect(result.current.iframeEditContext).toEqual({
      url: '/issues/20/edit',
      issueId: 20,
      issueTitle: '#20 Closed child',
    });
  });
});
