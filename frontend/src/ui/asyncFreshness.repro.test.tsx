// @vitest-environment jsdom

import React, { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardData, Issue } from './types';
import { applyMutationResponse, invalidateBoardSnapshot, useIssueMutation } from './useIssueMutation';
import { useKanbanActions } from './useKanbanActions';
import { applyLocalIssuePatch } from './boardState';
import { getBoardFreshnessAuthority, releaseBoardFreshnessAuthority } from './asyncFreshness';

const getJsonMock = vi.hoisted(() => vi.fn());
const postJsonMock = vi.hoisted(() => vi.fn());

vi.mock('./http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http')>()),
  getJson: getJsonMock,
  postJson: postJsonMock,
}));

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function issue(id: number, attrs: Partial<Issue> = {}): Issue {
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

function board(issues: Issue[] = [issue(1)]): BoardData {
  return {
    ok: true,
    contract_version: 3,
    scope_fingerprint: 'project:1',
    meta: {
      project_id: 1,
      project_ids: [1],
      scope_fingerprint: 'project:1',
      current_user_id: 1,
      can_move: true,
      can_create: true,
      can_delete: true,
      lane_type: 'none',
      aging_warn_days: 3,
      aging_danger_days: 7,
      aging_exclude_closed: true,
      scope_status_ids: [1, 2],
      dependency_status_ids: [1, 2],
      complete: true,
      entity_count: issues.length,
      requested_entity_limit: 1500,
      effective_entity_limit: 1500,
      server_entity_limit: 5000,
    },
    columns: [
      { id: 1, name: 'Open', is_closed: false, count: issues.length },
      { id: 2, name: 'Closed', is_closed: true, count: 0 },
    ],
    lanes: [],
    lists: { assignees: [], trackers: [], priorities: [], projects: [], viewable_projects: [], creatable_projects: [] },
    issues,
    labels: {},
  };
}

function countResponse(open: number, closed = 0): { columns: BoardData['columns'] } {
  return {
    columns: [
      { id: 1, name: 'Open', is_closed: false, count: open },
      { id: 2, name: 'Closed', is_closed: true, count: closed },
    ],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  getJsonMock.mockReset();
  postJsonMock.mockReset();
});

describe('async freshness authority', () => {
  it('releases completed request metadata instead of retaining request history', () => {
    const queryClient = new QueryClient();
    const queryKey = ['kanban', 'board', 'repro-resource'] as const;
    const authority = getBoardFreshnessAuthority(queryClient, queryKey);
    const request = authority.beginEntityReconciliation(board(), [1]);

    expect(authority.activeRequestCount).toBe(1);
    authority.finish(request);
    releaseBoardFreshnessAuthority(queryClient, queryKey, authority);

    expect(getBoardFreshnessAuthority(queryClient, queryKey)).not.toBe(authority);
  });

  it('keeps a fresh non-target issue update when the target response is stale', async () => {
    const queryKey = ['kanban', 'board', 'repro-t1'] as const;
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const parent = issue(1, { subtasks: [{ ...issue(2), parent_id: 1, subject: 'Child before' } as never] });
    queryClient.setQueryData(queryKey, board([parent]));

    let resolveA!: (value: { issue: Issue; issue_updates: Issue[] }) => void;
    let callCount = 0;
    const requestA = new Promise<{ issue: Issue; issue_updates: Issue[] }>((resolve) => { resolveA = resolve; });

    const { result } = renderHook(
      () => useIssueMutation<{ issueId: number; subject: string }, { issue: Issue; issue_updates: Issue[] }>({
        queryKey,
        mutationFn: () => {
          callCount += 1;
          if (callCount === 1) return requestA;
          return new Promise(() => undefined);
        },
        applyOptimistic: (data, payload) => applyLocalIssuePatch(data, payload.issueId, { subject: payload.subject }),
        applyServer: (data, response, payload, options = { applyTarget: true }) => {
          const next = options.applyTarget
            ? applyMutationResponse(data, response)
            : applyMutationResponse(data, response, { excludeIssueId: payload.issueId });
          return options.applyTarget || options.applyNonTarget ? next : data;
        },
      }),
      { wrapper: createWrapper(queryClient) },
    );

    act(() => {
      result.current.mutate({ issueId: 1, subject: 'Optimistic A' });
      result.current.mutate({ issueId: 1, subject: 'Optimistic B' });
    });
    await waitFor(() => expect(callCount).toBe(2));

    await act(async () => {
      resolveA({
        issue: issue(1, { subject: 'Server A', lock_version: 2 }),
        issue_updates: [
          issue(1, { subject: 'Server A', lock_version: 2 }),
          issue(2, { parent_id: 1, subject: 'Child propagated', lock_version: 2 }),
        ],
      });
      await Promise.resolve();
    });

    const current = queryClient.getQueryData<BoardData>(queryKey)!;
    expect(current.issues[0]?.subject).toBe('Optimistic B');
    expect(current.issues[0]?.subtasks?.[0]?.subject).toBe('Child propagated');
  });

  it('does not let stale missing_issue_ids evict a newer same-scope entity', async () => {
    const queryKey = ['kanban', 'board', 'repro-t2'] as const;
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const initial = board([issue(1, { subject: 'X before' })]);
    queryClient.setQueryData(queryKey, initial);
    let resolveReconciliation!: (value: { scope_fingerprint: string; entities: Issue[]; missing_issue_ids: number[] }) => void;
    getJsonMock.mockReturnValueOnce(new Promise((resolve) => { resolveReconciliation = resolve; }));

    const { result } = renderHook(
      () => useKanbanActions({
        baseUrl: '/projects/demo/kanban',
        boardQueryKey: queryKey,
        data: initial,
        timeEntryOnClose: false,
        setNotice: vi.fn(),
        setError: vi.fn(),
        setIframeTimeEntryUrl: vi.fn(),
      }),
      { wrapper: createWrapper(queryClient) },
    );

    let reconciliation!: Promise<void>;
    await act(async () => {
      reconciliation = result.current.reconcileIssueIds([1]);
      await waitFor(() => expect(getJsonMock).toHaveBeenCalledTimes(1));
    });
    queryClient.setQueryData(queryKey, applyMutationResponse(initial, {
      issue_updates: [issue(1, { subject: 'X newer', lock_version: 2 })],
    }));
    resolveReconciliation({ scope_fingerprint: 'project:1', entities: [], missing_issue_ids: [1] });
    await act(async () => { await reconciliation; });

    expect(queryClient.getQueryData<BoardData>(queryKey)?.issues[0]?.subject).toBe('X newer');
  });

  it('applies only the newest applicable column-count response', async () => {
    const queryKey = ['kanban', 'board', 'repro-t4'] as const;
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const initial = board([issue(1), issue(2)]);
    queryClient.setQueryData(queryKey, initial);
    let resolveCountsA!: (value: { columns: BoardData['columns'] }) => void;
    let resolveCountsB!: (value: { columns: BoardData['columns'] }) => void;
    getJsonMock
      .mockReturnValueOnce(new Promise((resolve) => { resolveCountsA = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveCountsB = resolve; }));
    postJsonMock
      .mockResolvedValueOnce({ ok: true, issue: issue(1, { lock_version: 2 }), invalidations: { column_counts: true } })
      .mockResolvedValueOnce({ ok: true, issue: issue(2, { lock_version: 2 }), invalidations: { column_counts: true } });

    const { result } = renderHook(
      () => useKanbanActions({
        baseUrl: '/projects/demo/kanban',
        boardQueryKey: queryKey,
        data: initial,
        timeEntryOnClose: false,
        setNotice: vi.fn(),
        setError: vi.fn(),
        setIframeTimeEntryUrl: vi.fn(),
      }),
      { wrapper: createWrapper(queryClient) },
    );

    await act(async () => {
      result.current.moveIssue(1, 2);
      result.current.moveIssue(2, 2);
      await waitFor(() => expect(getJsonMock).toHaveBeenCalledTimes(2));
    });
    await act(async () => {
      resolveCountsB(countResponse(8, 4));
      await Promise.resolve();
      resolveCountsA(countResponse(9, 3));
      await Promise.resolve();
    });

    expect(queryClient.getQueryData<BoardData>(queryKey)?.columns.map((column) => column.count)).toEqual([8, 4]);
  });

  it('rejects a pre-reset count response after an authoritative snapshot', async () => {
    const queryKey = ['kanban', 'board', 'repro-t5'] as const;
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const initial = board([issue(1)]);
    queryClient.setQueryData(queryKey, initial);
    let resolveCounts!: (value: { columns: BoardData['columns'] }) => void;
    getJsonMock.mockReturnValueOnce(new Promise((resolve) => { resolveCounts = resolve; }));
    postJsonMock.mockResolvedValueOnce({ ok: true, issue: issue(1, { lock_version: 2 }), invalidations: { column_counts: true } });

    const { result } = renderHook(
      () => useKanbanActions({
        baseUrl: '/projects/demo/kanban',
        boardQueryKey: queryKey,
        data: initial,
        timeEntryOnClose: false,
        setNotice: vi.fn(),
        setError: vi.fn(),
        setIframeTimeEntryUrl: vi.fn(),
      }),
      { wrapper: createWrapper(queryClient) },
    );

    await act(async () => {
      result.current.moveIssue(1, 2);
      await waitFor(() => expect(getJsonMock).toHaveBeenCalledTimes(1));
    });
    invalidateBoardSnapshot(queryClient, queryKey);
    const authoritative = board([issue(1, { subject: 'Authoritative', lock_version: 5 })]);
    authoritative.columns = countResponse(42, 0).columns;
    queryClient.setQueryData(queryKey, authoritative);
    resolveCounts(countResponse(7, 1));
    await act(async () => { await Promise.resolve(); });

    expect(queryClient.getQueryData<BoardData>(queryKey)?.issues[0]?.subject).toBe('Authoritative');
    expect(queryClient.getQueryData<BoardData>(queryKey)?.columns.map((column) => column.count)).toEqual([42, 0]);
  });

  it('rejects a pending scope-A reconciliation after the board moves to scope B', async () => {
    const queryKey = ['kanban', 'board', 'repro-t6'] as const;
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const scopeA = board([issue(1, { subject: 'Scope A' })]);
    queryClient.setQueryData(queryKey, scopeA);
    let resolveReconciliation!: (value: { scope_fingerprint: string; entities: Issue[]; missing_issue_ids: number[] }) => void;
    getJsonMock.mockReturnValueOnce(new Promise((resolve) => { resolveReconciliation = resolve; }));

    const { result } = renderHook(
      () => useKanbanActions({
        baseUrl: '/projects/demo/kanban',
        boardQueryKey: queryKey,
        data: scopeA,
        timeEntryOnClose: false,
        setNotice: vi.fn(),
        setError: vi.fn(),
        setIframeTimeEntryUrl: vi.fn(),
      }),
      { wrapper: createWrapper(queryClient) },
    );

    let reconciliation!: Promise<void>;
    await act(async () => {
      reconciliation = result.current.reconcileIssueIds([1]);
      await waitFor(() => expect(getJsonMock).toHaveBeenCalledTimes(1));
    });
    const scopeB = board([issue(2, { subject: 'Scope B' })]);
    scopeB.scope_fingerprint = 'project:2';
    scopeB.meta.scope_fingerprint = 'project:2';
    scopeB.meta.project_ids = [2];
    queryClient.setQueryData(queryKey, scopeB);
    resolveReconciliation({ scope_fingerprint: 'project:1', entities: [issue(1, { subject: 'Old scope response' })], missing_issue_ids: [] });
    await act(async () => { await reconciliation; });

    expect(queryClient.getQueryData<BoardData>(queryKey)?.issues.map((candidate) => candidate.id)).toEqual([2]);
  });
});
