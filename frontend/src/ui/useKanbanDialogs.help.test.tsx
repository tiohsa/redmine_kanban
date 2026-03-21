/**
 * @jest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useKanbanDialogs } from './useKanbanDialogs';
import type { BoardData } from './types';

describe('useKanbanDialogs help dialog', () => {
  const mockData: BoardData = {
    ok: true,
    meta: {
      project_id: 1,
      current_user_id: 1,
      can_move: true,
      can_create: true,
      can_delete: true,
      lane_type: 'assignee',
      wip_limit_mode: 'column',
      wip_exceed_behavior: 'warn',
      aging_warn_days: 7,
      aging_danger_days: 14,
      aging_exclude_closed: true,
    },
    columns: [],
    lanes: [],
    lists: {
      trackers: [],
      priorities: [],
      projects: [],
      viewable_projects: [],
      creatable_projects: [],
      assignees: [],
    },
    issues: [],
    labels: {},
  };

  it('should manage help dialog visibility', () => {
    const { result } = renderHook(() => useKanbanDialogs('/projects/test', mockData, 'assignee'));

    expect(result.current.helpOpen).toBe(false);

    act(() => {
      result.current.setHelpOpen(true);
    });
    expect(result.current.helpOpen).toBe(true);

    act(() => {
      result.current.setHelpOpen(false);
    });
    expect(result.current.helpOpen).toBe(false);
  });
});
