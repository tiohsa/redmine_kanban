// @vitest-environment jsdom

import React, { type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardData, Issue } from './types';
import { findIssueInBoard, type IssueMutationResult } from './kanbanShared';
import { getBoardFreshnessAuthority } from './asyncFreshness';
import { applyIssueMutationResponse, useMutationReconciler } from './useMutationReconciler';

const getJsonMock = vi.hoisted(() => vi.fn());
vi.mock('./http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http')>()),
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

function renderReconciler(data: BoardData | null = board()) {
  const queryClient = new QueryClient();
  if (data) queryClient.setQueryData(queryKey, data);
  const hook = renderHook(() => useMutationReconciler({
    baseUrl: '/projects/demo/kanban', boardQueryKey: queryKey, data,
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

    expect(getJsonMock).toHaveBeenCalledTimes(3);
    const urls = getJsonMock.mock.calls.map(([url]) => new URL(url, 'http://localhost'));
    expect(urls.map((url) => url.searchParams.getAll('ids[]'))).toEqual([['4'], ['2'], []]);
    expect(urls.map((url) => url.pathname)).toEqual([
      '/projects/demo/kanban/issues/entities', '/projects/demo/kanban/issues/entities', '/projects/demo/kanban/counts',
    ]);
    for (const url of urls) expect(url.searchParams.getAll('project_ids[]')).toEqual(['1', '7']);
    for (const url of urls.slice(0, 2)) {
      expect(url.searchParams.getAll('scope_status_ids[]')).toEqual(['1']);
      expect(url.searchParams.getAll('dependency_status_ids[]')).toEqual(['1', '2', '3']);
    }
    expect(observedSubjects).toEqual(['Applied', 'Applied', 'Applied']);
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
    expect(await result.current.reconcileIssueIds([1])).toBeUndefined();
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
    expect(getBoardFreshnessAuthority(queryClient, queryKey)).not.toBe(authority);
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
    expect(getBoardFreshnessAuthority(queryClient, queryKey)).not.toBe(authority);
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
    expect(authority.activeRequestCount).toBe(2);
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
    expect(getBoardFreshnessAuthority(queryClient, queryKey)).not.toBe(authority);
  });
});
