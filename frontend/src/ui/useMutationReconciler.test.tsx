// @vitest-environment jsdom

import React, { type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardData, Issue } from './types';
import { findIssueInBoard } from '../model/board/selectors';
import type { IssueMutationResult } from '../infrastructure/api/contracts';
import { getBoardFreshnessAuthority } from './asyncFreshness';
import { applyIssueMutationResponse, useMutationReconciler } from './useMutationReconciler';

const getJsonMock = vi.hoisted(() => vi.fn());
vi.mock('../infrastructure/api/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../infrastructure/api/http')>()),
  getJson: getJsonMock,
}));

const queryKey = ['kanban', 'reconciler'] as const;

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

function board(issues = [issue(1)]): BoardData {
  return {
    ok: true,
    contract_version: 3,
    scope_fingerprint: 'project:1',
    meta: {
      project_id: 1, project_ids: [1], current_user_id: 1,
      can_move: true, can_create: true, can_delete: true, lane_type: 'none',
      aging_warn_days: 3, aging_danger_days: 7, aging_exclude_closed: true,
      scope_status_ids: [1, 2], dependency_status_ids: [1, 2],
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

function renderReconciler(data: BoardData | null = board(), onReconciliationFailure?: () => void) {
  const queryClient = new QueryClient();
  if (data) queryClient.setQueryData(queryKey, data);
  const hook = renderHook(() => useMutationReconciler({
    baseUrl: '/projects/demo/kanban', boardQueryKey: queryKey, data, onReconciliationFailure,
  }), {
    wrapper: ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  return { ...hook, queryClient, current: () => queryClient.getQueryData<BoardData>(queryKey)! };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  vi.restoreAllMocks();
  getJsonMock.mockReset();
});

describe('mutation response application', () => {
  it('releases its subscribed freshness authority on unmount', () => {
    const { queryClient, unmount } = renderReconciler();
    const authority = getBoardFreshnessAuthority(queryClient, queryKey);
    unmount();
    expect(getBoardFreshnessAuthority(queryClient, queryKey)).not.toBe(authority);
  });

  it('applies target, membership and tree effects while retaining counts until reconciliation', () => {
    const { result, queryClient, current } = renderReconciler(board([issue(1), issue(2), issue(3)]));
    const reset = vi.spyOn(queryClient, 'resetQueries');
    act(() => result.current.reconcileMutationResult({
      scope_fingerprint: 'project:1',
      issue_updates: [issue(1, { status_id: 2, lock_version: 2 })],
      created_issues: [issue(4, { parent_id: 1 })],
      deleted_issue_ids: [2], evicted_issue_ids: [3],
      tree_changes: [{ type: 'attach', parent_id: 1, child_id: 4 }],
    }));

    expect(current().issues.map((item) => item.id)).toEqual([1]);
    expect(findIssueInBoard(current(), 1)).toMatchObject({ status_id: 2, lock_version: 2 });
    expect(findIssueInBoard(current(), 4)).toMatchObject({ parent_id: 1 });
    expect(current().columns.map((column) => column.count)).toEqual([3, 0]);
    expect(reset).not.toHaveBeenCalled();
    expect(getJsonMock).not.toHaveBeenCalled();
  });

  it('keeps stale target and negative effects out while accepting fresh independent and ancestor updates', () => {
    const data = board([issue(1, { lock_version: 3 }), issue(2), issue(3), issue(4, { lock_version: 5, done_ratio: 90 })]);
    const response: IssueMutationResult = {
      issue_updates: [issue(1, { subject: 'Stale target', lock_version: 2 }), issue(2, { subject: 'Fresh sibling', lock_version: 2 })],
      deleted_issue_ids: [2], evicted_issue_ids: [3],
      tree_changes: [{ type: 'attach', parent_id: 1, child_id: 2 }],
      ancestor_updates: [
        { id: 3, done_ratio: 50, lock_version: 2, updated_on: null, aging_days: 0 },
        { id: 4, done_ratio: 10, lock_version: 4, updated_on: null, aging_days: 10 },
      ],
    };
    const next = applyIssueMutationResponse(data, response, { issueId: 1 }, { applyTarget: false, applyNonTarget: true });

    expect(next.issues.map((item) => item.id)).toEqual([1, 2, 3, 4]);
    expect(findIssueInBoard(next, 1)).toMatchObject({ subject: 'Issue 1', lock_version: 3 });
    expect(findIssueInBoard(next, 2)?.subject).toBe('Fresh sibling');
    expect(findIssueInBoard(next, 3)).toMatchObject({ done_ratio: 50, lock_version: 2 });
    expect(findIssueInBoard(next, 4)).toMatchObject({ done_ratio: 90, lock_version: 5 });

    const ancestorsOnly = applyIssueMutationResponse(data, response, { issueId: 1 }, { applyTarget: false });
    expect(findIssueInBoard(ancestorsOnly, 2)?.subject).toBe('Issue 2');
    expect(findIssueInBoard(ancestorsOnly, 3)?.done_ratio).toBe(50);
  });

  it('applies a fresh target together with ancestor progress', () => {
    const next = applyIssueMutationResponse(board([issue(1), issue(2)]), {
      issue: issue(1, { subject: 'Updated', lock_version: 2 }),
      ancestor_updates: [{ id: 2, done_ratio: 100, lock_version: 2, updated_on: null, aging_days: 0 }],
    }, { issueId: 1 });
    expect(findIssueInBoard(next, 1)?.subject).toBe('Updated');
    expect(findIssueInBoard(next, 2)?.done_ratio).toBe(100);
  });

  it('does not apply a mutation delta from a different scope', () => {
    const { result, current } = renderReconciler();
    act(() => result.current.reconcileMutationResult({
      scope_fingerprint: 'project:2', deleted_issue_ids: [1], created_issues: [issue(2)],
    }));
    expect(current().issues.map((item) => item.id)).toEqual([1]);
  });
});

describe('mutation follow-up reconciliation', () => {
  it('applies the response before requesting unresolved IDs, parents and counts in the current cache scope', async () => {
    const { result, queryClient, current } = renderReconciler(board([issue(1), issue(2), issue(4)]));
    const cached = current();
    queryClient.setQueryData(queryKey, {
      ...cached, meta: { ...cached.meta, project_ids: [1, 7], scope_status_ids: [1], dependency_status_ids: [1, 2, 3] },
    });
    const observedSubjects: string[] = [];
    getJsonMock.mockImplementation(async (url: string) => {
      observedSubjects.push(findIssueInBoard(current(), 1)!.subject);
      const parsed = new URL(url, 'http://localhost');
      if (parsed.pathname.endsWith('/counts')) return { ok: true, columns: [{ ...cached.columns[0]!, count: 12 }] };
      const ids = parsed.searchParams.getAll('ids[]').map(Number);
      return { ok: true, scope_fingerprint: 'project:1', entities: ids.map((id) => issue(id, { lock_version: 3 })) };
    });

    await act(async () => result.current.reconcileMutationResult({
      issue: issue(1, { subject: 'Applied', lock_version: 2 }),
      issue_updates: [issue(1, { subject: 'Applied', lock_version: 2 }), issue(2)],
      created_issues: [issue(3)],
      invalidations: { issue_ids: [1, 2, 3, 4, 4], parent_ids: [2, 2], column_counts: true },
    }));

    expect(getJsonMock).toHaveBeenCalledTimes(2);
    const urls = getJsonMock.mock.calls.map(([url]) => new URL(url, 'http://localhost'));
    expect(urls.map((url) => url.searchParams.getAll('ids[]'))).toEqual([['2', '4'], []]);
    expect(urls.map((url) => url.pathname)).toEqual([
      '/projects/demo/kanban/issues/entities', '/projects/demo/kanban/counts',
    ]);
    for (const url of urls) expect(url.searchParams.getAll('project_ids[]')).toEqual(['1', '7']);
    for (const url of urls.slice(0, 1)) {
      expect(url.searchParams.getAll('scope_status_ids[]')).toEqual(['1']);
      expect(url.searchParams.getAll('dependency_status_ids[]')).toEqual(['1', '2', '3']);
    }
    expect(observedSubjects).toEqual(['Applied', 'Applied']);
    expect(findIssueInBoard(current(), 2)?.lock_version).toBe(3);
    expect(findIssueInBoard(current(), 4)?.lock_version).toBe(3);
    expect(current().columns[0]?.count).toBe(12);
  });

  it('gives snapshot invalidation priority over both deltas and follow-up reads', () => {
    const { result, queryClient } = renderReconciler();
    const reset = vi.spyOn(queryClient, 'resetQueries');
    const response = {
      created_issues: [issue(2)],
      invalidations: { board_snapshot: true, issue_ids: [3], parent_ids: [1], column_counts: true },
    };
    act(() => result.current.reconcileMutationResult(response));
    expect(reset).toHaveBeenCalledExactlyOnceWith({ queryKey });
    expect(queryClient.getQueryData(queryKey)).toBeUndefined();
    expect(getJsonMock).not.toHaveBeenCalled();

    act(() => result.current.reconcileMutationResult(response, { responseHandled: true }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(getJsonMock).not.toHaveBeenCalled();
  });

  it('does not replay an already handled delta but still reconciles its invalidations', async () => {
    const { result, current } = renderReconciler(board([issue(1, { lock_version: 5 }), issue(2)]));
    getJsonMock.mockResolvedValue({ ok: true, entities: [issue(2, { subject: 'Reconciled', lock_version: 2 })] });
    await act(async () => result.current.reconcileMutationResult({
      deleted_issue_ids: [1], created_issues: [issue(3)], invalidations: { issue_ids: [2] },
    }, { responseHandled: true }));
    expect(current().issues.map((item) => item.id)).toEqual([1, 2]);
    expect(findIssueInBoard(current(), 2)?.subject).toBe('Reconciled');
  });

  it('returns completeness for verified creations and attaches children using the entity response', async () => {
    const { result, current } = renderReconciler();
    getJsonMock.mockResolvedValue({ ok: true, entities: [issue(2, { parent_id: 1, lock_version: 4 })] });
    await act(async () => {
      expect(await result.current.reconcileIssues([2, 2], { treatAsCreated: true })).toBe(true);
    });
    expect(current().issues.map((item) => item.id)).toEqual([1]);
    expect(findIssueInBoard(current(), 2)).toMatchObject({ parent_id: 1, lock_version: 4 });
    expect(new URL(getJsonMock.mock.calls[0]![0], 'http://localhost').searchParams.getAll('ids[]')).toEqual(['2']);
  });

  it('handles empty IDs and missing board data without starting requests', async () => {
    const { result } = renderReconciler(null);
    expect(await result.current.reconcileIssues([])).toBe(true);
    expect(await result.current.reconcileIssues([1])).toBe(false);
    expect(await result.current.reconcileIssueIds([1])).toEqual({ status: 'failed', reason: 'server' });
    result.current.reconcileMutationResult({ invalidations: { column_counts: true } });
    expect(getJsonMock).not.toHaveBeenCalled();
  });

  it.each(['error', 'not ok', 'incomplete'] as const)('reports a failed entity read (%s) as incomplete and releases its authority', async (failure) => {
    const { result, queryClient } = renderReconciler();
    const authority = getBoardFreshnessAuthority(queryClient, queryKey);
    if (failure === 'error') getJsonMock.mockRejectedValue(new Error('offline'));
    else getJsonMock.mockResolvedValue({ ok: failure !== 'not ok', entities: [] });
    await act(async () => { expect(await result.current.reconcileIssues([1])).toBe(false); });
    expect(authority.activeRequestCount).toBe(0);
    expect(getBoardFreshnessAuthority(queryClient, queryKey)).toBe(authority);
  });

  it('keeps a successful delta when the auxiliary counts request fails', async () => {
    const { result, queryClient, current } = renderReconciler();
    const reset = vi.spyOn(queryClient, 'resetQueries');
    const authority = getBoardFreshnessAuthority(queryClient, queryKey);
    getJsonMock.mockRejectedValue(new Error('offline'));
    await act(async () => result.current.reconcileMutationResult({
      issue: issue(1, { subject: 'Saved', lock_version: 2 }), invalidations: { column_counts: true },
    }));
    expect(findIssueInBoard(current(), 1)?.subject).toBe('Saved');
    expect(reset).not.toHaveBeenCalled();
    expect(authority.activeRequestCount).toBe(0);
    expect(getBoardFreshnessAuthority(queryClient, queryKey)).toBe(authority);
  });
});

describe('reconciliation freshness', () => {
  it('rejects stale positive values and evicts only unchanged missing entities', async () => {
    const { result, queryClient, current } = renderReconciler(board([issue(1), issue(2), issue(3)]));
    const response = deferred<{ ok: boolean; entities: Issue[]; missing_issue_ids: number[] }>();
    getJsonMock.mockReturnValue(response.promise);
    const pending = result.current.reconcileIssues([1, 2, 3]);
    queryClient.setQueryData(queryKey, {
      ...current(),
      issues: current().issues.map((item) => item.id === 3 ? item : {
        ...item, subject: item.id === 1 ? 'New positive' : 'New negative', lock_version: 5,
      }),
    });
    await act(async () => {
      response.resolve({ ok: true, entities: [issue(1, { lock_version: 2 })], missing_issue_ids: [2, 3] });
      expect(await pending).toBe(false);
    });
    expect(current().issues.map((item) => item.id)).toEqual([1, 2]);
    expect(findIssueInBoard(current(), 1)?.subject).toBe('New positive');
    expect(findIssueInBoard(current(), 2)?.subject).toBe('New negative');
  });

  it.each(['scope change', 'snapshot reset'] as const)('rejects pending entity and aggregate responses after a %s', async (change) => {
    const { result, queryClient, current } = renderReconciler();
    const entities = deferred<{ ok: boolean; entities: Issue[]; missing_issue_ids: number[] }>();
    const counts = deferred<{ ok: boolean; columns: BoardData['columns'] }>();
    getJsonMock.mockReturnValueOnce(entities.promise).mockReturnValueOnce(counts.promise);
    const authority = getBoardFreshnessAuthority(queryClient, queryKey);
    act(() => result.current.reconcileMutationResult({ invalidations: { issue_ids: [1], column_counts: true } }));
    expect(authority.activeRequestCount).toBe(3);
    const replacement = board([issue(1, { subject: 'Authoritative', lock_version: 2 })]);
    if (change === 'scope change') replacement.scope_fingerprint = 'project:2';
    else act(() => result.current.invalidateSnapshot());
    queryClient.setQueryData(queryKey, replacement);

    await act(async () => {
      entities.resolve({ ok: true, entities: [issue(2)], missing_issue_ids: [1] });
      counts.resolve({ ok: true, columns: [{ ...replacement.columns[0]!, count: 99 }] });
    });
    await waitFor(() => expect(authority.activeRequestCount).toBe(0));
    expect(current()).toEqual(replacement);
  });

  it('keeps the newest aggregate generation when count responses arrive in reverse order', async () => {
    const { result, queryClient, current } = renderReconciler();
    const first = deferred<{ ok: boolean; columns: BoardData['columns'] }>();
    const second = deferred<{ ok: boolean; columns: BoardData['columns'] }>();
    getJsonMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const authority = getBoardFreshnessAuthority(queryClient, queryKey);
    act(() => {
      result.current.reconcileMutationResult({ invalidations: { column_counts: true } });
      result.current.reconcileMutationResult({ invalidations: { column_counts: true } });
    });
    const column = current().columns[0]!;
    await act(async () => { second.resolve({ ok: true, columns: [{ ...column, count: 20 }] }); });
    expect(current().columns[0]?.count).toBe(20);
    expect(authority.activeRequestCount).toBe(1);
    await act(async () => { first.resolve({ ok: true, columns: [{ ...column, count: 10 }] }); });
    expect(current().columns[0]?.count).toBe(20);
    expect(authority.activeRequestCount).toBe(0);
    expect(getBoardFreshnessAuthority(queryClient, queryKey)).toBe(authority);
  });
});

describe('entity reconciliation races', () => {
  it('keeps non-overlapping IDs from an older partially replaced request', async () => {
    const { result, current } = renderReconciler(board([issue(1), issue(2)]));
    const older = deferred<{ ok: boolean; entities: Issue[]; missing_issue_ids: number[] }>();
    const newer = deferred<{ ok: boolean; entities: Issue[]; missing_issue_ids: number[] }>();
    const signals: AbortSignal[] = [];
    getJsonMock.mockImplementation((_url: string, options?: { signal?: AbortSignal }) => {
      if (options?.signal) signals.push(options.signal);
      return signals.length === 1 ? older.promise : newer.promise;
    });

    const oldRequest = result.current.reconcileIssues([1, 2]);
    const newRequest = result.current.reconcileIssues([1]);
    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(false);

    await act(async () => {
      newer.resolve({ ok: true, entities: [issue(1, { subject: 'Newest A', lock_version: 3 })], missing_issue_ids: [] });
      await newRequest;
      older.resolve({ ok: true, entities: [issue(1, { subject: 'Old A' }), issue(2, { subject: 'Fresh B', lock_version: 2 })], missing_issue_ids: [] });
      expect(await oldRequest).toBe(false);
    });

    expect(findIssueInBoard(current(), 1)?.subject).toBe('Newest A');
    expect(findIssueInBoard(current(), 2)?.subject).toBe('Fresh B');
  });

  it('aborts an older request when every requested ID has been replaced', async () => {
    const { result, current } = renderReconciler(board([issue(1)]));
    const signals: AbortSignal[] = [];
    getJsonMock.mockImplementation((_url: string, options?: { signal?: AbortSignal }) => {
      if (options?.signal) signals.push(options.signal);
      if (signals.length > 1) return Promise.resolve({ ok: true, entities: [issue(1, { subject: 'Newest', lock_version: 2 })], missing_issue_ids: [] });
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    });

    const oldRequest = result.current.reconcileIssues([1]);
    const newRequest = result.current.reconcileIssues([1]);
    expect(signals[0]?.aborted).toBe(true);
    await act(async () => {
      await Promise.all([oldRequest, newRequest]);
    });
    expect(findIssueInBoard(current(), 1)?.subject).toBe('Newest');
  });

  it('does not let old query-key requests hold slots after the hook switches keys', async () => {
    const nextQueryKey = ['kanban', 'reconciler-next'] as const;
    const initial = board([issue(1), issue(2), issue(3), issue(4)]);
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKey, initial);
    queryClient.setQueryData(nextQueryKey, initial);
    let activeKey: typeof queryKey | typeof nextQueryKey = queryKey;
    const oldSignals: AbortSignal[] = [];
    const hook = renderHook(() => useMutationReconciler({
      baseUrl: '/projects/demo/kanban', boardQueryKey: activeKey, data: initial,
    }), {
      wrapper: ({ children }: PropsWithChildren) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
    });
    getJsonMock.mockImplementation((_url: string, options?: { signal?: AbortSignal }) => {
      if (activeKey !== queryKey) return Promise.resolve({ ok: true, entities: [issue(4, { subject: 'New key' })], missing_issue_ids: [] });
      if (options?.signal) oldSignals.push(options.signal);
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    });

    const oldReads = [1, 2, 3].map((id) => hook.result.current.reconcileIssues([id]));
    expect(getJsonMock).toHaveBeenCalledTimes(2);
    activeKey = nextQueryKey;
    hook.rerender();
    expect(oldSignals.every((signal) => signal.aborted)).toBe(true);
    await act(async () => {
      expect(await hook.result.current.reconcileIssues([4])).toBe(true);
      await Promise.all(oldReads);
    });
    expect(getJsonMock).toHaveBeenCalledTimes(3);
  });

  it('treats a reported missing issue as a successful read without retrying', async () => {
    const { result, current } = renderReconciler();
    getJsonMock.mockResolvedValue({ ok: true, entities: [], missing_issue_ids: [1] });
    await act(async () => {
      expect(await result.current.reconcileIssueIds([1])).toEqual({ status: 'applied', missingIds: [1] });
    });
    expect(getJsonMock).toHaveBeenCalledTimes(1);
    expect(current().issues).toEqual([]);
  });

  it('falls back to a board reset after two failed latest reads', async () => {
    const onFailure = vi.fn();
    const { result, queryClient } = renderReconciler(board(), onFailure);
    const reset = vi.spyOn(queryClient, 'resetQueries');
    getJsonMock.mockRejectedValue(new Error('offline'));
    await act(async () => {
      expect(await result.current.reconcileIssueIds([1])).toEqual({ status: 'failed', reason: 'network' });
    });
    expect(getJsonMock).toHaveBeenCalledTimes(2);
    expect(reset).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledOnce();
  });

  it('retries a failed latest read and does not adopt an older response', async () => {
    const { result, current } = renderReconciler();
    const older = deferred<{ ok: boolean; entities: Issue[] }>();
    getJsonMock.mockReturnValueOnce(older.promise).mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, entities: [issue(1, { subject: 'Recovered', lock_version: 3 })] });
    const first = result.current.reconcileIssues([1]);
    const second = result.current.reconcileIssueIds([1]);
    await act(async () => {
      expect(await second).toEqual({ status: 'applied', missingIds: [] });
      older.resolve({ ok: true, entities: [issue(1, { subject: 'Old', lock_version: 2 })] });
      expect(await first).toBe(false);
    });
    expect(current().issues[0]?.subject).toBe('Recovered');
  });

  it('does not adopt an older success when the newer read and its retry fail', async () => {
    const { result, queryClient } = renderReconciler();
    const older = deferred<{ ok: boolean; entities: Issue[] }>();
    getJsonMock.mockReturnValueOnce(older.promise).mockRejectedValue(new Error('offline'));
    const first = result.current.reconcileIssues([1]);
    await act(async () => {
      expect(await result.current.reconcileIssueIds([1])).toEqual({ status: 'failed', reason: 'network' });
      older.resolve({ ok: true, entities: [issue(1, { subject: 'Old', lock_version: 2 })] });
      expect(await first).toBe(false);
    });
    expect(queryClient.getQueryData(queryKey)).toBeUndefined();
  });

  it('does not restore a deleted issue from a pending entity response', async () => {
    const { result, queryClient, current } = renderReconciler();
    const response = deferred<{ ok: boolean; entities: Issue[] }>();
    getJsonMock.mockReturnValue(response.promise);
    const pending = result.current.reconcileIssues([1]);
    queryClient.setQueryData(queryKey, { ...current(), issues: [] });

    await act(async () => {
      response.resolve({ ok: true, entities: [issue(1, { subject: 'Before deletion', lock_version: 2 })] });
      expect(await pending).toBe(false);
    });
    expect(current().issues).toEqual([]);
  });

  it('keeps the newer entity result when requests complete in reverse order', async () => {
    const { result, current } = renderReconciler();
    const older = deferred<{ ok: boolean; entities: Issue[] }>();
    const newer = deferred<{ ok: boolean; entities: Issue[] }>();
    getJsonMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const first = result.current.reconcileIssues([1]);
    const second = result.current.reconcileIssues([1]);

    await act(async () => {
      newer.resolve({ ok: true, entities: [issue(1, { subject: 'Newer', lock_version: 3 })] });
      expect(await second).toBe(true);
      older.resolve({ ok: true, entities: [issue(1, { subject: 'Older', lock_version: 2 })] });
      expect(await first).toBe(false);
    });
    expect(current().issues[0]?.subject).toBe('Newer');
  });

  it('applies a fresh entity read', async () => {
    const { result, current } = renderReconciler();
    getJsonMock.mockResolvedValue({ ok: true, entities: [issue(1, { subject: 'Updated', lock_version: 2 })] });
    await act(async () => { expect(await result.current.reconcileIssues([1])).toBe(true); });
    expect(current().issues[0]?.subject).toBe('Updated');
  });
});

describe('batched entity reconciliation', () => {
  it('caps reads shared by separate reconciliation calls', async () => {
    const { result } = renderReconciler(board([issue(1), issue(2), issue(3)]));
    const responses = [deferred<{ ok: boolean; entities: Issue[] }>(), deferred<{ ok: boolean; entities: Issue[] }>(), deferred<{ ok: boolean; entities: Issue[] }>()];
    getJsonMock.mockReturnValueOnce(responses[0]!.promise).mockReturnValueOnce(responses[1]!.promise).mockReturnValueOnce(responses[2]!.promise);
    const first = result.current.reconcileIssues([1]);
    const second = result.current.reconcileIssues([2]);
    const third = result.current.reconcileIssues([3]);
    expect(getJsonMock).toHaveBeenCalledTimes(2);
    await act(async () => { responses[0]!.resolve({ ok: true, entities: [issue(1)] }); expect(await first).toBe(true); });
    expect(getJsonMock).toHaveBeenCalledTimes(3);
    await act(async () => {
      responses[1]!.resolve({ ok: true, entities: [issue(2)] });
      responses[2]!.resolve({ ok: true, entities: [issue(3)] });
      expect(await second).toBe(true);
      expect(await third).toBe(true);
    });
  });

  it('continues handing entity slots to every queued reconciliation call', async () => {
    const { result } = renderReconciler(board([issue(1), issue(2), issue(3), issue(4), issue(5)]));
    const responses = Array.from({ length: 5 }, () => deferred<{ ok: boolean; entities: Issue[] }>());
    const started: number[] = [];
    getJsonMock.mockImplementation((url: string) => {
      const id = Number(new URL(url, 'http://localhost').searchParams.get('ids[]'));
      started.push(id);
      return responses[id - 1]!.promise;
    });

    const pending = [1, 2, 3, 4, 5].map((id) => result.current.reconcileIssues([id]));
    expect(started).toEqual([1, 2]);
    for (let id = 1; id <= 5; id += 1) {
      await act(async () => {
        responses[id - 1]!.resolve({ ok: true, entities: [issue(id)] });
        await waitFor(() => expect(started).toContain(id));
      });
    }
    await act(async () => { expect(await Promise.all(pending)).toEqual([true, true, true, true, true]); });
    expect(started).toEqual([1, 2, 3, 4, 5]);
  });

  it('finishes freshness requests for batches skipped after the board query is removed', async () => {
    const ids = Array.from({ length: 201 }, (_, index) => index + 1);
    const { result, queryClient } = renderReconciler(board(ids.map((id) => issue(id))));
    const authority = getBoardFreshnessAuthority(queryClient, queryKey);
    const first = deferred<{ ok: boolean; entities: Issue[] }>();
    const second = deferred<{ ok: boolean; entities: Issue[] }>();
    getJsonMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const pending = result.current.reconcileIssues(ids);
    expect(authority.activeRequestCount).toBe(4); // outer guard + 3 batch requests
    queryClient.removeQueries({ queryKey });
    await act(async () => { first.resolve({ ok: true, entities: ids.slice(0, 100).map((id) => issue(id)) }); });
    await act(async () => { second.resolve({ ok: true, entities: ids.slice(100, 200).map((id) => issue(id)) }); });
    await act(async () => { await pending; });

    expect(authority.activeRequestCount).toBe(0);
  });

  it('never exceeds two concurrent entity reads across four batches', async () => {
    const ids = Array.from({ length: 301 }, (_, index) => index + 1);
    const { result } = renderReconciler(board(ids.map((id) => issue(id))));
    const pendingResponses: Array<{ ids: number[]; resolve: (value: { ok: boolean; entities: Issue[] }) => void }> = [];
    getJsonMock.mockImplementation((url: string) => new Promise((resolve) => {
      pendingResponses.push({
        ids: new URL(url, 'http://localhost').searchParams.getAll('ids[]').map(Number),
        resolve,
      });
    }));
    const pending = result.current.reconcileIssues(ids);
    expect(pendingResponses).toHaveLength(2);
    await act(async () => { pendingResponses[0]!.resolve({ ok: true, entities: pendingResponses[0]!.ids.map((id) => issue(id)) }); });
    expect(pendingResponses).toHaveLength(3);
    await act(async () => { pendingResponses[1]!.resolve({ ok: true, entities: pendingResponses[1]!.ids.map((id) => issue(id)) }); });
    expect(pendingResponses).toHaveLength(4);
    await act(async () => {
      for (const response of pendingResponses.slice(2)) response.resolve({ ok: true, entities: response.ids.map((id) => issue(id)) });
      expect(await pending).toBe(true);
    });
  });

  it('starts at most two entity batches and stops queued batches after a scope change', async () => {
    const ids = Array.from({ length: 301 }, (_, index) => index + 1);
    const { result, queryClient, current } = renderReconciler(board(ids.map((id) => issue(id))));
    const first = deferred<{ ok: boolean; entities: Issue[] }>();
    const second = deferred<{ ok: boolean; entities: Issue[] }>();
    getJsonMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const pending = result.current.reconcileIssues(ids);
    expect(getJsonMock).toHaveBeenCalledTimes(2);
    const replacement = { ...current(), scope_fingerprint: 'project:2' };
    queryClient.setQueryData(queryKey, replacement);
    await act(async () => {
      first.resolve({ ok: true, entities: ids.slice(0, 100).map((id) => issue(id)) });
      second.resolve({ ok: true, entities: ids.slice(100, 200).map((id) => issue(id)) });
      expect(await pending).toBe(false);
    });
    expect(getJsonMock).toHaveBeenCalledTimes(2);
    expect(current()).toEqual(replacement);
  });

  it('deduplicates parent and issue invalidations into one read', async () => {
    const { result } = renderReconciler(board([issue(1), issue(2)]));
    getJsonMock.mockResolvedValue({ ok: true, entities: [issue(2)] });
    await act(async () => result.current.reconcileMutationResult({ invalidations: { issue_ids: [2, 2], parent_ids: [2, 2] } }));
    expect(getJsonMock).toHaveBeenCalledTimes(1);
    expect(new URL(getJsonMock.mock.calls[0]![0], 'http://localhost').searchParams.getAll('ids[]')).toEqual(['2']);
  });

  it('splits oversized requests and keeps successful batches when another fails', async () => {
    const ids = Array.from({ length: 101 }, (_, index) => index + 1);
    const { result, current } = renderReconciler(board(ids.map((id) => issue(id))));
    getJsonMock.mockImplementation((url: string) => {
      const batch = new URL(url, 'http://localhost').searchParams.getAll('ids[]').map(Number);
      if (batch.includes(1)) return Promise.reject(new Error('offline'));
      return Promise.resolve({ ok: true, entities: batch.map((id) => issue(id, { subject: 'Updated', lock_version: 2 })) });
    });
    await act(async () => { expect(await result.current.reconcileIssues(ids)).toBe(false); });
    expect(getJsonMock).toHaveBeenCalledTimes(2);
    expect(new URL(getJsonMock.mock.calls[0]![0], 'http://localhost').searchParams.getAll('ids[]')).toHaveLength(100);
    expect(new URL(getJsonMock.mock.calls[1]![0], 'http://localhost').searchParams.getAll('ids[]')).toEqual(['101']);
    expect(findIssueInBoard(current(), 101)?.subject).toBe('Updated');
  });

  it('rejects a stale batch after a newer issue update', async () => {
    const ids = Array.from({ length: 101 }, (_, index) => index + 1);
    const { result, queryClient, current } = renderReconciler(board(ids.map((id) => issue(id))));
    const delayed = deferred<{ ok: boolean; entities: Issue[] }>();
    getJsonMock.mockImplementation((url: string) => {
      const batch = new URL(url, 'http://localhost').searchParams.getAll('ids[]').map(Number);
      return batch.includes(101) ? delayed.promise : Promise.resolve({ ok: true, entities: batch.map((id) => issue(id)) });
    });
    const pending = result.current.reconcileIssues(ids);
    queryClient.setQueryData(queryKey, {
      ...current(),
      issues: current().issues.map((candidate) => candidate.id === 101 ? issue(101, { subject: 'Newer', lock_version: 3 }) : candidate),
    });
    await act(async () => {
      delayed.resolve({ ok: true, entities: [issue(101, { subject: 'Stale', lock_version: 2 })] });
      expect(await pending).toBe(false);
    });
    expect(findIssueInBoard(current(), 101)?.subject).toBe('Newer');
  });

  it('sends only still-fresh IDs when one ID changes while a request waits for a slot', async () => {
    const { result, queryClient, current } = renderReconciler(board([issue(1), issue(2), issue(3), issue(4), issue(5)]));
    const blockers = [deferred<{ ok: boolean; entities: Issue[] }>(), deferred<{ ok: boolean; entities: Issue[] }>()];
    let blockerIndex = 0;
    const queued = deferred<{ ok: boolean; entities: Issue[]; missing_issue_ids: number[] }>();
    const sent: number[][] = [];
    getJsonMock.mockImplementation((url: string) => {
      const ids = new URL(url, 'http://localhost').searchParams.getAll('ids[]').map(Number);
      sent.push(ids);
      if (ids[0] === 1 || ids[0] === 2) return blockers[blockerIndex++]!.promise;
      return queued.promise;
    });
    const first = result.current.reconcileIssues([1]);
    const second = result.current.reconcileIssues([2]);
    const waiting = result.current.reconcileIssues([3, 4]);
    expect(sent).toEqual([[1], [2]]);
    queryClient.setQueryData(queryKey, {
      ...current(), issues: current().issues.map((item) => item.id === 3 ? issue(3, { subject: 'Newest A', lock_version: 2 }) : item),
    });
    await act(async () => {
      blockers[0]!.resolve({ ok: true, entities: [issue(1)] });
      blockers[1]!.resolve({ ok: true, entities: [issue(2)] });
      await Promise.all([first, second]);
    });
    expect(sent).toEqual([[1], [2], [4]]);
    await act(async () => {
      queued.resolve({ ok: true, entities: [issue(4, { subject: 'Fresh B', lock_version: 2 })], missing_issue_ids: [] });
      expect(await waiting).toBe(false);
    });
    expect(findIssueInBoard(current(), 3)?.subject).toBe('Newest A');
    expect(findIssueInBoard(current(), 4)?.subject).toBe('Fresh B');
  });

  it('aborts old-scope reads and does not send queued reads after a scope switch', async () => {
    const initial = board([issue(1), issue(2), issue(3)]);
    const { result, queryClient, current } = renderReconciler(initial);
    const first = deferred<{ ok: boolean; entities: Issue[] }>();
    const signals: AbortSignal[] = [];
    const sent: number[][] = [];
    getJsonMock.mockImplementation((url: string, options?: { signal?: AbortSignal }) => {
      sent.push(new URL(url, 'http://localhost').searchParams.getAll('ids[]').map(Number));
      if (options?.signal) signals.push(options.signal);
      return new Promise((resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        first.promise.then(resolve, reject);
      });
    });
    const staleOne = result.current.reconcileIssues([1]);
    const staleTwo = result.current.reconcileIssues([2]);
    const queued = result.current.reconcileIssues([3]);
    expect(sent).toEqual([[1], [2]]);
    const replacement = { ...current(), scope_fingerprint: 'project:2', meta: { ...current().meta, scope_fingerprint: 'project:2' } };
    queryClient.setQueryData(queryKey, replacement);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    await act(async () => { await Promise.all([staleOne, staleTwo, queued]); });
    expect(sent).toEqual([[1], [2]]);
    const latestResponse = deferred<{ ok: boolean; entities: Issue[] }>();
    getJsonMock.mockReturnValueOnce(latestResponse.promise);
    const fresh = result.current.reconcileIssues([1]);
    expect(getJsonMock).toHaveBeenCalledTimes(3);
    await act(async () => {
      latestResponse.resolve({ ok: true, entities: [issue(1, { subject: 'New scope' })] });
      await fresh;
    });
    expect(getBoardFreshnessAuthority(queryClient, queryKey).activeRequestCount).toBe(0);
  });
});
