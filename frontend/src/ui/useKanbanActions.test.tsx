// @vitest-environment jsdom

import React, { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardData, Issue } from './types';
import { useKanbanActions } from './useKanbanActions';

function makeIssue(id = 1): Issue {
  return {
    id,
    subject: `Issue ${id}`,
    status_id: 1,
    tracker_id: 1,
    description: '',
    assigned_to_id: null,
    lock_version: 3,
    urls: { issue: `/issues/${id}`, issue_edit: `/issues/${id}/edit` },
  };
}

function makeBoardData(issue = makeIssue()): BoardData {
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
    columns: [{ id: 1, name: 'Open', is_closed: false, count: 1 }],
    lanes: [],
    lists: { assignees: [], trackers: [], priorities: [], projects: [], viewable_projects: [], creatable_projects: [] },
    issues: [issue],
    labels: { delete_failed: '削除に失敗しました' },
  };
}

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function renderActions(options: { data?: BoardData; refresh?: () => Promise<void>; setError?: (value: string | null) => void } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const setError = options.setError ?? vi.fn();
  const refresh = options.refresh ?? vi.fn(async () => undefined);
  const hook = renderHook(
    () => useKanbanActions({
      baseUrl: '/projects/demo/kanban',
      boardQueryKey: ['kanban', 'board'],
      data: options.data ?? makeBoardData(),
      refresh,
      timeEntryOnClose: false,
      setNotice: vi.fn(),
      setError,
      setIframeTimeEntryUrl: vi.fn(),
    }),
    { wrapper: createWrapper(queryClient) },
  );
  return { ...hook, setError, refresh };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useKanbanActions delete flow', () => {
  it('does not show an error after a successful delete without a full refresh', async () => {
    const setError = vi.fn();
    const refresh = vi.fn(async () => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const { result } = renderActions({ refresh, setError });

    await act(async () => { result.current.requestDelete(1); });
    await waitFor(() => expect(result.current.pendingDeleteIssue?.id).toBe(1));

    expect(setError).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('keeps Undo available after a successful delete without a full refresh', async () => {
    const setError = vi.fn();
    const refresh = vi.fn(async () => { throw new Error('refetch failed'); });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const { result } = renderActions({ refresh, setError });

    await act(async () => { result.current.requestDelete(1); });
    await waitFor(() => expect(result.current.pendingDeleteIssue?.id).toBe(1));

    expect(result.current.pendingDeleteIssue?.id).toBe(1);
    expect(setError).not.toHaveBeenCalledWith('削除に失敗しました');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not issue another DELETE when the delete notice is dismissed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const { result } = renderActions();

    await act(async () => { result.current.requestDelete(1); });
    await waitFor(() => expect(result.current.pendingDeleteIssue?.id).toBe(1));

    act(() => { result.current.dismissDeleteNotice(); });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/projects/demo/kanban/issues/1?scope_status_ids_present=1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(result.current.pendingDeleteIssue).toBeNull();
  });

  it('shows the API message for an HTTP delete error and clears Undo', async () => {
    const setError = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ message: 'ロックが競合しました' }), { status: 409 }));
    const { result } = renderActions({ setError });

    await act(async () => { result.current.requestDelete(1); });
    await waitFor(() => expect(setError).toHaveBeenCalledWith('ロックが競合しました'));

    expect(result.current.pendingDeleteIssue).toBeNull();
  });

  it('treats an ok false response as a delete failure', async () => {
    const setError = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: false, message: '削除できません' }), { status: 200 }));
    const { result } = renderActions({ setError });

    await act(async () => { result.current.requestDelete(1); });
    await waitFor(() => expect(setError).toHaveBeenCalledWith('削除できません'));

    expect(result.current.pendingDeleteIssue).toBeNull();
  });

  it('deletes a nested subtask and does not create an Undo payload', async () => {
    const board = makeBoardData(makeIssue(1));
    board.issues[0].subtasks = [{ id: 2, subject: 'Nested', status_id: 1, is_closed: false, lock_version: 4 }];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const { result } = renderActions({ data: board });

    await act(async () => { result.current.requestDelete(2); });
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));

    expect(globalThis.fetch).toHaveBeenCalledWith('/projects/demo/kanban/issues/2?scope_status_ids_present=1', expect.objectContaining({ method: 'DELETE' }));
    expect(result.current.pendingDeleteIssue).toBeNull();
  });

  it('does not offer recreation when a child issue is displayed as an individual card', async () => {
    const childCard = makeIssue(2);
    childCard.parent_id = 1;
    const board = makeBoardData(childCard);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const { result } = renderActions({ data: board });

    await act(async () => { result.current.requestDelete(2); });
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));

    expect(result.current.pendingDeleteIssue).toBeNull();
  });

  it('preserves the current board project scope for mutation requests', async () => {
    const board = makeBoardData();
    board.meta.project_ids = [3, 7];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const { result } = renderActions({ data: board });

    await act(async () => { result.current.requestDelete(1); });
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/projects/demo/kanban/issues/1?project_ids%5B%5D=3&project_ids%5B%5D=7&scope_status_ids_present=1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('sends one DELETE while the same issue is in flight', async () => {
    let resolveFetch!: (response: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve; }));
    const { result } = renderActions();

    act(() => {
      result.current.requestDelete(1);
      result.current.requestDelete(1);
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    await act(async () => { resolveFetch(new Response(JSON.stringify({ ok: true }), { status: 200 })); });
    await waitFor(() => expect(result.current.pendingDeleteIssue?.id).toBe(1));
  });
});

describe('useKanbanActions nested toggle flow', () => {
  it('uses the canonical lock version for a consecutive close then reopen', async () => {
    const queryKey = ['kanban', 'board', 'toggle'] as const;
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const initial = makeBoardData(makeIssue(1));
    initial.columns = [
      { id: 1, name: 'Open', is_closed: false, count: 100 },
      { id: 2, name: 'Closed', is_closed: true, count: 20 },
    ];
    initial.issues[0].subtasks = [{
      id: 2,
      subject: 'Nested',
      status_id: 1,
      is_closed: false,
      lock_version: 3,
      allowed_status_ids: [1, 2],
    }];
    queryClient.setQueryData(queryKey, initial);

    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        issue: { ...makeIssue(2), status_id: 2, lock_version: 4 },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        issue: { ...makeIssue(2), status_id: 1, lock_version: 5 },
      }), { status: 200 }));

    const { result, rerender } = renderHook(
      ({ data }: { data: BoardData }) => useKanbanActions({
        baseUrl: '/projects/demo/kanban',
        boardQueryKey: queryKey,
        data,
        refresh: vi.fn(async () => undefined),
        timeEntryOnClose: false,
        setNotice: vi.fn(),
        setError: vi.fn(),
        setIframeTimeEntryUrl: vi.fn(),
      }),
      {
        initialProps: { data: initial },
        wrapper: createWrapper(queryClient),
      },
    );

    act(() => { result.current.toggleSubtask(2, false); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(queryClient.getQueryData<BoardData>(queryKey)?.issues[0].subtasks?.[0]).toMatchObject({
        status_id: 2,
        is_closed: true,
        lock_version: 4,
      });
    });

    const afterClose = queryClient.getQueryData<BoardData>(queryKey)!;
    rerender({ data: afterClose });
    act(() => { result.current.toggleSubtask(2, true); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const firstRequest = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(firstRequest.issue.lock_version).toBe(3);
    expect(secondRequest.issue.lock_version).toBe(4);
    await waitFor(() => {
      expect(queryClient.getQueryData<BoardData>(queryKey)?.issues[0].subtasks?.[0]).toMatchObject({
        status_id: 1,
        is_closed: false,
        lock_version: 5,
      });
    });
  });

  it.each([
    [422, 'Validation failed'],
    [409, 'Conflict'],
  ])('rolls back nested state and counts after an HTTP %i response', async (status, message) => {
    const queryKey = ['kanban', 'board', 'toggle-error', status] as const;
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const initial = makeBoardData(makeIssue(1));
    initial.columns = [
      { id: 1, name: 'Open', is_closed: false, count: 100 },
      { id: 2, name: 'Closed', is_closed: true, count: 20 },
    ];
    initial.issues[0].subtasks = [{
      id: 2,
      subject: 'Nested',
      status_id: 1,
      is_closed: false,
      lock_version: 3,
      allowed_status_ids: [1, 2],
    }];
    queryClient.setQueryData(queryKey, initial);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ message }),
      { status },
    ));

    const { result } = renderHook(
      () => useKanbanActions({
        baseUrl: '/projects/demo/kanban',
        boardQueryKey: queryKey,
        data: initial,
        refresh: vi.fn(async () => undefined),
        timeEntryOnClose: false,
        setNotice: vi.fn(),
        setError: vi.fn(),
        setIframeTimeEntryUrl: vi.fn(),
      }),
      { wrapper: createWrapper(queryClient) },
    );

    act(() => { result.current.toggleSubtask(2, false); });

    await waitFor(() => {
      expect(queryClient.getQueryData<BoardData>(queryKey)?.issues[0].subtasks?.[0]).toMatchObject({
        status_id: 1,
        is_closed: false,
        lock_version: 3,
      });
    });
    expect(queryClient.getQueryData<BoardData>(queryKey)?.columns.map((column) => column.count)).toEqual([100, 20]);
  });
});
