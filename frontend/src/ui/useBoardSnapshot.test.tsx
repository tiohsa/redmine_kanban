// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getJson, HttpError } from '../infrastructure/api/http';
import { parseBoardSnapshotV3 } from '../infrastructure/api/boardSnapshot';
import { parseBoardMetadata } from '../infrastructure/api/boardMetadata';
import { useBoardSnapshot } from './useBoardSnapshot';
import { buildToolbarOptions } from './toolbar/toolbarOptions';
import { makeBoardSnapshot } from '../test/fixtures/boardSnapshot';
import type { BoardFilterScope } from '../model/board/filterScope';
vi.mock('../infrastructure/api/http', async (original) => ({ ...await original<typeof import('../infrastructure/api/http')>(), getJson: vi.fn() }));
const initialDocumentLanguage = document.documentElement.lang;
afterEach(() => { document.documentElement.lang = initialDocumentLanguage; cleanup(); vi.clearAllMocks(); });
const metadata = { ok: true, board: { id: 1, name: 'Board', identifier: 'demo' }, server_entity_limit: 10000, projects: [{ id: 1, name: 'Board', level: 0 }], viewable_projects: [], statuses: [{ id: 1, name: 'New', is_closed: false }], filter_options_complete: true, filter_options: { assignees: [{ id: 8, name: 'User', available_project_ids: [1] }], trackers: [{ id: 3, name: 'Bug', available_project_ids: [1] }], priorities: [{ id: 2, name: 'High' }] } };
const snapshot = { ok: true, contract_version: 3, scope_fingerprint: 'narrow', meta: { complete: true, entity_count: 0, project_id: 1, current_user_id: 7, can_move: false, can_create: false, can_delete: false, lane_type: 'assignee' }, entities: [], tree: { root_ids: [], children_by_parent_id: {} }, columns: [], lanes: [], lists: { projects: [], viewable_projects: [], assignees: [], trackers: [], priorities: [], creatable_projects: [] }, labels: {} };
const emptyFilterScope: BoardFilterScope = { q: '', assignee_ids: [], include_unassigned: false, tracker_ids: [], priority_filter_enabled: false, priority_ids: [], include_no_priority: false, due: 'all' };
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(({ statusIds, filterScope = emptyFilterScope, projectIds = [] }) => useBoardSnapshot({ baseUrl: '/projects/demo/kanban', currentUserId: 7, projectIds, statusIds, hiddenStatusIds: [], preferencesReady: true, initialLabels: { board_scope_too_large: 'Limit %{limit}', board_response_too_large: 'Bytes %{bytes}', board_query_limit_exceeded: 'Issue query limit', board_total_query_limit_exceeded: 'Total query limit', load_failed: 'Failed' }, filterScope }), { initialProps: { statusIds: [] as number[], filterScope: emptyFilterScope, projectIds: [] as number[] }, wrapper });
}
describe('snapshot recovery without a successful cache', () => {
  it('requires explicit candidate completeness and rejects partial overflow catalogs', () => {
    expect(() => parseBoardMetadata({ ...metadata, filter_options_complete: undefined })).toThrow('Invalid board metadata');
    expect(() => parseBoardMetadata({ ...metadata, filter_options_complete: false, filter_options_error: { code: 'BOARD_FILTER_OPTIONS_TOO_LARGE', resource: 'assignees', limit: 10000 } })).toThrow('Invalid board metadata');
    expect(parseBoardMetadata({ ...metadata, filter_options: { assignees: [], trackers: [], priorities: [] }, filter_options_complete: false, filter_options_error: { code: 'BOARD_FILTER_OPTIONS_TOO_LARGE', resource: 'assignees', limit: 10000 } }).filter_options_complete).toBe(false);
  });
  it('keeps an empty, non-authoritative board visible while a changed scope loads', async () => {
    const first = makeBoardSnapshot();
    let resolveNext!: (value: typeof first) => void;
    const next = new Promise<typeof first>((resolve) => { resolveNext = resolve; });
    vi.mocked(getJson).mockImplementation(async (url) => {
      if (url.includes('/metadata')) return metadata;
      return url.includes('filter_q=next') ? next : first;
    });
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.data?.issues).toHaveLength(1));

    rerender({ statusIds: [], filterScope: { ...emptyFilterScope, q: 'next' }, projectIds: [] });
    expect(result.current.data).toBeNull();
    expect(result.current.refreshing).toBe(true);
    expect(result.current.presentationData?.issues).toEqual([]);
    expect(result.current.presentationData?.entities).toEqual([]);
    expect(result.current.presentationData?.tree?.root_ids).toEqual([]);
    expect(result.current.presentationData?.columns).toEqual([{ id: 2, name: 'Open', is_closed: false }]);
    expect(result.current.presentationData?.lanes).toEqual(first.lanes);
    expect(result.current.presentationData?.meta.complete).toBe(false);

    await waitFor(() => expect(vi.mocked(getJson).mock.calls.some(([url]) => url.includes('filter_q=next'))).toBe(true));
    expect(result.current.presentationData?.issues).toEqual([]);
    act(() => resolveNext(first));
    await waitFor(() => expect(result.current.data?.issues).toHaveLength(1));
    expect(result.current.refreshing).toBe(false);
  });

  it('keeps core metadata stable and avoids scoped requests for a complete broad catalog', async () => {
    vi.mocked(getJson).mockImplementation((url) => url.includes('/metadata') ? Promise.resolve(metadata) : Promise.resolve(snapshot));
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.metadata?.filter_options.assignees).toEqual(metadata.filter_options.assignees));
    rerender({ statusIds: [1], filterScope: emptyFilterScope, projectIds: [1] });
    await waitFor(() => expect(result.current.data?.meta.complete).toBe(true));
    expect(result.current.metadata?.projects).toEqual(metadata.projects);
    expect(result.current.filterOptionsState.state).toBe('complete');
    expect(vi.mocked(getJson).mock.calls.filter(([url]) => url.includes('/metadata'))).toHaveLength(1);
  });

  it('keeps the board available after scoped candidate failure and supports explicit candidate retry', async () => {
    const overflowMetadata = {
      ...metadata,
      filter_options: { assignees: [], trackers: [], priorities: [] },
      filter_options_complete: false,
      filter_options_error: { code: 'BOARD_FILTER_OPTIONS_TOO_LARGE' as const, resource: 'assignees', limit: 10000 },
    };
    let candidateCalls = 0;
    vi.mocked(getJson).mockImplementation(async (url) => {
      if (url.includes('/metadata')) {
        if (url.includes('project_ids%5B%5D=1')) {
          candidateCalls += 1;
          if (candidateCalls === 1) throw new Error('offline');
          return metadata;
        }
        return overflowMetadata;
      }
      return snapshot;
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useBoardSnapshot({ baseUrl: '/projects/demo/kanban', currentUserId: 7, projectIds: [1], statusIds: [1], hiddenStatusIds: [], preferencesReady: true, initialLabels: {}, filterScope: emptyFilterScope }), { wrapper });
    await waitFor(() => expect(result.current.filterOptionsState.state).toBe('failed'));
    await waitFor(() => expect(result.current.data?.meta.complete).toBe(true));
    expect(result.current.metadata?.statuses).toEqual(overflowMetadata.statuses);
    await act(async () => { await result.current.candidateQuery.refetch(); });
    await waitFor(() => expect(result.current.filterOptionsState.state).toBe('complete'));
    expect(result.current.metadata?.filter_options_complete).toBe(false);
  });
  it('debounces candidate recovery and aborts an obsolete settled project request', async () => {
    const incomplete = {
      ...metadata,
      projects: [...metadata.projects, { id: 2, name: 'Second', level: 0 }, { id: 3, name: 'Third', level: 0 }],
      viewable_projects: [...metadata.projects, { id: 2, name: 'Second', level: 0 }, { id: 3, name: 'Third', level: 0 }],
      filter_options: { assignees: [], trackers: [], priorities: [] },
      filter_options_complete: false,
      filter_options_error: { code: 'BOARD_FILTER_OPTIONS_TOO_LARGE' as const, resource: 'assignees', limit: 10000 },
    };
    const lateOptions = { ...metadata, filter_options: { ...metadata.filter_options, assignees: [{ id: 81, name: 'Late', available_project_ids: [1] }] } };
    const finalOptions = { ...metadata, filter_options: { ...metadata.filter_options, assignees: [{ id: 80, name: 'Final', available_project_ids: [2, 3] }] } };
    let resolveFirst!: (value: typeof lateOptions) => void;
    let firstSignal: AbortSignal | undefined;
    const firstCandidate = new Promise<typeof lateOptions>((resolve) => { resolveFirst = resolve; });
    vi.mocked(getJson).mockImplementation((url, options) => {
      if (!url.includes('/metadata')) return Promise.resolve(snapshot);
      if (!url.includes('project_ids%5B%5D=')) return Promise.resolve(incomplete);
      if (url.includes('project_ids%5B%5D=1')) {
        firstSignal = options?.signal as AbortSignal;
        return firstCandidate;
      }
      if (url.includes('project_ids%5B%5D=2&project_ids%5B%5D=3')) return Promise.resolve(finalOptions);
      throw new Error(`Unexpected candidate scope: ${url}`);
    });
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.metadata?.filter_options_complete).toBe(false));

    rerender({ statusIds: [], filterScope: emptyFilterScope, projectIds: [1] });
    await waitFor(() => expect(firstSignal).toBeDefined());
    rerender({ statusIds: [], filterScope: emptyFilterScope, projectIds: [2] });
    rerender({ statusIds: [], filterScope: emptyFilterScope, projectIds: [2, 3] });
    await waitFor(() => expect(result.current.filterOptionsState).toEqual({ state: 'complete', options: finalOptions.filter_options }));
    expect(firstSignal?.aborted).toBe(true);
    const candidateUrls = vi.mocked(getJson).mock.calls.map(([url]) => url).filter((url) => url.includes('/metadata?project_ids'));
    expect(candidateUrls).toHaveLength(2);
    expect(candidateUrls.some((url) => url.includes('project_ids%5B%5D=2') && !url.includes('project_ids%5B%5D=3'))).toBe(false);

    await act(async () => { resolveFirst(lateOptions); await firstCandidate; });
    expect(result.current.filterOptionsState).toEqual({ state: 'complete', options: finalOptions.filter_options });
  });

  it('does not let late metadata for an intermediate project scope replace the latest scope', async () => {
    const scopedMetadata = { ...metadata, projects: [
      ...metadata.projects,
      { id: 2, name: 'Second', level: 0 },
      { id: 3, name: 'Third', level: 0 },
    ] };
    let resolveSecond!: (value: typeof scopedMetadata) => void;
    const second = new Promise<typeof scopedMetadata>((resolve) => { resolveSecond = resolve; });
    vi.mocked(getJson).mockImplementation((url) => {
      if (!url.includes('/metadata')) return Promise.resolve(snapshot);
      if (url.includes('project_ids%5B%5D=2')) return second;
      return Promise.resolve(scopedMetadata);
    });
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.metadata?.projects).toEqual(scopedMetadata.projects));
    rerender({ statusIds: [1], filterScope: emptyFilterScope, projectIds: [2] });
    rerender({ statusIds: [1], filterScope: emptyFilterScope, projectIds: [3] });
    await waitFor(() => expect(result.current.metadataQuery.isPlaceholderData).toBe(false));
    expect(result.current.metadata?.projects).toEqual(scopedMetadata.projects);
    act(() => resolveSecond({ ...scopedMetadata, projects: [{ id: 2, name: 'Late second', level: 0 }] }));
    await act(async () => { await second; });
    expect(result.current.metadata?.projects).toEqual(scopedMetadata.projects);
  });

  it.each(['baseUrl', 'currentUserId', 'language'] as const)('does not carry metadata placeholders across a %s identity change', async (changedIdentity) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    type Identity = { baseUrl: string; currentUserId: number; language: string };
    const originalLanguage = document.documentElement.lang;
    let resolveChanged!: (value: typeof metadata) => void;
    const changedResult = new Promise<typeof metadata>((resolve) => { resolveChanged = resolve; });
    vi.mocked(getJson).mockImplementation((url) => url.includes('/metadata') ? Promise.resolve(metadata) : Promise.resolve(snapshot));
    const { result, rerender } = renderHook((identity: Identity) => {
      document.documentElement.lang = identity.language;
      return useBoardSnapshot({ ...identity, projectIds: [1], statusIds: [1], hiddenStatusIds: [], preferencesReady: true, initialLabels: {}, filterScope: emptyFilterScope });
    }, { initialProps: { baseUrl: '/projects/demo/kanban', currentUserId: 7, language: 'en' }, wrapper });
    await waitFor(() => expect(result.current.metadata?.filter_options.assignees).toEqual(metadata.filter_options.assignees));
    vi.mocked(getJson).mockImplementation((url) => url.includes('/metadata') ? changedResult : Promise.resolve(snapshot));
    const nextIdentity = {
      baseUrl: changedIdentity === 'baseUrl' ? '/projects/other/kanban' : '/projects/demo/kanban',
      currentUserId: changedIdentity === 'currentUserId' ? 8 : 7,
      language: changedIdentity === 'language' ? 'ja' : 'en',
    };
    rerender(nextIdentity);
    expect(result.current.metadata).toBeNull();
    expect(result.current.metadataQuery.isPlaceholderData).toBe(false);
    act(() => resolveChanged(metadata));
    await waitFor(() => expect(result.current.metadata?.filter_options.assignees).toEqual(metadata.filter_options.assignees));
    document.documentElement.lang = originalLanguage;
  });

  it('rejects a declared complete snapshot with an unrepresented Entity', () => {
    expect(() => parseBoardSnapshotV3({ ...snapshot, meta: { ...snapshot.meta, entity_count: 1 }, entities: makeBoardSnapshot().entities })).toThrow('Invalid board snapshot');
  });
  it('rejects a snapshot without the server Entity count', () => {
    expect(() => parseBoardSnapshotV3({ ...snapshot, meta: { ...snapshot.meta, entity_count: undefined } })).toThrow('Invalid board snapshot');
  });
  it('rejects a response without the complete v3 snapshot contract', async () => {
    vi.mocked(getJson).mockImplementation(async (url) => url.includes('/metadata') ? metadata : { ...snapshot, meta: { ...snapshot.meta, complete: false } });
    const { result } = setup();
    await waitFor(() => expect(result.current.boardQuery.isError).toBe(true));
    expect(result.current.data).toBeNull();
  });
  it('offers independent choices after overflow, then clears only its load error on recovery', async () => {
    vi.mocked(getJson).mockImplementation(async (url) => {
      if (url.includes('/metadata')) return metadata;
      if (url.includes('issue_status_ids')) return snapshot;
      throw new HttpError(422, { error: { code: 'BOARD_SCOPE_TOO_LARGE', effective_entity_limit: 2 } });
    });
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.loadError).toBe('Limit 2'));
    expect(result.current.data).toBeNull();
    expect(result.current.toolbarData.columns).toEqual(metadata.statuses);
    expect(result.current.toolbarData.meta.complete).toBe(false);
    expect(result.current.toolbarData.meta.can_create).toBe(false);
    expect(result.current.metadata?.filter_options.assignees).toEqual(metadata.filter_options.assignees);
    expect(result.current.filterOptionsState.state).toBe('complete');
    const options = buildToolbarOptions(result.current.toolbarData, { assigneeIds: [], q: '', due: 'all', priority: [], priorityFilterEnabled: false, projectIds: [], statusIds: [], trackerIds: [] }, false, result.current.metadata?.filter_options ?? null);
    expect(options.assigneeOptions).toContainEqual({ id: '8', name: 'User' });
    expect(options.trackerOptions).toContainEqual({ id: '3', name: 'Bug' });
    expect(options.priorityOptions).toContainEqual({ id: '2', name: 'High' });
    rerender({ statusIds: [1], filterScope: emptyFilterScope, projectIds: [] });
    await waitFor(() => expect(result.current.data?.meta.complete).toBe(true));
    expect(result.current.loadError).toBeNull();
  });
  it('keeps core recovery usable and reloads candidates only when project scope narrows', async () => {
    const incomplete = {
      ...metadata,
      filter_options: { assignees: [], trackers: [], priorities: [] },
      filter_options_complete: false,
      filter_options_error: { code: 'BOARD_FILTER_OPTIONS_TOO_LARGE' as const, resource: 'assignees', limit: 10000 },
    };
    vi.mocked(getJson).mockImplementation(async (url) => {
      if (url.includes('/metadata')) return url.includes('project_ids%5B%5D=1') ? metadata : incomplete;
      return snapshot;
    });
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.metadata?.filter_options_complete).toBe(false));
    expect(result.current.metadata?.statuses).toEqual(metadata.statuses);
    expect(result.current.metadataQuery.isError).toBe(false);

    vi.mocked(getJson).mockClear();
    rerender({ statusIds: [1], filterScope: { ...emptyFilterScope, q: 'needle', due: 'overdue', date_anchor: '2026-10-01' }, projectIds: [] });
    await waitFor(() => expect(result.current.data?.meta.complete).toBe(true));
    expect(vi.mocked(getJson).mock.calls.filter(([url]) => url.includes('/metadata'))).toHaveLength(0);

    rerender({ statusIds: [1], filterScope: { ...emptyFilterScope, q: 'needle', due: 'overdue', date_anchor: '2026-10-01' }, projectIds: [1] });
    await waitFor(() => expect(result.current.filterOptionsState.state).toBe('complete'));
    const metadataUrl = vi.mocked(getJson).mock.calls.find(([url]) => url.includes('/metadata'))?.[0];
    expect(metadataUrl).toContain('project_ids%5B%5D=1');
    expect(result.current.metadata?.filter_options.assignees).toEqual([]);
    expect(result.current.filterOptionsState).toEqual({ state: 'complete', options: metadata.filter_options });
  });
  it('uses a metadata assignee candidate to request a filtered snapshot after overflow', async () => {
    vi.mocked(getJson).mockImplementation(async (url) => {
      if (url.includes('/metadata')) return metadata;
      if (url.includes('filter_assignee_ids%5B%5D=8')) return snapshot;
      throw new HttpError(422, { error: { code: 'BOARD_SCOPE_TOO_LARGE', effective_entity_limit: 2 } });
    });
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.loadError).toBe('Limit 2'));
    expect(result.current.metadata?.filter_options.assignees[0]?.id).toBe(8);
    rerender({ statusIds: [], filterScope: { ...emptyFilterScope, assignee_ids: [8] }, projectIds: [] });
    await waitFor(() => expect(result.current.data?.meta.complete).toBe(true));
    const snapshotUrl = vi.mocked(getJson).mock.calls.find(([url]) => url.includes('/data?') && url.includes('filter_assignee_ids'))?.[0];
    expect(snapshotUrl).toContain('filter_assignee_ids%5B%5D=8');
    expect(vi.mocked(getJson).mock.calls.filter(([url]) => url.includes('/metadata'))).toHaveLength(1);
  });
  it('uses finite server limits and includes the server-limit suffix in overflow errors', async () => {
    const limitedMetadata = { ...metadata, server_entity_limit: 10000 };
    const overflowLabels = { board_scope_too_large: 'Limit %{limit}', board_server_limit_suffix: '(server %{limit})', board_response_too_large: 'Bytes %{bytes}', board_query_limit_exceeded: 'Issue query limit', board_total_query_limit_exceeded: 'Total query limit', load_failed: 'Failed' };
    vi.mocked(getJson).mockImplementation(async (url) => {
      if (url.includes('/metadata')) return limitedMetadata;
      if (url.includes('issue_status_ids')) return snapshot;
      throw new HttpError(422, { error: { code: 'BOARD_SCOPE_TOO_LARGE', requested_entity_limit: 20000, effective_entity_limit: 10000, server_entity_limit: 10000 } });
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useBoardSnapshot({ baseUrl: '/projects/demo/kanban', currentUserId: 7, projectIds: [], statusIds: [], hiddenStatusIds: [], preferencesReady: true, initialLabels: overflowLabels, filterScope: emptyFilterScope }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.metadata?.server_entity_limit).toBe(10000));
    expect(result.current.toolbarData.meta.server_entity_limit).toBe(10000);
    await waitFor(() => expect(result.current.loadError).toBe('Limit 10,000 (server 10,000)'));
  });
  it('loads a complete selected scope using finite server metadata', async () => {
    vi.mocked(getJson).mockImplementation(async (url) => url.includes('/metadata') ? metadata : snapshot);
    // Pick a project and status so the snapshot waits for valid metadata choices.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const selected = renderHook(() => useBoardSnapshot({ baseUrl: '/projects/demo/kanban', currentUserId: 7, projectIds: [1], statusIds: [1], hiddenStatusIds: [], preferencesReady: true, initialLabels: {}, filterScope: emptyFilterScope }), { wrapper });
    await waitFor(() => expect(selected.result.current.data?.meta.complete).toBe(true));
    expect(selected.result.current.metadata?.server_entity_limit).toBe(10000);
    selected.unmount();
  });
  it.each([undefined, 0, -1, 1.5, '5000', Number.MAX_SAFE_INTEGER + 1])('rejects invalid metadata server entity limit %s before loading a selected board', async (serverEntityLimit) => {
    const invalidMetadata = { ...metadata, server_entity_limit: serverEntityLimit };
    vi.mocked(getJson).mockImplementation(async (url) => url.includes('/metadata') ? invalidMetadata : snapshot);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useBoardSnapshot({ baseUrl: '/projects/demo/kanban', currentUserId: 7, projectIds: [1], statusIds: [1], hiddenStatusIds: [], preferencesReady: true, initialLabels: {}, filterScope: emptyFilterScope }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.metadataQuery.isError).toBe(true));
    expect(result.current.metadataQuery.error).toBeInstanceOf(Error);
    expect((result.current.metadataQuery.error as Error).message).toBe('Invalid board metadata');
    expect(vi.mocked(getJson).mock.calls.map(([url]) => url)).toHaveLength(1);
    expect(vi.mocked(getJson).mock.calls[0][0]).toMatch(/\/metadata(?:\?|$)/);
  });
  it.each([0, -1, 1.5])('rejects invalid filter candidate project IDs %s before loading a selected board', async (projectId) => {
    const invalidMetadata = { ...metadata, filter_options_complete: true, filter_options: { ...metadata.filter_options, assignees: [{ id: 8, name: 'User', available_project_ids: [projectId] }] } };
    vi.mocked(getJson).mockImplementation(async (url) => url.includes('/metadata') ? invalidMetadata : snapshot);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useBoardSnapshot({ baseUrl: '/projects/demo/kanban', currentUserId: 7, projectIds: [1], statusIds: [1], hiddenStatusIds: [], preferencesReady: true, initialLabels: {}, filterScope: emptyFilterScope }), { wrapper });
    await waitFor(() => expect(result.current.metadataQuery.isError).toBe(true));
    expect(result.current.metadataQuery.error).toBeInstanceOf(Error);
    expect((result.current.metadataQuery.error as Error).message).toBe('Invalid board metadata');
    expect(vi.mocked(getJson).mock.calls.map(([url]) => url)).toHaveLength(1);
  });
  it('keeps response size errors distinct and exposes a retryable metadata failure', async () => {
    vi.mocked(getJson).mockImplementation(async (url) => {
      if (url.includes('/metadata')) throw new Error('offline');
      throw new HttpError(422, { error: { code: 'BOARD_RESPONSE_TOO_LARGE', maximum_response_bytes: 8 } });
    });
    const { result } = setup();
    await waitFor(() => expect(result.current.loadError).toBe('Bytes 8'));
    expect(result.current.metadataQuery.isError).toBe(true);
    vi.mocked(getJson).mockResolvedValue(metadata);
    await act(async () => { await result.current.metadataQuery.refetch(); });
    await waitFor(() => expect(result.current.metadataQuery.isError).toBe(false));
  });
  it.each([
    ['BOARD_QUERY_LIMIT_EXCEEDED', 'Issue query limit'],
    ['BOARD_TOTAL_QUERY_LIMIT_EXCEEDED', 'Total query limit'],
  ])('shows a distinct message for %s', async (code, message) => {
    vi.mocked(getJson).mockImplementation(async (url) => {
      if (url.includes('/metadata')) return metadata;
      throw new HttpError(422, { error: { code } });
    });
    const { result } = setup();
    await waitFor(() => expect(result.current.loadError).toBe(message));
  });
  it('does not let a slow old failure overwrite a newer scope', async () => {
    let rejectOld: (error: Error) => void = () => {};
    vi.mocked(getJson).mockImplementation((url) => {
      if (url.includes('/metadata')) return Promise.resolve(metadata);
      if (url.includes('issue_status_ids')) return Promise.resolve(snapshot);
      return new Promise((_resolve, reject) => { rejectOld = reject; });
    });
    const { result, rerender } = setup();
    rerender({ statusIds: [1], filterScope: emptyFilterScope, projectIds: [] });
    await waitFor(() => expect(result.current.data?.scope_fingerprint).toBe('narrow'));
    await act(async () => { rejectOld(new Error('old')); });
    expect(result.current.loadError).toBeNull();
    expect(result.current.data?.scope_fingerprint).toBe('narrow');
  });
  it('retains invalid selected IDs and never broadens them to an unfiltered request', async () => {
    vi.mocked(getJson).mockImplementation(async (url) => url.includes('/metadata') ? metadata : snapshot);
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.metadata).not.toBeNull());
    vi.mocked(getJson).mockClear();
    rerender({ statusIds: [999], filterScope: emptyFilterScope, projectIds: [] });
    await waitFor(() => expect(result.current.data).toBeNull());
    expect(getJson).not.toHaveBeenCalled();
  });

  it('debounces the complete filter scope so a new project never pairs with a stale subject query', async () => {
    vi.mocked(getJson).mockImplementation(async (url) => url.includes('/metadata') ? metadata : snapshot);
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.data?.meta.complete).toBe(true));
    const previousQueryKey = result.current.boardQueryKey;
    vi.mocked(getJson).mockClear();
    const nextScope = { ...emptyFilterScope, q: 'needle', due: 'overdue' as const, date_anchor: '2026-10-01' };
    rerender({ statusIds: [], filterScope: nextScope, projectIds: [1] });
    expect(result.current.data).toBeNull();
    expect(result.current.presentationData?.issues).toEqual([]);
    expect(result.current.boardQueryKey).toEqual(previousQueryKey);
    expect(vi.mocked(getJson).mock.calls.filter(([url]) => url.includes('/data?'))).toHaveLength(0);
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 100)); });
    expect(vi.mocked(getJson).mock.calls.filter(([url]) => url.includes('/data?'))).toHaveLength(0);
    rerender({ statusIds: [], filterScope: { ...nextScope, q: 'Final query' }, projectIds: [1] });
    await waitFor(() => expect(vi.mocked(getJson).mock.calls.some(([url]) => url.includes('/data?') && url.includes('filter_q=final+query'))).toBe(true));
    const dataRequests = vi.mocked(getJson).mock.calls.filter(([url]) => url.includes('/data?'));
    expect(dataRequests).toHaveLength(1);
    const requestUrl = dataRequests[0][0];
    expect(vi.mocked(getJson).mock.calls.filter(([url]) => url.includes('/metadata'))).toHaveLength(0);
    expect(requestUrl).toContain('project_ids%5B%5D=1');
    expect(requestUrl).toContain('filter_q=final+query');
    expect(requestUrl).toContain('filter_date_anchor=2026-10-01');
  });

  it.each([401, 403, 404])('removes choices and mutations after metadata permission loss (%s)', async (status) => {
    vi.mocked(getJson).mockImplementation(async (url) => url.includes('/metadata') ? metadata : snapshot);
    const { result } = setup();
    await waitFor(() => expect(result.current.data).not.toBeNull());
    vi.mocked(getJson).mockRejectedValue(new HttpError(status, null));
    await act(async () => { await result.current.metadataQuery.refetch(); });
    await waitFor(() => expect(result.current.data).toBeNull());
    expect(result.current.metadata).toBeNull();
    expect(result.current.toolbarData.columns).toEqual([]);
    expect(result.current.toolbarData.lists.projects).toEqual([]);
  });
  it.each([401, 403, 404])('blocks board access and reports failed candidates after scoped permission failure (%s)', async (status) => {
    const incomplete = {
      ...metadata,
      filter_options: { assignees: [], trackers: [], priorities: [] },
      filter_options_complete: false,
      filter_options_error: { code: 'BOARD_FILTER_OPTIONS_TOO_LARGE' as const, resource: 'assignees', limit: 10000 },
    };
    vi.mocked(getJson).mockImplementation(async (url) => {
      if (!url.includes('/metadata')) return snapshot;
      if (url.includes('project_ids%5B%5D=')) throw new HttpError(status, null);
      return incomplete;
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useBoardSnapshot({ baseUrl: '/projects/demo/kanban', currentUserId: 7, projectIds: [1], statusIds: [1], hiddenStatusIds: [], preferencesReady: true, initialLabels: {}, filterScope: emptyFilterScope }), { wrapper });
    await waitFor(() => expect(result.current.candidateAccessDenied).toBe(true));
    expect(result.current.candidateQuery.error).toMatchObject({ status });
    expect(result.current.filterOptionsState).toEqual({ state: 'failed', error: result.current.candidateQuery.error });
    expect(result.current.metadata).toBeNull();
    expect(result.current.data).toBeNull();
    expect(result.current.toolbarData.columns).toEqual([]);
  });

  it('retains scoped permission denial through retry network failure until a valid response succeeds', async () => {
    const incomplete = {
      ...metadata,
      filter_options: { assignees: [], trackers: [], priorities: [] },
      filter_options_complete: false,
      filter_options_error: { code: 'BOARD_FILTER_OPTIONS_TOO_LARGE' as const, resource: 'assignees', limit: 10000 },
    };
    let candidateAttempts = 0;
    let rejectRetry!: (error: Error) => void;
    let retryStarted!: () => void;
    const retryPending = new Promise<typeof metadata>((_resolve, reject) => { rejectRetry = reject; });
    const started = new Promise<void>((resolve) => { retryStarted = resolve; });
    vi.mocked(getJson).mockImplementation(async (url) => {
      if (!url.includes('/metadata')) return snapshot;
      if (!url.includes('project_ids%5B%5D=')) return incomplete;
      candidateAttempts += 1;
      if (candidateAttempts === 1) throw new HttpError(403, null);
      if (candidateAttempts === 2) { retryStarted(); return retryPending; }
      return metadata;
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useBoardSnapshot({ baseUrl: '/projects/demo/kanban', currentUserId: 7, projectIds: [1], statusIds: [1], hiddenStatusIds: [], preferencesReady: true, initialLabels: {}, filterScope: emptyFilterScope }), { wrapper });
    await waitFor(() => expect(result.current.candidateAccessDenied).toBe(true));

    let retryResult!: Promise<unknown>;
    act(() => { retryResult = result.current.retryCandidateQuery(); });
    await started;
    await waitFor(() => expect(result.current.candidateQuery.isFetching).toBe(true));
    expect(result.current.candidateAccessDenied).toBe(true);
    expect(result.current.data).toBeNull();
    await act(async () => { rejectRetry(new Error('offline')); await retryResult; });
    await waitFor(() => expect(result.current.candidateQuery.isError).toBe(true));
    expect(result.current.candidateAccessDenied).toBe(true);
    expect(result.current.filterOptionsState.state).toBe('failed');
    expect(result.current.data).toBeNull();

    await act(async () => { await result.current.retryCandidateQuery(); });
    await waitFor(() => expect(result.current.candidateAccessDenied).toBe(false));
    await waitFor(() => expect(result.current.data?.meta.complete).toBe(true));
    expect(candidateAttempts).toBe(3);
  });

  it('does not let an obsolete scoped permission failure block the next settled project identity', async () => {
    const incomplete = {
      ...metadata,
      projects: [...metadata.projects, { id: 2, name: 'Second', level: 0 }],
      viewable_projects: [...metadata.viewable_projects, { id: 2, name: 'Second', level: 0 }],
      filter_options: { assignees: [], trackers: [], priorities: [] },
      filter_options_complete: false,
      filter_options_error: { code: 'BOARD_FILTER_OPTIONS_TOO_LARGE' as const, resource: 'assignees', limit: 10000 },
    };
    vi.mocked(getJson).mockImplementation(async (url) => {
      if (!url.includes('/metadata')) return snapshot;
      if (!url.includes('project_ids%5B%5D=')) return incomplete;
      if (url.includes('project_ids%5B%5D=1')) throw new HttpError(403, null);
      return metadata;
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result, rerender } = renderHook(({ projectIds }) => useBoardSnapshot({ baseUrl: '/projects/demo/kanban', currentUserId: 7, projectIds, statusIds: [1], hiddenStatusIds: [], preferencesReady: true, initialLabels: {}, filterScope: emptyFilterScope }), { initialProps: { projectIds: [1] as number[] }, wrapper });
    await waitFor(() => expect(result.current.candidateAccessDenied).toBe(true));

    rerender({ projectIds: [2] });
    await waitFor(() => expect(result.current.data?.meta.complete).toBe(true));
    expect(result.current.candidateAccessDenied).toBe(false);
    expect(result.current.candidateQuery.error).toBeNull();
  });

  it('refreshes only the settled new anchor when a day change overlaps subject input', async () => {
    vi.mocked(getJson).mockImplementation(async (url) => url.includes('/metadata') ? metadata : snapshot);
    const { result, rerender } = setup();
    const relativeScope = { ...emptyFilterScope, due: 'overdue' as const, date_anchor: '2026-10-01' };
    rerender({ statusIds: [], filterScope: relativeScope, projectIds: [] });
    await waitFor(() => expect(result.current.boardQueryKey[6]).toContain('2026-10-01'));
    await waitFor(() => expect(result.current.boardQuery.isSuccess).toBe(true));
    vi.mocked(getJson).mockClear();

    rerender({ statusIds: [], filterScope: { ...relativeScope, date_anchor: '2026-10-02' }, projectIds: [] });
    await act(async () => { await result.current.refresh(); });
    expect(getJson).not.toHaveBeenCalled();
    rerender({ statusIds: [], filterScope: { ...relativeScope, date_anchor: '2026-10-02', q: 'new query' }, projectIds: [] });
    await act(async () => { await result.current.refresh(); });
    expect(getJson).not.toHaveBeenCalled();

    await waitFor(() => expect(getJson).toHaveBeenCalledTimes(1));
    const url = vi.mocked(getJson).mock.calls[0][0];
    expect(url).toContain('filter_date_anchor=2026-10-02');
    expect(url).toContain('filter_q=new+query');
    expect(result.current.boardQueryKey[6]).toContain('2026-10-02');
  });
});
