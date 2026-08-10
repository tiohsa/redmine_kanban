// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { useKanbanPreferences } from './useKanbanPreferences';

describe('useKanbanPreferences', () => {
  beforeEach(() => {
    localStorage.clear();
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
});
