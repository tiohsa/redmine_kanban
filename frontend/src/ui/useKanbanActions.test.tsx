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
      wip_limit_mode: 'column',
      wip_exceed_behavior: 'warn',
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

function renderActions(options: { refresh?: () => Promise<void>; setError?: (value: string | null) => void } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const setError = options.setError ?? vi.fn();
  const refresh = options.refresh ?? vi.fn(async () => undefined);
  const hook = renderHook(
    () => useKanbanActions({
      baseUrl: '/projects/demo/kanban',
      boardQueryKey: ['kanban', 'board'],
      data: makeBoardData(),
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
  it('does not show an error after a successful delete and refresh', async () => {
    const setError = vi.fn();
    const refresh = vi.fn(async () => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const { result } = renderActions({ refresh, setError });

    await act(async () => { result.current.requestDelete(1); });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    expect(setError).not.toHaveBeenCalled();
  });

  it('keeps Undo available when refresh fails after a successful delete', async () => {
    const setError = vi.fn();
    const refresh = vi.fn(async () => { throw new Error('refetch failed'); });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const { result } = renderActions({ refresh, setError });

    await act(async () => { result.current.requestDelete(1); });
    await waitFor(() => expect(refresh).toHaveBeenCalled());

    expect(result.current.pendingDeleteIssue?.id).toBe(1);
    expect(setError).not.toHaveBeenCalledWith('削除に失敗しました');
  });

  it('does not issue another DELETE when the delete notice is dismissed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const { result } = renderActions();

    await act(async () => { result.current.requestDelete(1); });
    await waitFor(() => expect(result.current.pendingDeleteIssue?.id).toBe(1));

    act(() => { result.current.dismissDeleteNotice(); });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/projects/demo/kanban/issues/1',
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
});
