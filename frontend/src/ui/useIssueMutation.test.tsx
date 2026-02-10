// @vitest-environment jsdom

import React, { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BoardData, Issue } from './types';
import { replaceIssueInBoard, updateIssueInBoard, useIssueMutation } from './useIssueMutation';

function makeIssue(id: number, attrs: Partial<Issue> = {}): Issue {
  return {
    id,
    subject: `Issue ${id}`,
    status_id: 1,
    tracker_id: 1,
    description: '',
    assigned_to_id: null,
    lock_version: 1,
    urls: { issue: `/issues/${id}`, issue_edit: `/issues/${id}/edit` },
    ...attrs,
  };
}

function makeBoardData(issues: Issue[]): BoardData {
  return {
    ok: true,
    meta: {
      project_id: 1,
      current_user_id: 10,
      can_move: true,
      can_create: true,
      can_delete: true,
      lane_type: 'none',
      wip_limit_mode: 'column',
      wip_exceed_behavior: 'warn',
      aging_warn_days: 3,
      aging_danger_days: 7,
      aging_exclude_closed: true,
    },
    columns: [
      { id: 1, name: 'Open', is_closed: false, count: 0 },
      { id: 2, name: 'Closed', is_closed: true, count: 0 },
    ],
    lanes: [],
    lists: { assignees: [], trackers: [], priorities: [], projects: [] },
    issues,
    labels: {},
  };
}

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('updateIssueInBoard', () => {
  it('updates matching issue and rebuilds column counts', () => {
    const board = makeBoardData([
      makeIssue(1, { status_id: 1 }),
      makeIssue(2, { status_id: 1 }),
      makeIssue(3, { status_id: 2 }),
    ]);

    const next = updateIssueInBoard(board, 2, (issue) => ({ ...issue, status_id: 2 }));

    expect(next.issues.find((issue) => issue.id === 2)?.status_id).toBe(2);
    expect(next.columns.find((column) => column.id === 1)?.count).toBe(1);
    expect(next.columns.find((column) => column.id === 2)?.count).toBe(2);
  });

  it('syncs parent subtask status when child issue is updated', () => {
    const board = makeBoardData([
      makeIssue(10, {
        status_id: 1,
        subtasks: [{ id: 20, subject: 'Sub', status_id: 1, is_closed: false }],
      }),
      makeIssue(20, { parent_id: 10, status_id: 1 }),
    ]);

    const next = updateIssueInBoard(board, 20, (issue) => ({ ...issue, status_id: 2 }));
    const parent = next.issues.find((issue) => issue.id === 10);
    expect(parent?.subtasks?.[0].status_id).toBe(2);
    expect(parent?.subtasks?.[0].is_closed).toBe(true);
  });
});

describe('replaceIssueInBoard', () => {
  it('replaces an issue by id', () => {
    const board = makeBoardData([makeIssue(1, { subject: 'Before' })]);
    const next = replaceIssueInBoard(board, makeIssue(1, { subject: 'After' }));
    expect(next.issues[0].subject).toBe('After');
  });
});

describe('useIssueMutation', () => {
  it('applies optimistic update, then applies server response and settles callbacks', async () => {
    const queryKey = ['kanban', 'board'] as const;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const initial = makeBoardData([makeIssue(1, { subject: 'Before' })]);
    queryClient.setQueryData(queryKey, initial);

    const onMutateIssue = vi.fn();
    const onSettledIssue = vi.fn();
    const onSuccess = vi.fn();

    const { result } = renderHook(
      () =>
        useIssueMutation({
          queryKey,
          mutationFn: async () => ({ issue: makeIssue(1, { subject: 'Server' }) }),
          applyOptimistic: (data) => updateIssueInBoard(data, 1, (i) => ({ ...i, subject: 'Optimistic' })),
          applyServer: (data, res, _payload) => replaceIssueInBoard(data, res.issue),
          onMutateIssue,
          onSettledIssue,
          onSuccess,
        }),
      { wrapper: createWrapper(queryClient) }
    );

    await act(async () => {
      await result.current.mutateAsync({ issueId: 1 });
    });

    const current = queryClient.getQueryData<BoardData>(queryKey);
    expect(current?.issues[0].subject).toBe('Server');
    expect(onMutateIssue).toHaveBeenCalledWith(1);
    expect(onSettledIssue).toHaveBeenCalledWith(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('rolls back optimistic update on error', async () => {
    const queryKey = ['kanban', 'board', 'error'] as const;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const initial = makeBoardData([makeIssue(1, { subject: 'Before' })]);
    queryClient.setQueryData(queryKey, initial);
    const onError = vi.fn();

    const { result } = renderHook(
      () =>
        useIssueMutation({
          queryKey,
          mutationFn: async () => {
            throw new Error('failed');
          },
          applyOptimistic: (data) => updateIssueInBoard(data, 1, (i) => ({ ...i, subject: 'Optimistic' })),
          applyServer: (data, _res, _payload) => data,
          onError,
        }),
      { wrapper: createWrapper(queryClient) }
    );

    await act(async () => {
      await expect(result.current.mutateAsync({ issueId: 1 })).rejects.toThrow('failed');
    });

    await waitFor(() => {
      const current = queryClient.getQueryData<BoardData>(queryKey);
      expect(current?.issues[0].subject).toBe('Before');
    });
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
