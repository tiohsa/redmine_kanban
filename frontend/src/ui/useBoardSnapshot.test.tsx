// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getJson, HttpError } from './http';
import { useBoardSnapshot } from './useBoardSnapshot';
vi.mock('./http', async (original) => ({ ...await original<typeof import('./http')>(), getJson: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const metadata = { ok: true, board: { id: 1, name: 'Board', identifier: 'demo' }, server_entity_limit: 2, projects: [{ id: 1, name: 'Board', level: 0 }], viewable_projects: [], statuses: [{ id: 1, name: 'New', is_closed: false }] };
const snapshot = { ok: true, contract_version: 3, scope_fingerprint: 'narrow', meta: { complete: true }, entities: [], tree: { root_ids: [], children_by_parent_id: {} }, columns: [], lanes: [], lists: { projects: [], viewable_projects: [], assignees: [], trackers: [], priorities: [], creatable_projects: [] }, labels: {} };
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(({ statusIds }) => useBoardSnapshot({ baseUrl: '/projects/demo/kanban', currentUserId: 7, projectIds: [], statusIds, hiddenStatusIds: [], maximumBoardEntityCount: 1500, preferencesReady: true, initialLabels: { board_scope_too_large: 'Limit %{limit}', board_response_too_large: 'Bytes %{bytes}', load_failed: 'Failed' }, agingWarnDays: 3, agingDangerDays: 7, agingExcludeClosed: true }), { initialProps: { statusIds: [] as number[] }, wrapper });
}
describe('snapshot recovery without a successful cache', () => {
  it('offers independent choices after overflow, then clears only its load error on recovery', async () => {
    vi.mocked(getJson).mockImplementation(async (url) => {
      if (url.endsWith('/metadata')) return metadata;
      if (url.includes('issue_status_ids')) return snapshot;
      throw new HttpError(422, { error: { code: 'BOARD_SCOPE_TOO_LARGE', effective_entity_limit: 2 } });
    });
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.loadError).toBe('Limit 2'));
    expect(result.current.data).toBeNull();
    expect(result.current.toolbarData.columns).toEqual(metadata.statuses);
    expect(result.current.toolbarData.meta.complete).toBe(false);
    expect(result.current.toolbarData.meta.can_create).toBe(false);
    rerender({ statusIds: [1] });
    await waitFor(() => expect(result.current.data?.meta.complete).toBe(true));
    expect(result.current.loadError).toBeNull();
  });
  it('keeps response size errors distinct and exposes a retryable metadata failure', async () => {
    vi.mocked(getJson).mockImplementation(async (url) => {
      if (url.endsWith('/metadata')) throw new Error('offline');
      throw new HttpError(422, { error: { code: 'BOARD_RESPONSE_TOO_LARGE', maximum_response_bytes: 8 } });
    });
    const { result } = setup();
    await waitFor(() => expect(result.current.loadError).toBe('Bytes 8'));
    expect(result.current.metadataQuery.isError).toBe(true);
    vi.mocked(getJson).mockResolvedValue(metadata);
    await act(async () => { await result.current.metadataQuery.refetch(); });
    await waitFor(() => expect(result.current.metadataQuery.isError).toBe(false));
  });
  it('does not let a slow old failure overwrite a newer scope', async () => {
    let rejectOld: (error: Error) => void = () => {};
    vi.mocked(getJson).mockImplementation((url) => {
      if (url.endsWith('/metadata')) return Promise.resolve(metadata);
      if (url.includes('issue_status_ids')) return Promise.resolve(snapshot);
      return new Promise((_resolve, reject) => { rejectOld = reject; });
    });
    const { result, rerender } = setup();
    rerender({ statusIds: [1] });
    await waitFor(() => expect(result.current.data?.scope_fingerprint).toBe('narrow'));
    await act(async () => { rejectOld(new Error('old')); });
    expect(result.current.loadError).toBeNull();
    expect(result.current.data?.scope_fingerprint).toBe('narrow');
  });
  it('retains invalid selected IDs and never broadens them to an unfiltered request', async () => {
    vi.mocked(getJson).mockImplementation(async (url) => url.endsWith('/metadata') ? metadata : snapshot);
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.metadata).not.toBeNull());
    vi.mocked(getJson).mockClear();
    rerender({ statusIds: [999] });
    expect(result.current.data).toBeNull();
    expect(getJson).not.toHaveBeenCalled();
  });

  it('removes choices and mutations after permission loss', async () => {
    vi.mocked(getJson).mockImplementation(async (url) => url.endsWith('/metadata') ? metadata : snapshot);
    const { result } = setup();
    await waitFor(() => expect(result.current.data).not.toBeNull());
    vi.mocked(getJson).mockRejectedValue(new HttpError(403, null));
    await act(async () => { await result.current.metadataQuery.refetch(); });
    await waitFor(() => expect(result.current.data).toBeNull());
    expect(result.current.toolbarData.lists.projects).toEqual([]);
  });
});
