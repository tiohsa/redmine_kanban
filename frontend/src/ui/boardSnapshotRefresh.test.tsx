// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getJson } from '../infrastructure/api/http';
import { makeBoardSnapshot } from '../test/fixtures/boardSnapshot';
import { invalidateBoardSnapshot } from '../application/board/useIssueMutation';
import { getBoardFreshnessAuthority } from '../application/board/asyncFreshness';
import { useBoardSnapshot } from './useBoardSnapshot';

vi.mock('../infrastructure/api/http', async (original) => ({
  ...await original<typeof import('../infrastructure/api/http')>(),
  getJson: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const metadata = {
  ok: true,
  board: { id: 4, name: 'Board', identifier: 'demo' },
  server_entity_limit: 5000,
  projects: [{ id: 4, name: 'Demo', level: 0 }],
  viewable_projects: [{ id: 4, name: 'Demo', level: 0 }],
  statuses: [{ id: 2, name: 'Open', is_closed: false }],
  filter_options: { assignees: [], trackers: [], priorities: [] },
};

function setup(client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })) {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(({ statusIds = [] }: { statusIds?: number[] }) => useBoardSnapshot({
    baseUrl: '/projects/demo/kanban',
    currentUserId: 7,
    projectIds: [],
    statusIds,
    hiddenStatusIds: [],
    preferencesReady: true,
    initialLabels: { load_failed: 'Load failed' },
  }), { initialProps: { statusIds: [] as number[] }, wrapper });
  return { ...hook, client };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('board snapshot refresh lifecycle', () => {
  it('keeps the same-scope presentation visible while a refresh is pending, then commits the new snapshot', async () => {
    const refreshed = deferred<ReturnType<typeof makeBoardSnapshot>>();
    let boardRequests = 0;
    vi.mocked(getJson).mockImplementation((url) => {
      if (url.endsWith('/metadata')) return Promise.resolve(metadata);
      boardRequests += 1;
      return boardRequests === 1 ? Promise.resolve(makeBoardSnapshot()) : refreshed.promise;
    });

    const { result, client } = setup();
    await waitFor(() => expect(result.current.data?.issues[0]?.subject).toBe('Issue'));
    let refreshPromise: Promise<void> | undefined;
    act(() => { refreshPromise = invalidateBoardSnapshot(client, result.current.boardQueryKey, { preserveDisplay: true }); });

    await waitFor(() => expect(result.current.refreshing).toBe(true));
    expect(result.current.data).toBeNull();
    expect(result.current.presentationData?.issues[0]?.subject).toBe('Issue');
    expect(result.current.refreshing).toBe(true);

    const nextSnapshot = makeBoardSnapshot();
    nextSnapshot.entities[0]!.subject = 'Updated issue';
    await act(async () => { refreshed.resolve(nextSnapshot); await refreshPromise; });
    await waitFor(() => expect(result.current.data?.issues[0]?.subject).toBe('Updated issue'));
    expect(result.current.presentationData?.issues[0]?.subject).toBe('Updated issue');
    expect(result.current.refreshing).toBe(false);
  });

  it('hides retained display after a failed refresh and restores it only after a successful retry', async () => {
    const failed = deferred<ReturnType<typeof makeBoardSnapshot>>();
    const retried = deferred<ReturnType<typeof makeBoardSnapshot>>();
    let boardRequests = 0;
    vi.mocked(getJson).mockImplementation((url) => {
      if (url.endsWith('/metadata')) return Promise.resolve(metadata);
      boardRequests += 1;
      if (boardRequests === 1) return Promise.resolve(makeBoardSnapshot());
      return boardRequests === 2 ? failed.promise : retried.promise;
    });

    const { result, client } = setup();
    await waitFor(() => expect(result.current.data?.issues[0]?.subject).toBe('Issue'));
    let failedRefresh: Promise<void> | undefined;
    act(() => { failedRefresh = invalidateBoardSnapshot(client, result.current.boardQueryKey, { preserveDisplay: true }); });
    await waitFor(() => expect(result.current.refreshing).toBe(true));
    await act(async () => { failed.reject(new Error('offline')); await failedRefresh; });

    await waitFor(() => expect(result.current.boardQuery.isError).toBe(true));
    expect(result.current.data).toBeNull();
    expect(result.current.presentationData).toBeNull();
    expect(result.current.refreshing).toBe(false);

    let retryRefresh: Promise<void> | undefined;
    act(() => { retryRefresh = result.current.refresh(); });
    // The failed state remains hidden during retries; it does not report a fresh refresh transition.
    expect(result.current.presentationData).toBeNull();
    const recovered = makeBoardSnapshot();
    recovered.entities[0]!.subject = 'Recovered issue';
    await act(async () => { retried.resolve(recovered); await retryRefresh; });

    await waitFor(() => expect(result.current.data?.issues[0]?.subject).toBe('Recovered issue'));
    expect(result.current.presentationData?.issues[0]?.subject).toBe('Recovered issue');
  });

  it('hides the prior scope presentation as soon as a debounced scope change is requested', async () => {
    const refreshed = deferred<ReturnType<typeof makeBoardSnapshot>>();
    let boardRequests = 0;
    vi.mocked(getJson).mockImplementation((url) => {
      if (url.endsWith('/metadata')) return Promise.resolve(metadata);
      boardRequests += 1;
      return boardRequests === 1 ? Promise.resolve(makeBoardSnapshot()) : refreshed.promise;
    });
    const { result, rerender, client } = setup();
    await waitFor(() => expect(result.current.data?.issues[0]?.subject).toBe('Issue'));

    act(() => { void invalidateBoardSnapshot(client, result.current.boardQueryKey, { preserveDisplay: true }); });
    await waitFor(() => expect(result.current.refreshing).toBe(true));
    expect(result.current.presentationData?.issues[0]?.subject).toBe('Issue');

    rerender({ statusIds: [2] });
    expect(result.current.data).toBeNull();
    expect(result.current.presentationData).toBeNull();
    expect(result.current.refreshing).toBe(true);
  });

  it('ignores a cancelled refresh response that arrives after a newer snapshot has committed', async () => {
    const lateOld = deferred<ReturnType<typeof makeBoardSnapshot>>();
    const newest = deferred<ReturnType<typeof makeBoardSnapshot>>();
    let boardRequests = 0;
    let oldSignal: AbortSignal | undefined;
    vi.mocked(getJson).mockImplementation((url, options) => {
      if (url.endsWith('/metadata')) return Promise.resolve(metadata);
      boardRequests += 1;
      if (boardRequests === 1) return Promise.resolve(makeBoardSnapshot());
      if (boardRequests === 2) {
        oldSignal = options?.signal;
        return lateOld.promise;
      }
      return newest.promise;
    });

    const { result, client } = setup();
    await waitFor(() => expect(result.current.data?.issues[0]?.subject).toBe('Issue'));
    let oldRefresh: Promise<void> | undefined;
    act(() => { oldRefresh = invalidateBoardSnapshot(client, result.current.boardQueryKey, { preserveDisplay: true }); });
    await waitFor(() => expect(boardRequests).toBe(2));

    let latestRefresh: Promise<void> | undefined;
    act(() => { latestRefresh = invalidateBoardSnapshot(client, result.current.boardQueryKey, { preserveDisplay: true }); });
    await waitFor(() => expect(boardRequests).toBe(3));
    expect(oldSignal?.aborted).toBe(true);

    const latest = makeBoardSnapshot();
    latest.entities[0]!.subject = 'Latest issue';
    await act(async () => { newest.resolve(latest); await latestRefresh; });
    await waitFor(() => expect(result.current.data?.issues[0]?.subject).toBe('Latest issue'));

    const stale = makeBoardSnapshot();
    stale.entities[0]!.subject = 'Stale issue';
    await act(async () => { lateOld.resolve(stale); await oldRefresh; });
    expect(result.current.data?.issues[0]?.subject).toBe('Latest issue');
    expect(result.current.presentationData?.issues[0]?.subject).toBe('Latest issue');
  });

  it('keeps a failed cached scope non-authoritative across unmount and removes its authority with the query', async () => {
    const firstFailure = deferred<ReturnType<typeof makeBoardSnapshot>>();
    const remountFailure = deferred<ReturnType<typeof makeBoardSnapshot>>();
    let boardRequests = 0;
    vi.mocked(getJson).mockImplementation((url) => {
      if (url.endsWith('/metadata')) return Promise.resolve(metadata);
      boardRequests += 1;
      if (boardRequests === 1) return Promise.resolve(makeBoardSnapshot());
      return boardRequests === 2 ? firstFailure.promise : remountFailure.promise;
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const mounted = setup(client);
    await waitFor(() => expect(mounted.result.current.data?.issues[0]?.subject).toBe('Issue'));
    const queryKey = mounted.result.current.boardQueryKey;
    const authority = getBoardFreshnessAuthority(client, queryKey);

    let failedRefresh: Promise<void> | undefined;
    act(() => { failedRefresh = invalidateBoardSnapshot(client, queryKey, { preserveDisplay: true }); });
    await waitFor(() => expect(boardRequests).toBe(2));
    await act(async () => { firstFailure.reject(new Error('offline')); await failedRefresh; });
    await waitFor(() => expect(mounted.result.current.boardQuery.isError).toBe(true));
    expect(mounted.result.current.presentationData).toBeNull();
    expect(authority.snapshotRefreshState).toBe('failed');
    mounted.unmount();

    expect(getBoardFreshnessAuthority(client, queryKey)).toBe(authority);
    const remounted = setup(client);
    await waitFor(() => expect(boardRequests).toBe(3));
    expect(remounted.result.current.data).toBeNull();
    expect(remounted.result.current.presentationData).toBeNull();
    expect(remounted.result.current.refreshing).toBe(false);
    await act(async () => { remountFailure.reject(new Error('still offline')); });
    await waitFor(() => expect(remounted.result.current.boardQuery.isError).toBe(true));
    expect(remounted.result.current.data).toBeNull();
    expect(remounted.result.current.presentationData).toBeNull();
    remounted.unmount();

    client.removeQueries({ queryKey, exact: true });
    expect(getBoardFreshnessAuthority(client, queryKey)).not.toBe(authority);
  });

  it('keeps the default invalidation behavior resetting cached board data', async () => {
    const client = new QueryClient();
    const queryKey = ['kanban', 'board', '/demo'] as const;
    const value = makeBoardSnapshot();
    client.setQueryData(queryKey, value);

    await invalidateBoardSnapshot(client, queryKey);

    expect(client.getQueryData(queryKey)).toBeUndefined();
  });
});
