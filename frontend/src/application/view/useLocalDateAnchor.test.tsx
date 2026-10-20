// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLocalDateAnchor } from './useLocalDateAnchor';
import { useBoardSnapshot } from '../board/useBoardSnapshot';
import { boardFilterScopeFromFilters } from '../../model/board/filterScope';
import type { Filters } from '../../model/view/types';
import { getJson } from '../../infrastructure/api/http';
import { makeBoardSnapshot } from '../../test/fixtures/boardSnapshot';

vi.mock('../../infrastructure/api/http', async (original) => ({
  ...await original<typeof import('../../infrastructure/api/http')>(),
  getJson: vi.fn(),
}));

const snapshotMetadata = {
  ok: true,
  board: { id: 4, name: 'Demo', identifier: 'demo' },
  server_entity_limit: 10000,
  projects: [{ id: 4, name: 'Demo', level: 0 }],
  viewable_projects: [{ id: 4, name: 'Demo', level: 0 }],
  statuses: [{ id: 2, name: 'Open', is_closed: false }],
  filter_options_complete: true,
  filter_options: { assignees: [], trackers: [], priorities: [] },
};

const filters = {
  assigneeIds: [], q: '', due: 'overdue' as const, priority: [], priorityFilterEnabled: false,
  projectIds: [4], statusIds: [2], trackerIds: [],
};

function useDateScopedSnapshot(due: Filters['due']) {
  const { dateAnchor } = useLocalDateAnchor();
  const filterScope = boardFilterScopeFromFilters({ ...filters, due }, dateAnchor);
  return useBoardSnapshot({
    baseUrl: '/projects/demo/kanban', projectIds: [4], statusIds: [2], hiddenStatusIds: [],
    preferencesReady: true, initialLabels: {}, currentUserId: 7, filterScope,
  });
}

function AnchorValue() {
  return <output>{useLocalDateAnchor().dateAnchor}</output>;
}

describe('useLocalDateAnchor', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('advances at local midnight and clears its timer on unmount', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 3, 23, 59, 59));
    const view = render(<AnchorValue />);
    expect(screen.getByText('2026-10-03')).toBeTruthy();

    act(() => { vi.advanceTimersByTime(1_000); });
    expect(screen.getByText('2026-10-04')).toBeTruthy();
    expect(vi.getTimerCount()).toBe(1);

    const removeWindowListener = vi.spyOn(window, 'removeEventListener');
    const removeDocumentListener = vi.spyOn(document, 'removeEventListener');
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(removeWindowListener).toHaveBeenCalledWith('focus', expect.any(Function));
    expect(removeWindowListener).toHaveBeenCalledWith('pageshow', expect.any(Function));
    expect(removeDocumentListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it.each(['focus', 'visibilitychange', 'pageshow'] as const)('syncs after resume via %s', (event) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 3, 12));
    render(<AnchorValue />);
    expect(screen.getByText('2026-10-03')).toBeTruthy();

    vi.setSystemTime(new Date(2026, 9, 4, 12));
    act(() => {
      if (event === 'visibilitychange') document.dispatchEvent(new Event(event));
      else window.dispatchEvent(new Event(event));
    });
    expect(screen.getByText('2026-10-04')).toBeTruthy();
  });

  it('ignores visibilitychange while the document remains hidden', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 3, 12));
    const visibilityState = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      render(<AnchorValue />);
      vi.setSystemTime(new Date(2026, 9, 4, 12));
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      expect(screen.getByText('2026-10-03')).toBeTruthy();
    } finally {
      visibilityState.mockRestore();
    }
  });

  it.each([
    ['overdue', 2],
    ['all', 1],
    ['none', 1],
  ] as const)('updates the board GET count for due=%s at midnight', async (due, expectedGets) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 3, 23, 59, 59));
    vi.mocked(getJson).mockImplementation(async (url) => (
      url.includes('/metadata') ? snapshotMetadata : makeBoardSnapshot()
    ));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const rendered = renderHook(() => useDateScopedSnapshot(due), { wrapper });
    const boardGets = () => vi.mocked(getJson).mock.calls.filter(([url]) => url.includes('/data?'));

    await act(async () => {
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
    expect(boardGets()).toHaveLength(1);
    if (due === 'overdue') expect(boardGets()[0][0]).toContain('filter_date_anchor=2026-10-03');
    else expect(boardGets()[0][0]).not.toContain('filter_date_anchor=');

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });

    expect(boardGets()).toHaveLength(expectedGets);
    if (expectedGets === 2) expect(boardGets()[1][0]).toContain('filter_date_anchor=2026-10-04');
    else expect(boardGets()[0][0]).not.toContain('filter_date_anchor=');
    rendered.unmount();
    client.clear();
  });
});
