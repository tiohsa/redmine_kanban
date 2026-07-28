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

  it('keeps preferences isolated when the Redmine user changes', () => {
    localStorage.setItem('rk_filters:/projects/demo/kanban:user:7', JSON.stringify({ q: 'user-a' }));
    localStorage.setItem('rk_filters:/projects/demo/kanban:user:8', JSON.stringify({ q: 'user-b' }));
    const { result } = renderHook(() => useKanbanPreferences('/projects/demo/kanban/data'));

    act(() => { result.current.setCurrentUserId(7); });
    expect(result.current.filters.q).toBe('user-a');

    act(() => { result.current.setCurrentUserId(8); });
    expect(result.current.filters.q).toBe('user-b');
  });
});
