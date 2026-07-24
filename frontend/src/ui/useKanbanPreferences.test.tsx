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

    expect(result.current.filters.assigneeIds).toEqual(['unassigned', '12']);
    expect(result.current.filters.q).toBe('abc');
  });

  it('drops legacy single-value assignee filters and resets to empty selection', () => {
    localStorage.setItem(
      'rk_filters:/projects/demo/kanban',
      JSON.stringify({ assignee: '12', q: 'legacy' }),
    );

    const { result } = renderHook(() => useKanbanPreferences('/projects/demo/kanban/data'));

    expect(result.current.filters.assigneeIds).toEqual([]);
    expect(result.current.filters.q).toBe('legacy');
  });

  it('persists assigneeIds in the new filter format', () => {
    const { result } = renderHook(() => useKanbanPreferences('/projects/demo/kanban/data'));

    act(() => {
      result.current.setFilters((previous) => ({ ...previous, assigneeIds: ['unassigned', '8'] }));
    });

    expect(JSON.parse(localStorage.getItem('rk_filters:/projects/demo/kanban') ?? '{}')).toMatchObject({
      assigneeIds: ['unassigned', '8'],
    });
  });

  it('reads and persists trackerIds in the filter payload', () => {
    localStorage.setItem(
      'rk_filters:/projects/demo/kanban',
      JSON.stringify({ trackerIds: [1, 2] }),
    );

    const { result } = renderHook(() => useKanbanPreferences('/projects/demo/kanban/data'));
    expect(result.current.filters.trackerIds).toEqual([1, 2]);

    act(() => {
      result.current.setFilters((previous) => ({ ...previous, trackerIds: [3] }));
    });

    expect(JSON.parse(localStorage.getItem('rk_filters:/projects/demo/kanban') ?? '{}')).toMatchObject({
      trackerIds: [3],
    });
  });
});
