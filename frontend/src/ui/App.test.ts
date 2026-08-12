// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, canCreateInBoard, normalizeAssigneeIds, normalizeProjectIds, normalizeTrackerIds, resolveDefaultCreateProjectId } from './App';
import { getJson } from './http';

const iframeUnmountSpy = vi.hoisted(() => vi.fn());
const mockPreferenceFilters = vi.hoisted(() => ({
  projectIds: [4],
  statusIds: [2],
  assigneeIds: [],
  trackerIds: [],
  q: '',
  priority: [],
  priorityFilterEnabled: false,
  due: 'all' as const,
  dueDays: 7,
}));

vi.mock('./board/CanvasBoard', async () => {
  const ReactModule = await import('react');
  return {
    CanvasBoard: ReactModule.forwardRef(({ onEdit, state }: { onEdit: (issueId: number) => void; state?: { cardsById?: Map<number, unknown> } }, _ref) => ReactModule.createElement(
      ReactModule.Fragment,
      null,
      ReactModule.createElement('button', { type: 'button', onClick: () => onEdit(9) }, 'Open issue 9'),
      ReactModule.createElement('div', { 'data-testid': 'canvas-issue-ids' }, [...(state?.cardsById?.keys() ?? [])].join(',')),
    )),
  };
});

vi.mock('./IframeEditDialog', async () => {
  const ReactModule = await import('react');
  return {
    IframeEditDialog: ({ onNativeWriteComplete }: { onNativeWriteComplete?: () => void }) => {
      ReactModule.useEffect(() => () => { iframeUnmountSpy(); }, []);
      return ReactModule.createElement(
        'button', { type: 'button', 'data-testid': 'iframe-dialog', onClick: onNativeWriteComplete }, 'Complete native write',
      );
    },
  };
});

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
    filters: mockPreferenceFilters,
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

  it('requires a projected create candidate for toolbar and lane creation', () => {
    expect(canCreateInBoard(1, 2)).toBe(true);
    expect(canCreateInBoard(1, undefined)).toBe(false);
    expect(canCreateInBoard(null, 2)).toBe(false);
  });

  beforeEach(() => {
    vi.mocked(getJson).mockClear();
    mockPreferenceFilters.projectIds = [4];
    mockPreferenceFilters.statusIds = [2];
  });
  afterEach(() => cleanup());

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

  it('passes a promoted descendant to Canvas when an explicit status filter hides its parent', async () => {
    mockPreferenceFilters.projectIds = [];
    mockPreferenceFilters.statusIds = [1];
    const boardData = {
      ok: true, contract_version: 3, scope_fingerprint: 'sha256:projection',
      meta: { project_id: 4, project_ids: [4], scope_status_ids: [1], current_user_id: 7, can_move: true, can_create: true, can_delete: true, lane_type: 'none', aging_warn_days: 7, aging_danger_days: 14, aging_exclude_closed: false, complete: true, entity_count: 2 },
      columns: [{ id: 1, name: 'Open', is_closed: false }, { id: 2, name: 'Closed', is_closed: true }],
      lanes: [],
      lists: { assignees: [{ id: null, name: 'Unassigned' }], trackers: [{ id: 1, name: 'Bug' }], priorities: [], projects: [{ id: 4, name: 'Demo', level: 0 }], viewable_projects: [{ id: 4, name: 'Demo', level: 0 }], creatable_projects: [{ id: 4, name: 'Demo', level: 0 }] },
      issues: [{ id: 9, subject: 'Parent', status_id: 2, tracker_id: 1, project: { id: 4, name: 'Demo' }, description: '', assigned_to_id: null, lock_version: 1, urls: { issue: '/issues/9', issue_edit: '/issues/9/edit' }, subtasks: [{ id: 10, subject: 'Child', status_id: 1, tracker_id: 1, parent_id: 9, project: { id: 4, name: 'Demo' }, description: '', assigned_to_id: null, lock_version: 1, urls: { issue: '/issues/10', issue_edit: '/issues/10/edit' } }] }],
      labels: {},
    };
    vi.mocked(getJson).mockResolvedValueOnce(boardData);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(App, { dataUrl: '/projects/demo/kanban/data', initialCurrentUserId: 7 }),
    ));

    await waitFor(() => {
      expect(screen.getByTestId('canvas-issue-ids').textContent).toBe('10');
    });
  });

  it('keeps the iframe dialog mounted while its native write resets a pending board snapshot', async () => {
    iframeUnmountSpy.mockClear();
    const boardData = {
      ok: true, contract_version: 3, scope_fingerprint: 'sha256:test',
      meta: { project_id: 1, project_ids: [4], scope_status_ids: [2], current_user_id: 7, can_move: false, can_create: false, can_delete: false, lane_type: 'none', aging_warn_days: 7, aging_danger_days: 14, aging_exclude_closed: false, complete: true, entity_count: 1 },
      columns: [], lanes: [], lists: { assignees: [], trackers: [{ id: 1, name: 'Bug' }], priorities: [], projects: [], viewable_projects: [], creatable_projects: [] },
      issues: [{ id: 9, subject: 'Session issue', status_id: 2, tracker_id: 1, description: '', assigned_to_id: null, lock_version: 1, urls: { issue: '/issues/9', issue_edit: '/issues/9/edit' } }],
      entities: [{ id: 9, subject: 'Session issue', status_id: 2, tracker_id: 1, description: '', assigned_to_id: null, lock_version: 1, urls: { issue: '/issues/9', issue_edit: '/issues/9/edit' } }], tree: { root_ids: [9], children_by_parent_id: {} }, labels: {},
    };
    let resolvePendingBoard: ((value: typeof boardData) => void) | undefined;
    vi.mocked(getJson)
      .mockImplementationOnce(() => Promise.resolve(boardData))
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePendingBoard = resolve; }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(App, { dataUrl: '/projects/demo/kanban/data', initialCurrentUserId: 7 }),
    ));

    await screen.findByRole('button', { name: 'Open issue 9' });
    const openIssueButtons = screen.getAllByRole('button', { name: 'Open issue 9' });
    fireEvent.click(openIssueButtons[openIssueButtons.length - 1]);
    await screen.findByTestId('iframe-dialog');
    fireEvent.click(screen.getByTestId('iframe-dialog'));

    await waitFor(() => {
      expect(screen.getByTestId('iframe-dialog')).toBeTruthy();
      expect(iframeUnmountSpy).not.toHaveBeenCalled();
    });
    resolvePendingBoard?.(boardData);
    queryClient.clear();
  });
});
