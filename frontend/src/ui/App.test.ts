// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App, normalizeAssigneeIds, normalizeProjectIds, normalizeTrackerIds, resolveDefaultCreateProjectId } from './App';
import { getJson } from './http';

vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
});

vi.mock('./http', () => ({
  getJson: vi.fn(() => Promise.resolve({
    ok: true, contract_version: 3, scope_fingerprint: 'sha256:test',
    meta: { project_id: 1, project_ids: [4], scope_status_ids: [2], scope_fingerprint: 'sha256:test', current_user_id: 7, can_move: false, can_create: false, can_delete: false, lane_type: 'none', aging_warn_days: 7, aging_danger_days: 14, aging_exclude_closed: false, complete: true, entity_count: 0 },
    columns: [], lanes: [], lists: { assignees: [], trackers: [], priorities: [], projects: [], viewable_projects: [], creatable_projects: [] }, issues: [], entities: [], tree: { root_ids: [], children_by_parent_id: {} }, labels: {},
  })),
  isHttpError: vi.fn(() => false),
  postJson: vi.fn(),
}));

vi.mock('./useKanbanPreferences', () => ({
  useKanbanPreferences: () => ({
    projectScope: '/projects/demo/kanban',
    preferencesReady: true,
    filters: { projectIds: [4], statusIds: [2], assigneeIds: [], trackerIds: [], q: '', priority: null, priorityFilterEnabled: false },
    fullWindow: false,
    fitMode: 'none',
    showSubtasks: true,
    sortKey: 'updated_on',
    hiddenStatusIds: new Set<number>(),
    fontSize: 14,
    timeEntryOnClose: false,
    laneType: 'none',
    agingWarnDays: 7,
    agingDangerDays: 14,
    agingExcludeClosed: false,
    viewableProjectsEnabled: false,
    maximumBoardEntityCount: 3000,
    setFilters: vi.fn(), setFullWindow: vi.fn(), setFitMode: vi.fn(), setShowSubtasks: vi.fn(), setSortKey: vi.fn(),
    setHiddenStatusIds: vi.fn(), setFontSize: vi.fn(), setTimeEntryOnClose: vi.fn(), setLaneType: vi.fn(),
    setAgingWarnDays: vi.fn(), setAgingDangerDays: vi.fn(), setAgingExcludeClosed: vi.fn(), setViewableProjectsEnabled: vi.fn(),
    setMaximumBoardEntityCount: vi.fn(), setCurrentUserId: vi.fn(),
  }),
}));

describe('App board scope helpers', () => {
  it('keeps only allowed project, assignee, and tracker selections', () => {
    expect(normalizeProjectIds([1, 2, 3], new Set([1, 3]))).toEqual([1, 3]);
    expect(normalizeAssigneeIds(['unassigned', '2', '9'], new Set(['2']))).toEqual(['unassigned', '2']);
    expect(normalizeTrackerIds([1, 2, 3], new Set([2]))).toEqual([2]);
  });

  it('selects a creatable project with the board project as fallback', () => {
    expect(resolveDefaultCreateProjectId([2, 1], new Set([1]), 1)).toBe(1);
    expect(resolveDefaultCreateProjectId([2], new Set(), 1)).toBeNull();
  });

  beforeEach(() => vi.mocked(getJson).mockClear());

  it('uses hydrated preferences in the first board request', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(App, { dataUrl: '/projects/demo/kanban/data', initialCurrentUserId: 7 }),
    ));

    await waitFor(() => expect(getJson).toHaveBeenCalled());
    expect(vi.mocked(getJson).mock.calls[0][0]).toBe('/projects/demo/kanban/data?project_ids%5B%5D=4&issue_status_ids%5B%5D=2&board_entity_limit=3000');
  });
});
