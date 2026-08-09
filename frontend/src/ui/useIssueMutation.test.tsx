// @vitest-environment jsdom

import React, { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BoardData, Issue } from './types';
import { applyAncestorIssueUpdates, isBoardSnapshotInvalidated, isIssueFresh, replaceIssueInBoard, updateIssueInBoard, updateSubtaskInBoard, useIssueMutation } from './useIssueMutation';

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
  it('updates matching issue by applying a status-count delta to the server totals', () => {
    const board = makeBoardData([
      makeIssue(1, { status_id: 1 }),
      makeIssue(2, { status_id: 1 }),
      makeIssue(3, { status_id: 2 }),
    ]);
    board.columns[0].count = 699;
    board.columns[1].count = 1;

    const next = updateIssueInBoard(board, 2, (issue) => ({ ...issue, status_id: 2 }));

    expect(next.issues.find((issue) => issue.id === 2)?.status_id).toBe(2);
    expect(next.columns.find((column) => column.id === 1)?.count).toBe(698);
    expect(next.columns.find((column) => column.id === 2)?.count).toBe(2);
  });

  it('does not change column counts when an edit preserves status', () => {
    const board = makeBoardData([makeIssue(1, { status_id: 1 })]);
    board.columns[0].count = 700;

    const next = updateIssueInBoard(board, 1, (issue) => ({ ...issue, subject: 'Edited' }));

    expect(next.columns.find((column) => column.id === 1)?.count).toBe(700);
  });

  it('updates server column totals when only a nested subtask changes status', () => {
    const board = makeBoardData([
      makeIssue(10, { subtasks: [{ id: 20, subject: 'Nested', status_id: 1, is_closed: false }] }),
    ]);
    board.columns[0].count = 100;
    board.columns[1].count = 20;

    const next = updateIssueInBoard(board, 20, (issue) => ({ ...issue, status_id: 2 }));

    expect(next.issues[0].subtasks?.[0]).toMatchObject({ id: 20, status_id: 2, is_closed: true });
    expect(next.columns.find((column) => column.id === 1)?.count).toBe(99);
    expect(next.columns.find((column) => column.id === 2)?.count).toBe(21);
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

  it('updates column totals for a nested subtask patch without a top-level card', () => {
    const board = makeBoardData([
      makeIssue(10, { subtasks: [{ id: 20, subject: 'Child', status_id: 2, is_closed: true }] }),
    ]);
    board.columns[0].count = 99;
    board.columns[1].count = 21;

    const next = updateSubtaskInBoard(board, 20, { status_id: 1, is_closed: false });

    expect(next.columns.find((column) => column.id === 1)?.count).toBe(100);
    expect(next.columns.find((column) => column.id === 2)?.count).toBe(20);
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

  it('updates nested-only ancestors and rejects an older nested response', () => {
    const board = makeBoardData([
      makeIssue(10, {
        subtasks: [{
          id: 20,
          subject: 'Parent',
          status_id: 1,
          is_closed: false,
          lock_version: 1,
          updated_on: '2026-07-18T00:00:00Z',
          subtasks: [{ id: 30, subject: 'Child', status_id: 1, is_closed: false }],
        }],
      }),
    ]);

    const fresh = applyAncestorIssueUpdates(board, [
      { id: 20, done_ratio: 50, lock_version: 2, updated_on: '2026-07-18T00:02:00Z', aging_days: 0 },
    ]);
    const stale = applyAncestorIssueUpdates(fresh, [
      { id: 20, done_ratio: 25, lock_version: 1, updated_on: '2026-07-18T00:01:00Z', aging_days: 1 },
    ]);

    expect(stale.issues[0]?.subtasks?.[0]).toMatchObject({ done_ratio: 50, lock_version: 2, aging_days: 0 });
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
  it('keeps top-level and nested copies of the same issue canonical', () => {
    const board = makeBoardData([
      makeIssue(1, { subtasks: [{ id: 2, subject: 'Old copy', status_id: 1, is_closed: false, lock_version: 1 }] }),
      makeIssue(2, { subject: 'Old copy', lock_version: 1 }),
    ]);

    const next = replaceIssueInBoard(board, makeIssue(2, { subject: 'Canonical', lock_version: 2, done_ratio: 50, updated_on: '2026-07-18T00:02:00Z' }));

    expect(next.issues[1]).toMatchObject({ subject: 'Canonical', lock_version: 2, done_ratio: 50 });
    expect(next.issues[0]?.subtasks?.[0]).toMatchObject({ subject: 'Canonical', lock_version: 2, done_ratio: 50 });
  });

  it('replaces an issue by id', () => {
    const board = makeBoardData([makeIssue(1, { subject: 'Before' })]);
    const next = replaceIssueInBoard(board, makeIssue(1, { subject: 'After' }));
    expect(next.issues[0].subject).toBe('After');
  });

  it('replaces a deeply nested subtask and applies a status-count delta', () => {
    const board = makeBoardData([
      makeIssue(10, {
        subtasks: [{
          id: 20,
          subject: 'Child',
          status_id: 1,
          is_closed: false,
          subtasks: [{
            id: 30,
            subject: 'Grandchild',
            status_id: 1,
            is_closed: false,
            lock_version: 4,
          }],
        }],
      }),
    ]);
    board.columns[0].count = 100;
    board.columns[1].count = 20;

    const next = replaceIssueInBoard(board, makeIssue(30, {
      subject: 'Server grandchild',
      status_id: 2,
      lock_version: 5,
    }));

    expect(next.issues[0].subtasks?.[0].subtasks?.[0]).toMatchObject({
      subject: 'Server grandchild',
      status_id: 2,
      is_closed: true,
      lock_version: 5,
    });
    expect(next.columns.map((column) => column.count)).toEqual([99, 21]);
  });

  it('preserves subtask-only attributes when applying a normal issue response', () => {
    const board = makeBoardData([
      makeIssue(10, {
        subtasks: [{
          id: 20,
          subject: 'Child',
          status_id: 1,
          tracker_id: 3,
          assigned_to_id: 8,
          priority_id: 2,
          due_date: '2026-08-01',
          is_closed: false,
          lock_version: 4,
          allowed_status_ids: [1, 2],
          permissions: { can_move: true, can_edit: true, can_delete: false },
          project: { id: 9, name: 'Subproject' },
          subtasks: [{ id: 30, subject: 'Grandchild', status_id: 1, is_closed: false }],
        }],
      }),
    ]);

    const next = replaceIssueInBoard(board, makeIssue(20, {
      subject: 'Server child',
      status_id: 2,
      tracker_id: 3,
      assigned_to_id: 8,
      priority_id: 2,
      due_date: '2026-08-01',
      lock_version: 5,
    }));
    const child = next.issues[0].subtasks?.[0];

    expect(child).toMatchObject({
      subject: 'Server child',
      status_id: 2,
      is_closed: true,
      lock_version: 5,
      allowed_status_ids: [1, 2],
      permissions: { can_move: true, can_edit: true, can_delete: false },
      project: { id: 9, name: 'Subproject' },
    });
    expect(child?.subtasks?.map((subtask) => subtask.id)).toEqual([30]);
  });

  it('derives an open subtask state from the canonical server status', () => {
    const board = makeBoardData([
      makeIssue(10, {
        subtasks: [{
          id: 20,
          subject: 'Closed child',
          status_id: 2,
          is_closed: true,
          lock_version: 5,
        }],
      }),
    ]);
    board.columns[0].count = 99;
    board.columns[1].count = 21;

    const next = replaceIssueInBoard(board, makeIssue(20, {
      subject: 'Reopened child',
      status_id: 1,
      lock_version: 6,
    }));

    expect(next.issues[0].subtasks?.[0]).toMatchObject({
      status_id: 1,
      is_closed: false,
      lock_version: 6,
    });
    expect(next.columns.map((column) => column.count)).toEqual([100, 20]);
  });

  it('keeps snapshot metadata and applies deltas to full server counts', () => {
    const board = makeBoardData([
      makeIssue(10, {
        subtasks: [{
          id: 20,
          subject: 'Loaded child',
          status_id: 1,
          is_closed: false,
          lock_version: 4,
        }],
      }),
    ]);
    board.meta.entity_count = 2;
    board.columns[0].count = 680;
    board.columns[1].count = 20;

    const next = replaceIssueInBoard(board, makeIssue(20, {
      status_id: 2,
      lock_version: 5,
    }));

    expect(next.columns.map((column) => column.count)).toEqual([679, 21]);
    expect(next.meta.entity_count).toBe(2);
    expect(next.issues).toHaveLength(1);
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
  it('clears the complete board and refetches when the server invalidates the snapshot', async () => {
    const queryKey = ['kanban', 'board', 'snapshot-overflow'] as const;
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    queryClient.setQueryData(queryKey, makeBoardData([makeIssue(1, { subject: 'Before' })]));
    const resetQueries = vi.spyOn(queryClient, 'resetQueries');

    const { result } = renderHook(
      () => useIssueMutation({
        queryKey,
        mutationFn: async () => ({
          issue: makeIssue(1, { subject: 'Persisted domain mutation' }),
          issue_updates: [],
          invalidations: { board_snapshot: true },
        }),
        applyOptimistic: (data) => updateIssueInBoard(data, 1, (issue) => ({ ...issue, subject: 'Optimistic' })),
        applyServer: (data, response: { issue: Issue }) => replaceIssueInBoard(data, response.issue),
      }),
      { wrapper: createWrapper(queryClient) },
    );

    await act(async () => { await result.current.mutateAsync({ issueId: 1 }); });

    expect(isBoardSnapshotInvalidated({ invalidations: { board_snapshot: true } })).toBe(true);
    expect(queryClient.getQueryData<BoardData>(queryKey)).toBeUndefined();
    expect(resetQueries).toHaveBeenCalledWith({ queryKey });
  });

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

  it('does not rewind a nested subtask or server counts with a stale response', async () => {
    const queryKey = ['kanban', 'board', 'nested-freshness'] as const;
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const current = makeBoardData([
      makeIssue(10, {
        subtasks: [{
          id: 20,
          subject: 'Current child',
          status_id: 1,
          is_closed: false,
          lock_version: 12,
          allowed_status_ids: [1, 2],
        }],
      }),
    ]);
    current.columns[0].count = 100;
    current.columns[1].count = 20;
    queryClient.setQueryData(queryKey, current);

    const { result } = renderHook(
      () => useIssueMutation({
        queryKey,
        mutationFn: async () => ({
          issue: makeIssue(20, {
            subject: 'Stale child',
            status_id: 2,
            lock_version: 11,
          }),
        }),
        applyOptimistic: (data) => data,
        applyServer: (data, response: { issue: Issue }, _payload, options = { applyTarget: true }) =>
          options.applyTarget ? replaceIssueInBoard(data, response.issue) : data,
      }),
      { wrapper: createWrapper(queryClient) },
    );

    await act(async () => { await result.current.mutateAsync({ issueId: 20 }); });

    const next = queryClient.getQueryData<BoardData>(queryKey);
    expect(next?.issues[0].subtasks?.[0]).toMatchObject({
      subject: 'Current child',
      status_id: 1,
      is_closed: false,
      lock_version: 12,
    });
    expect(next?.columns.map((column) => column.count)).toEqual([100, 20]);
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

  it('rolls back nested subtask status and server column totals on error', async () => {
    const queryKey = ['kanban', 'board', 'nested-error'] as const;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const initial = makeBoardData([
      makeIssue(10, {
        subtasks: [{
          id: 20,
          subject: 'Child',
          status_id: 1,
          is_closed: false,
          lock_version: 3,
        }],
      }),
    ]);
    initial.columns[0].count = 100;
    initial.columns[1].count = 20;
    queryClient.setQueryData(queryKey, initial);

    const { result } = renderHook(
      () => useIssueMutation({
        queryKey,
        mutationFn: async () => { throw new Error('validation failed'); },
        applyOptimistic: (data) => updateIssueInBoard(data, 20, (issue) => ({
          ...issue,
          status_id: 2,
        })),
        applyServer: (data) => data,
      }),
      { wrapper: createWrapper(queryClient) },
    );

    await act(async () => {
      await expect(result.current.mutateAsync({ issueId: 20 })).rejects.toThrow('validation failed');
    });

    const current = queryClient.getQueryData<BoardData>(queryKey);
    expect(current?.issues[0].subtasks?.[0]).toMatchObject({
      status_id: 1,
      is_closed: false,
      lock_version: 3,
    });
    expect(current?.columns.map((column) => column.count)).toEqual([100, 20]);
  });

  it('rolls back a failed nested reopen and restores server column totals', async () => {
    const queryKey = ['kanban', 'board', 'nested-reopen-error'] as const;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const initial = makeBoardData([
      makeIssue(10, {
        subtasks: [{
          id: 20,
          subject: 'Child',
          status_id: 2,
          is_closed: true,
          lock_version: 4,
        }],
      }),
    ]);
    initial.columns[0].count = 99;
    initial.columns[1].count = 21;
    queryClient.setQueryData(queryKey, initial);

    const { result } = renderHook(
      () => useIssueMutation({
        queryKey,
        mutationFn: async () => { throw new Error('conflict'); },
        applyOptimistic: (data) => updateIssueInBoard(data, 20, (issue) => ({
          ...issue,
          status_id: 1,
        })),
        applyServer: (data) => data,
      }),
      { wrapper: createWrapper(queryClient) },
    );

    await act(async () => {
      await expect(result.current.mutateAsync({ issueId: 20 })).rejects.toThrow('conflict');
    });

    const current = queryClient.getQueryData<BoardData>(queryKey);
    expect(current?.issues[0].subtasks?.[0]).toMatchObject({
      status_id: 2,
      is_closed: true,
      lock_version: 4,
    });
    expect(current?.columns.map((column) => column.count)).toEqual([99, 21]);
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

  it('does not let overlapping nested responses or failures corrupt column counts', async () => {
    const queryKey = ['kanban', 'board', 'nested-overlap'] as const;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const initial = makeBoardData([
      makeIssue(10, {
        subtasks: [{
          id: 20,
          subject: 'Child',
          status_id: 1,
          is_closed: false,
          lock_version: 10,
        }],
      }),
    ]);
    initial.columns[0].count = 100;
    initial.columns[1].count = 20;
    queryClient.setQueryData(queryKey, initial);

    let resolveClose!: (value: { issue: Issue }) => void;
    let rejectReopen!: (error: Error) => void;
    let callCount = 0;
    const closeRequest = new Promise<{ issue: Issue }>((resolve) => { resolveClose = resolve; });
    const reopenRequest = new Promise<{ issue: Issue }>((_resolve, reject) => { rejectReopen = reject; });
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(
      () => useIssueMutation<{ issueId: number; statusId: number }, { issue: Issue }>({
        queryKey,
        mutationFn: () => {
          callCount += 1;
          return callCount === 1 ? closeRequest : reopenRequest;
        },
        applyOptimistic: (data, payload) => updateIssueInBoard(data, payload.issueId, (issue) => ({
          ...issue,
          status_id: payload.statusId,
        })),
        applyServer: (data, response, _payload, options = { applyTarget: true }) =>
          options.applyTarget ? replaceIssueInBoard(data, response.issue) : data,
      }),
      { wrapper: createWrapper(queryClient) },
    );

    let close!: Promise<unknown>;
    let reopen!: Promise<unknown>;
    await act(async () => {
      close = result.current.mutateAsync({ issueId: 20, statusId: 2 });
      reopen = result.current.mutateAsync({ issueId: 20, statusId: 1 });
      await waitFor(() => expect(callCount).toBe(2));
    });

    await act(async () => {
      resolveClose({ issue: makeIssue(20, { status_id: 2, lock_version: 11 }) });
      await close;
    });
    expect(queryClient.getQueryData<BoardData>(queryKey)?.issues[0].subtasks?.[0]).toMatchObject({
      status_id: 1,
      is_closed: false,
    });
    expect(queryClient.getQueryData<BoardData>(queryKey)?.columns.map((column) => column.count)).toEqual([100, 20]);

    await act(async () => {
      rejectReopen(new Error('conflict'));
      await expect(reopen).rejects.toThrow('conflict');
    });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey });
    expect(queryClient.getQueryData<BoardData>(queryKey)?.columns.map((column) => column.count)).toEqual([100, 20]);
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
