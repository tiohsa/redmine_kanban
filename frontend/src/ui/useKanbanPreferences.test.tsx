// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { StrictMode, useEffect } from 'react';
import { describe, expect, it, beforeEach } from 'vitest';
import type { SavedViewSettings } from './savedViews';
import { MAXIMUM_BOARD_ENTITY_COUNT, parseMaximumBoardEntityCount, useKanbanPreferences } from './useKanbanPreferences';

describe('parseMaximumBoardEntityCount', () => {
  it('accepts the documented bounds and rejects values outside them', () => {
    expect(parseMaximumBoardEntityCount('1')).toBe(1);
    expect(parseMaximumBoardEntityCount(String(MAXIMUM_BOARD_ENTITY_COUNT))).toBe(MAXIMUM_BOARD_ENTITY_COUNT);
    expect(parseMaximumBoardEntityCount('0')).toBeNull();
    expect(parseMaximumBoardEntityCount(String(MAXIMUM_BOARD_ENTITY_COUNT + 1))).toBeNull();
  });
});

describe('useKanbanPreferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('applies all saved settings in one render and preserves excluded settings', () => {
    const observed: SavedViewSettings[] = [];
    const { result } = renderHook(() => {
      const preferences = useKanbanPreferences('/projects/demo/kanban/data', 7);
      useEffect(() => { if (preferences.preferencesReady) observed.push(preferences.viewSettings); }, [preferences.preferencesReady, preferences.viewSettings]);
      return preferences;
    });
    act(() => { result.current.setFontSize(18); result.current.setAgingWarnDays(0); result.current.setCardDisplayMode('single_line'); result.current.setMaximumBoardEntityCount(400); });
    observed.length = 0;
    const saved: SavedViewSettings = { filters: { assigneeIds: ['12'], q: 'saved', due: 'custom', dueDays: 5, priority: [], priorityFilterEnabled: true, projectIds: [4], statusIds: [2], trackerIds: [3] }, sortConfig: [{ field: 'due', direction: 'asc' }], laneType: 'category', hiddenStatusIds: [6], viewableProjectsEnabled: true };
    act(() => result.current.applyViewSettings(saved));
    expect(observed).toEqual([saved]);
    expect(result.current.fontSize).toBe(18);
    expect(result.current.agingWarnDays).toBe(0);
    expect(result.current.cardDisplayMode).toBe('single_line');
    expect(result.current.maximumBoardEntityCount).toBe(400);
    expect(JSON.parse(localStorage.getItem('rk_filters:/projects/demo/kanban:user:7') ?? '{}')).toEqual(saved.filters);
  });

  it('does not persist old filters into a newly mounted board scope during hydration', () => {
    localStorage.setItem('rk_filters:/projects/b/kanban:user:7', JSON.stringify({ projectIds: [9], q: 'B' }));
    const { result, rerender } = renderHook(({ url }) => useKanbanPreferences(url, 7), { initialProps: { url: '/projects/a/kanban/data' } });
    act(() => result.current.setFilters((f) => ({ ...f, projectIds: [1], q: 'A' })));
    rerender({ url: '/projects/b/kanban/data' });
    expect(result.current.filters.projectIds).toEqual([9]);
    expect(JSON.parse(localStorage.getItem('rk_filters:/projects/b/kanban:user:7') ?? '{}').q).toBe('B');
  });

  it('preserves zero warning days through persistence and remount', () => {
    const first = renderHook(() => useKanbanPreferences('/projects/demo/kanban/data', 7));
    act(() => { first.result.current.setAgingWarnDays(0); });
    first.unmount();
    const second = renderHook(() => useKanbanPreferences('/projects/demo/kanban/data', 7));
    expect(second.result.current.agingWarnDays).toBe(0);
  });

  it.each([null, '', ' ', 'bad', 'NaN', 'Infinity', '-1', '1.5'])('uses defaults for invalid aging days %j', (value) => {
    if (value !== null) {
      localStorage.setItem('rk_aging_warn_days:/projects/demo/kanban:user:7', value);
      localStorage.setItem('rk_aging_danger_days:/projects/demo/kanban:user:7', value);
    }
    const { result } = renderHook(() => useKanbanPreferences('/projects/demo/kanban/data', 7));
    expect(result.current.agingWarnDays).toBe(3);
    expect(result.current.agingDangerDays).toBe(7);
  });

  it('keeps nonzero aging days and clamps danger to warning on restore', () => {
    localStorage.setItem('rk_aging_warn_days:/projects/demo/kanban:user:7', '14');
    localStorage.setItem('rk_aging_danger_days:/projects/demo/kanban:user:7', '7');
    const { result } = renderHook(() => useKanbanPreferences('/projects/demo/kanban/data', 7));
    expect(result.current.agingWarnDays).toBe(14);
    expect(result.current.agingDangerDays).toBe(14);
  });

  it('defaults card display to standard without writing before the user is known', () => {
    const { result } = renderHook(() => useKanbanPreferences('/projects/demo/kanban/data'));

    expect(result.current.cardDisplayMode).toBe('standard');
    expect(result.current.preferencesReady).toBe(false);
    expect(localStorage.length).toBe(0);

    act(() => { result.current.setCurrentUserId(7); });
    expect(result.current.cardDisplayMode).toBe('standard');
    expect(localStorage.getItem('rk_card_display_mode:user:7')).toBe('standard');
  });

  it('persists card display across remounts and projects without changing other display preferences', () => {
    const first = renderHook(() => useKanbanPreferences('/projects/alpha/kanban/data', 7));
    act(() => {
      first.result.current.setFitMode('width');
      first.result.current.setFontSize(30);
      first.result.current.setCardDisplayMode('single_line');
    });
    expect(first.result.current.showSubtasks).toBe(true);
    expect(localStorage.getItem('rk_card_display_mode:user:7')).toBe('single_line');
    expect(localStorage.getItem('rk_card_display_mode:/projects/alpha/kanban:user:7')).toBeNull();
    first.unmount();

    const second = renderHook(() => useKanbanPreferences('/projects/beta/kanban/data', 7));
    expect(second.result.current.preferencesReady).toBe(true);
    expect(second.result.current.cardDisplayMode).toBe('single_line');
    expect(second.result.current.showSubtasks).toBe(true);
    expect(second.result.current.fitMode).toBe('width');
    expect(second.result.current.fontSize).toBe(30);

    act(() => { second.result.current.setShowSubtasks(false); });
    expect(second.result.current.cardDisplayMode).toBe('single_line');
    act(() => { second.result.current.setCardDisplayMode('standard'); });
    expect(second.result.current.showSubtasks).toBe(false);
    expect(localStorage.getItem('rk_card_display_mode:user:7')).toBe('standard');
  });

  it.each(['', 'compact', 'SINGLE_LINE', 'null', '1'])('repairs invalid card display value %j to standard', (value) => {
    localStorage.setItem('rk_card_display_mode:user:7', value);
    const { result } = renderHook(() => useKanbanPreferences('/projects/demo/kanban/data', 7));

    expect(result.current.cardDisplayMode).toBe('standard');
    expect(localStorage.getItem('rk_card_display_mode:user:7')).toBe('standard');
  });

  it('hydrates card display after user discovery and isolates it when the user changes', () => {
    localStorage.setItem('rk_card_display_mode:user:7', 'single_line');
    localStorage.setItem('rk_card_display_mode:user:8', 'standard');
    const { result } = renderHook(() => useKanbanPreferences('/projects/demo/kanban/data'));

    expect(localStorage.getItem('rk_card_display_mode:user:7')).toBe('single_line');
    act(() => { result.current.setCurrentUserId(7); });
    expect(result.current.cardDisplayMode).toBe('single_line');
    act(() => { result.current.setCurrentUserId(8); });
    expect(result.current.cardDisplayMode).toBe('standard');
    expect(localStorage.getItem('rk_card_display_mode:user:7')).toBe('single_line');
    expect(localStorage.getItem('rk_card_display_mode:user:8')).toBe('standard');
    act(() => { result.current.setCurrentUserId(7); });
    expect(result.current.cardDisplayMode).toBe('single_line');
    act(() => { result.current.setCurrentUserId(9); });
    expect(result.current.cardDisplayMode).toBe('standard');
  });

  it('preserves the saved card display mode during StrictMode hydration', () => {
    localStorage.setItem('rk_card_display_mode:user:7', 'single_line');
    const { result } = renderHook(() => useKanbanPreferences('/projects/demo/kanban/data', 7), { wrapper: StrictMode });

    expect(result.current.preferencesReady).toBe(true);
    expect(result.current.cardDisplayMode).toBe('single_line');
    expect(localStorage.getItem('rk_card_display_mode:user:7')).toBe('single_line');
  });

  it('keeps the user-scoped card display mode when the mounted board changes projects', () => {
    const { result, rerender } = renderHook(({ dataUrl }) => useKanbanPreferences(dataUrl, 7), {
      initialProps: { dataUrl: '/projects/alpha/kanban/data' },
    });
    act(() => { result.current.setCardDisplayMode('single_line'); });

    rerender({ dataUrl: '/projects/beta/kanban/data' });

    expect(result.current.cardDisplayMode).toBe('single_line');
    expect(localStorage.getItem('rk_card_display_mode:user:7')).toBe('single_line');
    expect(localStorage.getItem('rk_card_display_mode:/projects/beta/kanban:user:7')).toBeNull();
  });

  it('reads assigneeIds from the saved filters payload', () => {
    localStorage.setItem(
      'rk_filters:/projects/demo/kanban',
      JSON.stringify({ assigneeIds: ['unassigned', '12'], q: 'abc' }),
    );

    const { result } = renderHook(() => useKanbanPreferences('/projects/demo/kanban/data'));
    act(() => { result.current.setCurrentUserId(7); });

    expect(result.current.filters.assigneeIds).toEqual(['unassigned', '12']);
    expect(result.current.filters.q).toBe('abc');
  });

  it('drops legacy single-value assignee filters and resets to empty selection', () => {
    localStorage.setItem(
      'rk_filters:/projects/demo/kanban',
      JSON.stringify({ assignee: '12', q: 'legacy' }),
    );

    const { result } = renderHook(() => useKanbanPreferences('/projects/demo/kanban/data'));
    act(() => { result.current.setCurrentUserId(7); });

    expect(result.current.filters.assigneeIds).toEqual([]);
    expect(result.current.filters.q).toBe('legacy');
  });

  it('persists assigneeIds in the new filter format', () => {
    const { result } = renderHook(() => useKanbanPreferences('/projects/demo/kanban/data'));
    act(() => { result.current.setCurrentUserId(7); });

    act(() => {
      result.current.setFilters((previous) => ({ ...previous, assigneeIds: ['unassigned', '8'] }));
    });

    expect(JSON.parse(localStorage.getItem('rk_filters:/projects/demo/kanban:user:7') ?? '{}')).toMatchObject({
      assigneeIds: ['unassigned', '8'],
    });
  });

  it('reads and persists trackerIds in the filter payload', () => {
    localStorage.setItem(
      'rk_filters:/projects/demo/kanban',
      JSON.stringify({ trackerIds: [1, 2] }),
    );

    const { result } = renderHook(() => useKanbanPreferences('/projects/demo/kanban/data'));
    act(() => { result.current.setCurrentUserId(7); });
    expect(result.current.filters.trackerIds).toEqual([1, 2]);

    act(() => {
      result.current.setFilters((previous) => ({ ...previous, trackerIds: [3] }));
    });

    expect(JSON.parse(localStorage.getItem('rk_filters:/projects/demo/kanban:user:7') ?? '{}')).toMatchObject({
      trackerIds: [3],
    });
  });

  it('persists lane and aging display preferences in the project scope', () => {
    const { result } = renderHook(() => useKanbanPreferences('/projects/demo/kanban/data'));
    act(() => { result.current.setCurrentUserId(7); });

    act(() => {
      result.current.setLaneType('priority');
      result.current.setAgingWarnDays(5);
      result.current.setAgingDangerDays(14);
      result.current.setAgingExcludeClosed(false);
    });

    expect(localStorage.getItem('rk_lane_type:/projects/demo/kanban:user:7')).toBe('priority');
    expect(localStorage.getItem('rk_aging_warn_days:/projects/demo/kanban:user:7')).toBe('5');
    expect(localStorage.getItem('rk_aging_danger_days:/projects/demo/kanban:user:7')).toBe('14');
    expect(localStorage.getItem('rk_aging_exclude_closed:/projects/demo/kanban:user:7')).toBe('0');
  });

  it.each(['none', 'assignee', 'priority'] as const)(
    'migrates legacy project-scoped lane type %s to the first user',
    (laneType) => {
      localStorage.setItem('rk_lane_type:/projects/demo/kanban', laneType);

      const { result } = renderHook(() => useKanbanPreferences('/projects/demo/kanban/data'));
      act(() => { result.current.setCurrentUserId(7); });

      expect(result.current.laneType).toBe(laneType);
      expect(localStorage.getItem('rk_lane_type:/projects/demo/kanban:user:7')).toBe(laneType);
      expect(localStorage.getItem('rk_lane_type:/projects/demo/kanban')).toBeNull();
    },
  );

  it('prefers a user-scoped lane type over both legacy formats', () => {
    localStorage.setItem('rk_lane_type:/projects/demo/kanban:user:7', 'none');
    localStorage.setItem('rk_lane_type:/projects/demo/kanban', 'assignee');
    localStorage.setItem('rk_priority_lane_enabled:/projects/demo/kanban', '1');

    const { result } = renderHook(() => useKanbanPreferences('/projects/demo/kanban/data'));
    act(() => { result.current.setCurrentUserId(7); });

    expect(result.current.laneType).toBe('none');
    expect(localStorage.getItem('rk_lane_type:/projects/demo/kanban')).toBe('assignee');
  });

  it('uses the priority-lane legacy setting only when no lane type exists', () => {
    localStorage.setItem('rk_priority_lane_enabled:/projects/demo/kanban', '1');

    const { result } = renderHook(() => useKanbanPreferences('/projects/demo/kanban/data'));
    act(() => { result.current.setCurrentUserId(7); });

    expect(result.current.laneType).toBe('priority');
  });

  it('does not copy a consumed legacy lane type to the next Redmine user', () => {
    localStorage.setItem('rk_lane_type:/projects/demo/kanban', 'priority');
    const { result } = renderHook(() => useKanbanPreferences('/projects/demo/kanban/data'));

    act(() => { result.current.setCurrentUserId(7); });
    expect(result.current.laneType).toBe('priority');

    act(() => { result.current.setCurrentUserId(8); });
    expect(result.current.laneType).toBe('assignee');
    expect(localStorage.getItem('rk_lane_type:/projects/demo/kanban:user:8')).toBe('assignee');
  });

  it('keeps preferences isolated when the Redmine user changes', () => {
    localStorage.setItem('rk_filters:/projects/demo/kanban:user:7', JSON.stringify({ q: 'user-a' }));
    localStorage.setItem('rk_filters:/projects/demo/kanban:user:8', JSON.stringify({ q: 'user-b' }));
    const { result } = renderHook(() => useKanbanPreferences('/projects/demo/kanban/data'));

    act(() => { result.current.setCurrentUserId(7); });
    expect(result.current.filters.q).toBe('user-a');

    act(() => { result.current.setCurrentUserId(8); });
    expect(result.current.filters.q).toBe('user-b');
  });

  it('keeps lane preferences isolated between projects for the same user', () => {
    localStorage.setItem('rk_lane_type:/projects/alpha/kanban:user:7', 'priority');
    localStorage.setItem('rk_lane_type:/projects/beta/kanban:user:7', 'none');

    const alpha = renderHook(() => useKanbanPreferences('/projects/alpha/kanban/data'));
    const beta = renderHook(() => useKanbanPreferences('/projects/beta/kanban/data'));

    act(() => {
      alpha.result.current.setCurrentUserId(7);
      beta.result.current.setCurrentUserId(7);
    });

    expect(alpha.result.current.laneType).toBe('priority');
    expect(beta.result.current.laneType).toBe('none');
  });

  it('defaults, persists, and isolates the maximum board entity count', () => {
    const alpha = renderHook(() => useKanbanPreferences('/projects/alpha/kanban/data'));
    expect(alpha.result.current.maximumBoardEntityCount).toBe(1500);

    act(() => { alpha.result.current.setCurrentUserId(7); });
    act(() => { alpha.result.current.setMaximumBoardEntityCount(1); });
    expect(localStorage.getItem('rk_maximum_board_entity_count:/projects/alpha/kanban:user:7')).toBe('1');
    act(() => { alpha.result.current.setMaximumBoardEntityCount(5000); });
    expect(localStorage.getItem('rk_maximum_board_entity_count:/projects/alpha/kanban:user:7')).toBe('5000');

    act(() => { alpha.result.current.setCurrentUserId(8); });
    expect(alpha.result.current.maximumBoardEntityCount).toBe(1500);
  });

  it('repairs corrupt maximum count values without creating an unbounded setting', () => {
    localStorage.setItem('rk_maximum_board_entity_count:/projects/demo/kanban:user:7', '1e5');
    const { result } = renderHook(() => useKanbanPreferences('/projects/demo/kanban/data'));
    act(() => { result.current.setCurrentUserId(7); });
    expect(result.current.maximumBoardEntityCount).toBe(1500);
    expect(localStorage.getItem('rk_maximum_board_entity_count:/projects/demo/kanban:user:7')).toBe('1500');
  });

  it('hydrates the saved user preference before reporting readiness', () => {
    localStorage.setItem('rk_maximum_board_entity_count:/projects/demo/kanban:user:7', '3000');
    localStorage.setItem('rk_filters:/projects/demo/kanban:user:7', JSON.stringify({ statusIds: [2], projectIds: [4] }));

    const { result } = renderHook(() => useKanbanPreferences('/projects/demo/kanban/data', 7));

    expect(result.current.preferencesReady).toBe(true);
    expect(result.current.maximumBoardEntityCount).toBe(3000);
    expect(result.current.filters.statusIds).toEqual([2]);
    expect(result.current.filters.projectIds).toEqual([4]);
    expect(localStorage.getItem('rk_maximum_board_entity_count:/projects/demo/kanban:user:7')).toBe('3000');
  });

  it.each([
    ['due_asc', [{ field: 'due', direction: 'asc' }]],
    ['due_desc', [{ field: 'due', direction: 'desc' }]],
    ['priority_asc', [{ field: 'priority', direction: 'asc' }]],
    ['priority_desc', [{ field: 'priority', direction: 'desc' }]],
    ['updated_asc', [{ field: 'updated', direction: 'asc' }]],
    ['updated_desc', [{ field: 'updated', direction: 'desc' }]],
  ] as const)('migrates legacy sort preference %s', (legacyValue, expected) => {
    localStorage.setItem('rk_sortkey:user:7', legacyValue);

    const { result } = renderHook(() => useKanbanPreferences('/projects/demo/kanban/data', 7));

    expect(result.current.sortConfig).toEqual(expected);
    expect(JSON.parse(localStorage.getItem('rk_sortkey:user:7') ?? 'null')).toEqual(expected);
  });

  it('loads and persists the new sort configuration format', () => {
    const saved = [
      { field: 'due', direction: 'asc' },
      { field: 'priority', direction: 'desc' },
    ] as const;
    localStorage.setItem('rk_sortkey:user:7', JSON.stringify(saved));

    const { result } = renderHook(() => useKanbanPreferences('/projects/demo/kanban/data', 7));
    expect(result.current.sortConfig).toEqual(saved);

    act(() => {
      result.current.setSortConfig([
        { field: 'priority', direction: 'asc' },
        { field: 'updated', direction: 'desc' },
      ]);
    });

    expect(JSON.parse(localStorage.getItem('rk_sortkey:user:7') ?? 'null')).toEqual([
      { field: 'priority', direction: 'asc' },
      { field: 'updated', direction: 'desc' },
    ]);
  });

  it('falls back to the default for corrupt sort preferences', () => {
    localStorage.setItem('rk_sortkey:user:7', JSON.stringify([
      { field: 'due', direction: 'asc' },
      { field: 'due', direction: 'desc' },
    ]));

    const { result } = renderHook(() => useKanbanPreferences('/projects/demo/kanban/data', 7));

    expect(result.current.sortConfig).toEqual([{ field: 'updated', direction: 'desc' }]);
    expect(JSON.parse(localStorage.getItem('rk_sortkey:user:7') ?? 'null')).toEqual([
      { field: 'updated', direction: 'desc' },
    ]);
  });
});
