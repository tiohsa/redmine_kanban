// @vitest-environment jsdom

import React, { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BoardData, Issue } from './types';
import { applyAncestorIssueUpdates, isIssueFresh, replaceIssueInBoard, updateIssueInBoard, updateSubtaskInBoard, useIssueMutation } from './useIssueMutation';

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
      aging_warn_days: 3,
      aging_danger_days: 7,
      aging_exclude_closed: true,
    },
    columns: [
      { id: 1, name: 'Open', is_closed: false, count: 0 },
      { id: 2, name: 'Closed', is_closed: true, count: 0 },
    ],
    lanes: [],
    lists: { assignees: [], trackers: [], priorities: [], projects: [], viewable_projects: [], creatable_projects: [] },
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

describe('updateSubtaskInBoard', () => {
  it('updates only the matching nested subtask when it is not loaded as a board issue', () => {
    const board = makeBoardData([
      makeIssue(10, {
        subtasks: [
          { id: 20, subject: 'First child', status_id: 1, is_closed: false, lock_version: 3 },
          {
            id: 30,
            subject: 'Second child',
            status_id: 1,
            is_closed: false,
            lock_version: 7,
            subtasks: [
              { id: 40, subject: 'Nested child', status_id: 1, is_closed: false, lock_version: 11 },
            ],
          },
        ],
      }),
    ]);

    const next = updateSubtaskInBoard(board, 20, {
      status_id: 2,
      is_closed: true,
      lock_version: 4,
    });

    expect(next.issues[0].subtasks?.[0]).toMatchObject({
      id: 20,
      status_id: 2,
      is_closed: true,
      lock_version: 4,
    });
    expect(next.issues[0].subtasks?.[1]).toBe(board.issues[0].subtasks?.[1]);
  });

  it('keeps the latest lock version available for a consecutive toggle', () => {
    const board = makeBoardData([
      makeIssue(10, {
        subtasks: [{ id: 20, subject: 'Child', status_id: 1, is_closed: false, lock_version: 3 }],
      }),
    ]);

    const afterClose = updateSubtaskInBoard(board, 20, {
      status_id: 2,
      is_closed: true,
      lock_version: 4,
    });
    const lockVersionForReopen = afterClose.issues[0].subtasks?.[0].lock_version;
    const afterReopen = updateSubtaskInBoard(afterClose, 20, {
      status_id: 1,
      is_closed: false,
      lock_version: 5,
    });

    expect(lockVersionForReopen).toBe(4);
    expect(afterReopen.issues[0].subtasks?.[0]).toMatchObject({
      status_id: 1,
      is_closed: false,
      lock_version: 5,
    });
  });
});

describe('applyAncestorIssueUpdates', () => {
  it('updates progress metadata for loaded parent and ancestor cards', () => {
    const board = makeBoardData([
      makeIssue(10, { done_ratio: 0, lock_version: 1, updated_on: '2026-07-17T00:00:00Z', aging_days: 1 }),
      makeIssue(20, { done_ratio: 50, lock_version: 2 }),
      makeIssue(30, { parent_id: 20 }),
    ]);

    const next = applyAncestorIssueUpdates(board, [
      { id: 10, done_ratio: 25, lock_version: 3, updated_on: '2026-07-18T00:00:00Z', aging_days: 0 },
      { id: 20, done_ratio: 100, lock_version: 4, updated_on: '2026-07-18T00:01:00Z', aging_days: 0 },
    ]);

    expect(next.issues.find((issue) => issue.id === 10)).toMatchObject({
      done_ratio: 25,
      lock_version: 3,
      updated_on: '2026-07-18T00:00:00Z',
      aging_days: 0,
    });
    expect(next.issues.find((issue) => issue.id === 20)).toMatchObject({
      done_ratio: 100,
      lock_version: 4,
      updated_on: '2026-07-18T00:01:00Z',
      aging_days: 0,
    });
    expect(next.issues).toHaveLength(3);
  });

  it('ignores ancestors that are not loaded without replacing paginated board data', () => {
    const board = makeBoardData([makeIssue(20, { done_ratio: 50 }), makeIssue(30)]);

    const next = applyAncestorIssueUpdates(board, [
      { id: 10, done_ratio: 100, lock_version: 2, updated_on: null, aging_days: 0 },
    ]);

    expect(next).toBe(board);
    expect(next.issues.map((issue) => issue.id)).toEqual([20, 30]);
  });

  it('rejects an older lock version even when it arrives later', () => {
    const board = makeBoardData([
      makeIssue(10, { done_ratio: 75, lock_version: 5, updated_on: '2026-07-18T00:05:00Z', aging_days: 0 }),
    ]);

    const next = applyAncestorIssueUpdates(board, [
      { id: 10, done_ratio: 25, lock_version: 4, updated_on: '2026-07-18T00:04:00Z', aging_days: 1 },
    ]);

    expect(next).toBe(board);
  });

  it('uses updated_on as a tie breaker for the same lock version', () => {
    const board = makeBoardData([
      makeIssue(10, { done_ratio: 75, lock_version: 5, updated_on: '2026-07-18T00:05:00Z', aging_days: 0 }),
    ]);

    const next = applyAncestorIssueUpdates(board, [
      { id: 10, done_ratio: 50, lock_version: 5, updated_on: '2026-07-18T00:04:00Z', aging_days: 1 },
    ]);

    expect(next).toBe(board);
  });

  it('keeps the newest update when responses arrive out of order', () => {
    const board = makeBoardData([makeIssue(10, { done_ratio: 0, lock_version: 1, updated_on: '2026-07-18T00:00:00Z', aging_days: 0 })]);

    const afterNew = applyAncestorIssueUpdates(board, [
      { id: 10, done_ratio: 75, lock_version: 3, updated_on: '2026-07-18T00:03:00Z', aging_days: 0 },
    ]);
    const afterLateOld = applyAncestorIssueUpdates(afterNew, [
      { id: 10, done_ratio: 25, lock_version: 2, updated_on: '2026-07-18T00:02:00Z', aging_days: 0 },
    ]);

    expect(afterLateOld.issues[0]).toMatchObject({ done_ratio: 75, lock_version: 3, aging_days: 0 });
  });

  it('does not throw or reject an update because of an invalid date', () => {
    const board = makeBoardData([makeIssue(10, { done_ratio: 0, lock_version: 1, updated_on: 'not-a-date' })]);

    const next = applyAncestorIssueUpdates(board, [
      { id: 10, done_ratio: 25, lock_version: 2, updated_on: 'also-not-a-date', aging_days: 0 },
    ]);

    expect(next.issues[0].done_ratio).toBe(25);
  });
});

describe('replaceIssueInBoard', () => {
  it('replaces an issue by id', () => {
    const board = makeBoardData([makeIssue(1, { subject: 'Before' })]);
    const next = replaceIssueInBoard(board, makeIssue(1, { subject: 'After' }));
    expect(next.issues[0].subject).toBe('After');
  });
});

describe('isIssueFresh', () => {
  it('rejects an older normal success response by lock version', () => {
    expect(isIssueFresh(
      makeIssue(1, { lock_version: 12, done_ratio: 80 }),
      makeIssue(1, { lock_version: 11, done_ratio: 20 }),
    )).toBe(false);
  });

  it('rejects an older response with the same lock version by updated_on', () => {
    expect(isIssueFresh(
      makeIssue(1, { lock_version: 12, updated_on: '2026-07-22T00:02:00Z' }),
      makeIssue(1, { lock_version: 12, updated_on: '2026-07-22T00:01:00Z' }),
    )).toBe(false);
  });
});

describe('useIssueMutation', () => {
  it('does not replace a newer cached issue with a late normal success response', async () => {
    const queryKey = ['kanban', 'board', 'freshness'] as const;
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    queryClient.setQueryData(queryKey, makeBoardData([
      makeIssue(1, { lock_version: 12, done_ratio: 80, status_id: 2, updated_on: '2026-07-22T00:02:00Z' }),
    ]));

    const { result } = renderHook(
      () => useIssueMutation({
        queryKey,
        mutationFn: async () => ({ issue: makeIssue(1, { lock_version: 11, done_ratio: 20, status_id: 1, updated_on: '2026-07-22T00:01:00Z' }) }),
        applyOptimistic: (data) => data,
        applyServer: (data, response: { issue: Issue }, _payload, options = { applyTarget: true }) =>
          options.applyTarget ? replaceIssueInBoard(data, response.issue) : data,
      }),
      { wrapper: createWrapper(queryClient) },
    );

    await act(async () => { await result.current.mutateAsync({ issueId: 1 }); });

    expect(queryClient.getQueryData<BoardData>(queryKey)?.issues[0]).toMatchObject({
      lock_version: 12,
      done_ratio: 80,
      status_id: 2,
    });
  });

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
          applyServer: (data, res) => replaceIssueInBoard(data, res.issue),
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

  it('does not invalidate the board query after mutation by default', async () => {
    const queryKey = ['kanban', 'board', 'no-refetch'] as const;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const initial = makeBoardData([makeIssue(1, { subject: 'Before' })]);
    queryClient.setQueryData(queryKey, initial);
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(
      () =>
        useIssueMutation({
          queryKey,
          mutationFn: async () => ({ issue: makeIssue(1, { subject: 'Server' }) }),
          applyOptimistic: (data) => updateIssueInBoard(data, 1, (i) => ({ ...i, subject: 'Optimistic' })),
          applyServer: (data, res) => replaceIssueInBoard(data, res.issue),
        }),
      { wrapper: createWrapper(queryClient) }
    );

    await act(async () => {
      await result.current.mutateAsync({ issueId: 1 });
    });

    expect(invalidateQueries).not.toHaveBeenCalled();
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
          applyServer: (data) => data,
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

  it('does not roll back a successful overlapping mutation when a later mutation fails', async () => {
    const queryKey = ['kanban', 'board', 'overlap'] as const;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    queryClient.setQueryData(queryKey, makeBoardData([
      makeIssue(1, { subject: 'V10', lock_version: 10, updated_on: '2026-07-22T00:10:00Z' }),
    ]));

    let resolveA!: (value: { issue: Issue }) => void;
    let rejectB!: (error: Error) => void;
    let callCount = 0;
    const mutationA = new Promise<{ issue: Issue }>((resolve) => { resolveA = resolve; });
    const mutationB = new Promise<{ issue: Issue }>((_resolve, reject) => { rejectB = reject; });
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(
      () => useIssueMutation<{ issueId: number; name: string }, { issue: Issue }>({
        queryKey,
        mutationFn: () => {
          callCount += 1;
          return callCount === 1 ? mutationA : mutationB;
        },
        applyOptimistic: (data, payload) => updateIssueInBoard(data, payload.issueId, (issue) => ({
          ...issue,
          subject: payload.name,
        })),
        applyServer: (data, response) => replaceIssueInBoard(data, response.issue),
      }),
      { wrapper: createWrapper(queryClient) },
    );

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    await act(async () => {
      first = result.current.mutateAsync({ issueId: 1, name: 'A' });
      second = result.current.mutateAsync({ issueId: 1, name: 'B' });
      await waitFor(() => expect(callCount).toBe(2));
    });

    await act(async () => {
      resolveA({ issue: makeIssue(1, { subject: 'A', lock_version: 11, updated_on: '2026-07-22T00:11:00Z' }) });
      await first;
    });
    expect(queryClient.getQueryData<BoardData>(queryKey)?.issues[0].subject).toBe('B');

    await act(async () => {
      rejectB(new Error('B failed'));
      await expect(second).rejects.toThrow('B failed');
    });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey });
    expect(queryClient.getQueryData<BoardData>(queryKey)?.issues[0].subject).not.toBe('V10');
  });

  it('keeps an issue busy until the latest overlapping mutation settles', async () => {
    const queryKey = ['kanban', 'board', 'busy'] as const;
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    queryClient.setQueryData(queryKey, makeBoardData([makeIssue(1)]));

    let resolveA!: (value: { issue: Issue }) => void;
    let resolveB!: (value: { issue: Issue }) => void;
    let callCount = 0;
    const mutationA = new Promise<{ issue: Issue }>((resolve) => { resolveA = resolve; });
    const mutationB = new Promise<{ issue: Issue }>((resolve) => { resolveB = resolve; });
    const onSettledIssue = vi.fn();

    const { result } = renderHook(
      () => useIssueMutation<{ issueId: number; name: string }, { issue: Issue }>({
        queryKey,
        mutationFn: () => {
          callCount += 1;
          return callCount === 1 ? mutationA : mutationB;
        },
        applyOptimistic: (data) => data,
        applyServer: (data) => data,
        onSettledIssue,
      }),
      { wrapper: createWrapper(queryClient) },
    );

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    await act(async () => {
      first = result.current.mutateAsync({ issueId: 1, name: 'A' });
      second = result.current.mutateAsync({ issueId: 1, name: 'B' });
      await waitFor(() => expect(callCount).toBe(2));
    });

    await act(async () => {
      resolveA({ issue: makeIssue(1, { lock_version: 2 }) });
      await first;
    });
    expect(onSettledIssue).not.toHaveBeenCalled();

    await act(async () => {
      resolveB({ issue: makeIssue(1, { lock_version: 3 }) });
      await second;
    });
    expect(onSettledIssue).toHaveBeenCalledTimes(1);
    expect(onSettledIssue).toHaveBeenCalledWith(1);
  });

  it('reports every overlapping mutation settlement for counter-based busy state', async () => {
    const queryKey = ['kanban', 'board', 'busy-counter'] as const;
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    queryClient.setQueryData(queryKey, makeBoardData([makeIssue(1)]));

    let resolveA!: (value: { issue: Issue }) => void;
    let resolveB!: (value: { issue: Issue }) => void;
    let callCount = 0;
    const mutationA = new Promise<{ issue: Issue }>((resolve) => { resolveA = resolve; });
    const mutationB = new Promise<{ issue: Issue }>((resolve) => { resolveB = resolve; });
    const onSettledMutation = vi.fn();

    const { result } = renderHook(
      () => useIssueMutation<{ issueId: number; name: string }, { issue: Issue }>({
        queryKey,
        mutationFn: () => {
          callCount += 1;
          return callCount === 1 ? mutationA : mutationB;
        },
        applyOptimistic: (data) => data,
        applyServer: (data) => data,
        onSettledMutation,
      }),
      { wrapper: createWrapper(queryClient) },
    );

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    await act(async () => {
      first = result.current.mutateAsync({ issueId: 1, name: 'A' });
      second = result.current.mutateAsync({ issueId: 1, name: 'B' });
      await waitFor(() => expect(callCount).toBe(2));
    });

    await act(async () => {
      resolveB({ issue: makeIssue(1, { lock_version: 3 }) });
      await second;
    });
    expect(onSettledMutation).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveA({ issue: makeIssue(1, { lock_version: 2 }) });
      await first;
    });
    expect(onSettledMutation).toHaveBeenCalledTimes(2);
    expect(onSettledMutation).toHaveBeenNthCalledWith(1, 1);
    expect(onSettledMutation).toHaveBeenNthCalledWith(2, 1);
  });
});
