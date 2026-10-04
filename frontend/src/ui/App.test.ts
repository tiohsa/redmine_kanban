// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, canCreateInBoard, normalizeAssigneeIds, normalizeProjectIds, normalizeTrackerIds, resolveDefaultCreateProjectId } from './App';
import { getJson, isHttpError, postJson } from '../infrastructure/api/http';
import { parseBoardSnapshotV3 } from '../infrastructure/api/boardSnapshot';
import { makeBoardSnapshot } from '../test/fixtures/boardSnapshot';

const metadata = vi.hoisted(() => ({ ok: true, board: { id: 1, name: 'Demo', identifier: 'demo' }, projects: [{ id: 4, name: 'Demo', level: 0 }], viewable_projects: [{ id: 4, name: 'Demo', level: 0 }], statuses: [{ id: 1, name: 'Open', is_closed: false }, { id: 2, name: 'Closed', is_closed: true }], server_entity_limit: 10000, filter_options_complete: true, filter_options: { assignees: [{ id: 8, name: 'Recovery Assignee', available_project_ids: [4] }], trackers: [{ id: 3, name: 'Recovery Tracker', available_project_ids: [4] }], priorities: [{ id: 2, name: 'Recovery Priority' }] } }));
const iframeUnmountSpy = vi.hoisted(() => vi.fn());
const canvasRenderSpy = vi.hoisted(() => vi.fn());
const mockSetFilters = vi.hoisted(() => vi.fn());
const mockPreferenceFilters = vi.hoisted(() => ({
  projectIds: [4],
  statusIds: [2],
  assigneeIds: [],
  trackerIds: [],
  q: '',
  priority: [],
  priorityFilterEnabled: false,
  due: 'all' as 'all' | 'overdue' | 'none',
  dueDays: 7,
}));
const mockHiddenStatuses = vi.hoisted(() => ({ ids: [] as number[] }));
const mockCreatePayload = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const mockDialogControl = vi.hoisted(() => ({ showCreateModal: false }));

vi.mock('./board/CanvasBoard', async () => {
  const ReactModule = await import('react');
  return {
    CanvasBoard: ReactModule.forwardRef(({ onEdit, onCreate, onCommand, state }: { onEdit: (issueId: number) => void; onCreate?: (ctx: { statusId: number }) => void; onCommand?: (command: { type: 'move_issue'; issueId: number; statusId: number; assignedToId: number | null; priorityId: number | null }) => unknown; state?: { cardsById?: Map<number, unknown> } }, _ref) => {
      canvasRenderSpy();
      return ReactModule.createElement(
      ReactModule.Fragment,
      null,
      ReactModule.createElement('button', { type: 'button', onClick: () => onEdit(9) }, 'Open issue 9'),
      ReactModule.createElement('button', { type: 'button', onClick: () => onCreate?.({ statusId: 2 }) }, 'Create test issue'),
      ReactModule.createElement('button', { type: 'button', onClick: () => onCommand?.({ type: 'move_issue', issueId: 9, statusId: 1, assignedToId: null, priorityId: 1 }) }, 'Move test issue'),
      ReactModule.createElement('div', { 'data-testid': 'canvas-issue-ids' }, [...(state?.cardsById?.keys() ?? [])].join(',')),
      );
    }),
  };
});

vi.mock('./IframeEditDialog', async () => {
  const ReactModule = await import('react');
  return {
    IframeEditDialog: ({ onNativeWriteComplete, url, issueId }: { onNativeWriteComplete?: () => void; url?: string; issueId?: number }) => {
      ReactModule.useEffect(() => () => { iframeUnmountSpy(); }, []);
      return ReactModule.createElement(
        ReactModule.Fragment,
        null,
        ReactModule.createElement('button', { type: 'button', 'data-testid': 'iframe-dialog', onClick: onNativeWriteComplete }, 'Complete native write'),
        ReactModule.createElement('div', { 'data-testid': 'iframe-context' }, `${issueId ?? ''}:${url ?? ''}`),
      );
    },
  };
});

vi.mock('./KanbanIssueModal', async () => {
  const ReactModule = await import('react');
  return {
    KanbanIssueModal: ({ onSaved }: { onSaved: (payload: Record<string, unknown>, isEdit: boolean) => Promise<void> }) => ReactModule.createElement(
      'button', { type: 'button', onClick: () => { void onSaved(mockCreatePayload.current, false); } }, 'Submit test creation',
    ),
  };
});

vi.mock('./useKanbanDialogs', async () => {
  const actual = await vi.importActual<typeof import('./useKanbanDialogs')>('./useKanbanDialogs');
  return {
    useKanbanDialogs: (...args: Parameters<typeof actual.useKanbanDialogs>) => {
      const dialogs = actual.useKanbanDialogs(...args);
      if (!mockDialogControl.showCreateModal) return dialogs;
      return {
        ...dialogs,
        modal: dialogs.modal ?? { statusId: 2, projectId: 4 },
        openCreate: (context: Parameters<typeof dialogs.openCreate>[0]) => dialogs.setModal(context),
      };
    },
  };
});

vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
});

vi.mock('../infrastructure/api/http', () => ({
  getJson: vi.fn((url: string) => Promise.resolve(url.includes('/metadata') ? metadata : {
    ok: true, contract_version: 3, scope_fingerprint: 'sha256:test',
    meta: { project_id: 1, project_ids: [4], scope_status_ids: [2], scope_fingerprint: 'sha256:test', current_user_id: 7, can_move: false, can_create: false, can_delete: false, lane_type: 'none', aging_warn_days: 7, aging_danger_days: 14, aging_exclude_closed: false, complete: true, entity_count: 0 },
    columns: [], lanes: [], lists: { assignees: [], trackers: [], priorities: [], projects: [], viewable_projects: [], creatable_projects: [] }, issues: [], entities: [], tree: { root_ids: [], children_by_parent_id: {} }, labels: {},
  })),
  isHttpError: vi.fn(() => false),
  postJson: vi.fn(),
}));

vi.mock('./useKanbanPreferences', () => ({
  useKanbanPreferences: () => {
    const [hiddenStatusIds, setHiddenStatusIds] = React.useState(() => new Set(mockHiddenStatuses.ids));
    return {
      viewSettings: { filters: mockPreferenceFilters, sortConfig: [{ field: 'updated', direction: 'desc' }], laneType: 'none', hiddenStatusIds: [...hiddenStatusIds], viewableProjectsEnabled: false },
      applyViewSettings: vi.fn(),
      projectScope: '/projects/demo/kanban',
      preferencesReady: true,
      filters: mockPreferenceFilters,
      fullWindow: false,
      fitMode: 'none',
      showSubtasks: true,
      sortConfig: [{ field: 'updated', direction: 'desc' }],
      hiddenStatusIds,
      fontSize: 14,
      timeEntryOnClose: false,
      laneType: 'none',
      agingWarnDays: 7,
      agingDangerDays: 14,
      agingExcludeClosed: false,
      viewableProjectsEnabled: false,
      setFilters: mockSetFilters, setFullWindow: vi.fn(), setFitMode: vi.fn(), setShowSubtasks: vi.fn(), setSortConfig: vi.fn(),
      setHiddenStatusIds, setFontSize: vi.fn(), setTimeEntryOnClose: vi.fn(), setLaneType: vi.fn(),
      setAgingWarnDays: vi.fn(), setAgingDangerDays: vi.fn(), setAgingExcludeClosed: vi.fn(), setViewableProjectsEnabled: vi.fn(),
      setCurrentUserId: vi.fn(),
    };
  },
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

  it.each(['single', 'bulk'] as const)('opens the created issue after %s creation invalidates the board snapshot', async (kind) => {
    mockDialogControl.showCreateModal = true;
    const snapshot = makeBoardSnapshot();
    snapshot.meta.filter_scope = { q: 'active', assignee_ids: [], include_unassigned: false, tracker_ids: [], priority_filter_enabled: false, priority_ids: [], include_no_priority: false, due: 'all' };
    snapshot.labels = { ...snapshot.labels, created: 'Created', created_with_subtasks: 'Created %{id} with %{count} subtasks' };
    const createdIssue = {
      id: 42, subject: 'Created issue', status_id: 2, tracker_id: 1, project: { id: 4, name: 'Demo' },
      urls: { issue: '/issues/42', issue_edit: '/issues/42/edit' },
    };
    let snapshotRequests = 0;
    let finishSnapshotRefresh: ((value: typeof snapshot) => void) | undefined;
    vi.mocked(getJson).mockImplementation((url) => {
      if (url.includes('/metadata')) return Promise.resolve(metadata);
      if (url.includes('/data?') && ++snapshotRequests > 1) return new Promise((resolve) => { finishSnapshotRefresh = resolve; });
      return Promise.resolve(snapshot);
    });
    vi.mocked(postJson).mockResolvedValue({
      ok: true, issue: createdIssue, created_issues: [],
      ...(kind === 'bulk' ? { subtasks: [{ id: 43 }, { id: 44 }] } : {}),
      invalidations: { board_snapshot: true },
    } as never);
    mockCreatePayload.current = kind === 'single'
      ? { subject: 'Created issue', project_id: 4, tracker_id: 1, status_id: 2 }
      : { subject: 'Created issue', project_id: 4, tracker_id: 1, status_id: 2, subtasks: [{ subject: 'Child one', trackerId: 1 }, { subject: 'Child two', trackerId: 1 }] };

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const resetQueries = vi.spyOn(queryClient, 'resetQueries');
    mockPreferenceFilters.q = 'active';
    render(React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(App, { dataUrl: '/projects/demo/kanban/data', initialCurrentUserId: 7 }),
    ));

    await screen.findByTestId('canvas-issue-ids');
    fireEvent.click(screen.getByRole('button', { name: 'Create test issue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Submit test creation' }));

    await waitFor(() => expect(resetQueries).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(finishSnapshotRefresh).toBeDefined());
    expect(postJson).toHaveBeenCalledTimes(1);
    expect(vi.mocked(postJson).mock.calls[0][0]).toContain(kind === 'bulk' ? '/issues/bulk' : '/issues?');
    expect(vi.mocked(postJson).mock.calls[0][0]).toContain('filter_q=active');
    expect(screen.getByTestId('iframe-context').textContent).toBe('42:/issues/42');
    if (kind === 'bulk') expect(await screen.findByText('Created 42 with 2 subtasks')).toBeTruthy();
    const authoritativeSnapshot = makeBoardSnapshot();
    authoritativeSnapshot.meta.filter_scope = snapshot.meta.filter_scope;
    authoritativeSnapshot.entities = [];
    authoritativeSnapshot.tree = { root_ids: [], children_by_parent_id: {} };
    authoritativeSnapshot.meta.entity_count = 0;
    await act(async () => { finishSnapshotRefresh?.(authoritativeSnapshot); });
    await waitFor(() => expect(queryClient.getQueriesData<{ meta: { complete?: boolean }; issues: Array<{ id: number }> }>({ queryKey: ['kanban', 'board'] })
      .some(([, board]) => board?.meta.complete === true && board.issues.length === 0)).toBe(true));
    expect(screen.getByTestId('iframe-context').textContent).toBe('42:/issues/42');
    const boardData = queryClient.getQueriesData<{ issues: Array<{ id: number }> }>({ queryKey: ['kanban', 'board'] });
    expect(boardData.flatMap(([, board]) => board?.issues ?? []).some((issue) => issue.id === 42)).toBe(false);
    queryClient.clear();
  });

  beforeEach(() => {
    mockDialogControl.showCreateModal = false;
    vi.mocked(getJson).mockClear();
    vi.mocked(isHttpError).mockImplementation(() => false);
    vi.mocked(getJson).mockImplementation((url) => Promise.resolve(url.includes('/metadata') ? metadata : makeBoardSnapshot()));
    vi.mocked(postJson).mockReset();
    mockSetFilters.mockReset();
    canvasRenderSpy.mockClear();
    mockPreferenceFilters.projectIds = [4];
    mockPreferenceFilters.statusIds = [2];
    mockPreferenceFilters.due = 'all';
    mockPreferenceFilters.q = '';
    mockHiddenStatuses.ids = [];
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('keeps the board toolbar available during a move-triggered snapshot refresh', async () => {
    mockPreferenceFilters.q = 'active';
    const snapshot = makeBoardSnapshot();
    snapshot.meta.filter_scope = { q: 'active', assignee_ids: [], include_unassigned: false, tracker_ids: [], priority_filter_enabled: false, priority_ids: [], include_no_priority: false, due: 'all' };
    let snapshotRequests = 0;
    let finishInitialLoad: ((value: typeof snapshot) => void) | undefined;
    let finishSnapshotRefresh: ((value: typeof snapshot) => void) | undefined;
    vi.mocked(getJson).mockImplementation((url) => {
      if (url.includes('/metadata')) return Promise.resolve(metadata);
      snapshotRequests += 1;
      return new Promise((resolve) => {
        if (snapshotRequests === 1) finishInitialLoad = resolve;
        else finishSnapshotRefresh = resolve;
      });
    });
    vi.mocked(postJson).mockResolvedValue({ ok: true, invalidations: { board_snapshot: true } } as never);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(App, { dataUrl: '/projects/demo/kanban/data', initialCurrentUserId: 7 }),
    ));

    await waitFor(() => expect(finishInitialLoad).toBeDefined());
    expect(document.querySelector('.rk-popup-info[role="dialog"]')).not.toBeNull();
    await act(async () => { finishInitialLoad?.(snapshot); });
    await screen.findByTestId('canvas-issue-ids');

    const findToolbarButton = (icon: string) => {
      const element = [...document.querySelectorAll('.rk-toolbar .rk-icon')].find((item) => item.textContent === icon);
      return element?.closest('button') ?? null;
    };
    const toolbar = document.querySelector('.rk-toolbar');
    const board = document.querySelector('.rk-board');
    const createButton = findToolbarButton('add');
    const assigneeTrigger = findToolbarButton('person');
    const searchTrigger = findToolbarButton('filter_list');
    expect(toolbar).not.toBeNull();
    expect(board).not.toBeNull();
    expect(createButton).not.toBeNull();
    expect(assigneeTrigger).not.toBeNull();
    expect(searchTrigger).not.toBeNull();
    expect((createButton as HTMLButtonElement).disabled).toBe(false);
    const metadataRequestCount = () => vi.mocked(getJson).mock.calls.filter(([url]) => url.includes('/metadata')).length;
    expect(metadataRequestCount()).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Move test issue' }));
    await waitFor(() => expect(finishSnapshotRefresh).toBeDefined());
    expect(snapshotRequests).toBe(2);
    expect(metadataRequestCount()).toBe(1);
    expect(postJson).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.rk-popup-info[role="dialog"]')).toBeNull();
    expect(document.querySelector('.rk-toolbar')).toBe(toolbar);
    expect(document.querySelector('.rk-board')).toBe(board);
    expect(findToolbarButton('add')).toBe(createButton);
    expect(findToolbarButton('person')).toBe(assigneeTrigger);
    expect(findToolbarButton('filter_list')).toBe(searchTrigger);
    expect((createButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(createButton!);
    expect(postJson).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Open issue 9' }));
    expect(screen.queryByTestId('iframe-context')).toBeNull();
    expect(postJson).toHaveBeenCalledTimes(1);

    fireEvent.click(assigneeTrigger!);
    fireEvent.click(await screen.findByText('Recovery Assignee'));
    expect(mockSetFilters).toHaveBeenCalledWith(expect.objectContaining({ assigneeIds: ['8'] }));

    fireEvent.click(findToolbarButton('label')!);
    expect(await screen.findByText('Recovery Tracker')).toBeTruthy();
    fireEvent.click(findToolbarButton('priority_high')!);
    expect(await screen.findByText('Recovery Priority')).toBeTruthy();

    fireEvent.click(findToolbarButton('filter_list')!);
    const searchInput = document.querySelector<HTMLInputElement>('.rk-toolbar .rk-search-box input');
    expect(searchInput?.value).toBe('active');

    const authoritativeSnapshot = makeBoardSnapshot();
    authoritativeSnapshot.meta.filter_scope = snapshot.meta.filter_scope;
    await act(async () => { finishSnapshotRefresh?.(authoritativeSnapshot); });
    await waitFor(() => expect((createButton as HTMLButtonElement).disabled).toBe(false));
    expect(document.querySelector('.rk-toolbar')).toBe(toolbar);
    expect(document.querySelector('.rk-board')).toBe(board);
    expect(findToolbarButton('add')).toBe(createButton);
    expect(findToolbarButton('person')).toBe(assigneeTrigger);
    expect(findToolbarButton('filter_list')).toBe(searchTrigger);
    expect(metadataRequestCount()).toBe(1);
    queryClient.clear();
  });

  it('applies a bounded move delta without refetching board or metadata', async () => {
    mockPreferenceFilters.statusIds = [1, 2];
    const snapshot = makeBoardSnapshot();
    snapshot.meta.scope_status_ids = [1, 2];
    snapshot.meta.dependency_status_ids = [1, 2];
    snapshot.columns = [
      { id: 1, name: 'Open', is_closed: false, count: 0 },
      { id: 2, name: 'Closed', is_closed: true, count: 1 },
    ];
    snapshot.entities[0].allowed_status_ids = [1, 2];
    snapshot.lists.trackers[0].workflow_status_ids = [1, 2];
    vi.mocked(getJson).mockImplementation((url) => Promise.resolve(url.includes('/metadata') ? metadata : snapshot));
    const movedIssue = {
      ...snapshot.entities[0],
      status_id: 1,
      lock_version: 1,
      updated_on: '2026-09-24T10:00:00Z',
    };
    vi.mocked(postJson).mockResolvedValue({
      ok: true,
      contract_version: 3,
      scope_fingerprint: snapshot.scope_fingerprint,
      issue_updates: [movedIssue],
      invalidations: { issue_ids: [], parent_ids: [], column_counts: false, root_order: false, board_snapshot: false },
      column_counts: {},
    } as never);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(App, { dataUrl: '/projects/demo/kanban/data', initialCurrentUserId: 7 }),
    ));
    await screen.findByTestId('canvas-issue-ids');

    const getCounts = () => ({
      metadata: vi.mocked(getJson).mock.calls.filter(([url]) => url.includes('/metadata')).length,
      snapshots: vi.mocked(getJson).mock.calls.filter(([url]) => url.includes('/data?')).length,
    });
    const beforeMove = getCounts();
    expect(beforeMove).toEqual({ metadata: 1, snapshots: 1 });
    const createButton = [...document.querySelectorAll('.rk-toolbar .rk-icon')]
      .find((item) => item.textContent === 'add')?.closest('button') as HTMLButtonElement | undefined;
    expect(createButton?.disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Move test issue' }));
    await waitFor(() => expect(queryClient.getQueriesData<{ issues: Array<{ id: number; status_id: number }> }>({ queryKey: ['kanban', 'board'] })
      .some(([, board]) => board?.issues.some((issue) => issue.id === 9 && issue.status_id === 1))).toBe(true));

    expect(postJson).toHaveBeenCalledTimes(1);
    expect(getCounts()).toEqual(beforeMove);
    expect(createButton?.disabled).toBe(false);
    expect(document.querySelector('.rk-popup-info[role="dialog"]')).toBeNull();
    queryClient.clear();
  });

  it('shows metadata filter choices after a 422 snapshot overflow and applies an assignee selection', async () => {
    vi.mocked(getJson).mockImplementation((url) => url.includes('/metadata')
      ? Promise.resolve(metadata)
      : Promise.reject(Object.assign(new Error('snapshot overflow'), { status: 422, payload: { error: { code: 'BOARD_SCOPE_TOO_LARGE', effective_entity_limit: 2, server_entity_limit: 2 } } })));
    vi.mocked(isHttpError).mockImplementation((error) => typeof error === 'object' && error !== null && 'status' in error);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const incompleteNotice = 'Filter choices unavailable';
    render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(App, { dataUrl: '/projects/demo/kanban/data', initialCurrentUserId: 7, initialLabels: { board_scope_too_large: 'Scope %{limit}', board_filter_options_incomplete: incompleteNotice } })));

    await screen.findByText('Scope 2');
    expect(screen.queryByText(incompleteNotice)).toBeNull();
    const clickIcon = (icon: string) => {
      const element = [...document.querySelectorAll('.rk-toolbar .rk-icon')].find((item) => item.textContent === icon);
      if (!element?.closest('button')) throw new Error(`Missing ${icon} toolbar button`);
      fireEvent.click(element.closest('button')!);
    };
    clickIcon('person');
    fireEvent.click(await screen.findByText('Recovery Assignee'));
    expect(mockSetFilters).toHaveBeenCalledWith(expect.objectContaining({ assigneeIds: ['8'] }));

    clickIcon('label');
    expect(await screen.findByText('Recovery Tracker')).toBeTruthy();
    clickIcon('priority_high');
    expect(await screen.findByText('Recovery Priority')).toBeTruthy();
    queryClient.clear();
  });

  it('shows the incomplete filter notice during snapshot recovery while core filters remain usable', async () => {
    const incompleteMetadata = { ...metadata, filter_options_complete: false, filter_options: { assignees: [], trackers: [], priorities: [] }, filter_options_error: { code: 'BOARD_FILTER_OPTIONS_TOO_LARGE', resource: 'assignees', limit: 10000 } };
    vi.mocked(getJson).mockImplementation((url) => url.includes('/metadata')
      ? Promise.resolve(incompleteMetadata)
      : Promise.reject(Object.assign(new Error('snapshot overflow'), { status: 422, payload: { error: { code: 'BOARD_SCOPE_TOO_LARGE', effective_entity_limit: 2, server_entity_limit: 2 } } })));
    vi.mocked(isHttpError).mockImplementation((error) => typeof error === 'object' && error !== null && 'status' in error);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(App, {
      dataUrl: '/projects/demo/kanban/data', initialCurrentUserId: 7,
      initialLabels: { board_scope_too_large: 'Scope %{limit}', board_filter_options_incomplete: 'Filter choices unavailable' },
    })));

    await screen.findByText('Scope 2');
    expect(screen.getByRole('status').textContent).toContain('Filter choices unavailable');
    const statusButton = [...document.querySelectorAll('.rk-toolbar .rk-icon')].find((item) => item.textContent === 'filter_list')?.closest('button');
    expect(statusButton).toBeTruthy();
    fireEvent.click(statusButton!);
    await waitFor(() => expect(document.querySelector('.rk-dropdown-menu[role="dialog"]')).not.toBeNull());
    queryClient.clear();
  });

  it('shows incomplete filter metadata alongside a successfully loaded board and hides it for complete metadata', async () => {
    const incompleteMetadata = { ...metadata, filter_options_complete: false, filter_options: { assignees: [], trackers: [], priorities: [] }, filter_options_error: { code: 'BOARD_FILTER_OPTIONS_TOO_LARGE', resource: 'assignees', limit: 10000 } };
    let metadataCalls = 0;
    vi.mocked(getJson).mockImplementation((url) => url.includes('/metadata')
      ? Promise.resolve(++metadataCalls === 1 ? incompleteMetadata : metadata)
      : Promise.resolve(makeBoardSnapshot()));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(App, { dataUrl: '/projects/demo/kanban/data', initialCurrentUserId: 7, initialLabels: { board_filter_options_incomplete: 'Filter choices unavailable' } }),
    ));

    await screen.findByTestId('canvas-issue-ids');
    expect(screen.getByRole('status').textContent).toContain('Filter choices unavailable');
    expect(document.querySelector('.rk-toolbar')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Open issue 9' })).toBeTruthy();
    fireEvent.click([...document.querySelectorAll('.rk-toolbar .rk-icon')].find((item) => item.textContent === 'filter_list')!.closest('button')!);
    await waitFor(() => expect(document.querySelector('.rk-dropdown-menu[role="dialog"]')).not.toBeNull());

    mockPreferenceFilters.projectIds = [];
    view.rerender(React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(App, { dataUrl: '/projects/demo/kanban/data', initialCurrentUserId: 7, initialLabels: { board_filter_options_incomplete: 'Filter choices unavailable' } }),
    ));
    await waitFor(() => expect(metadataCalls).toBe(2));
    await screen.findByTestId('canvas-issue-ids');
    await waitFor(() => expect(screen.queryByText('Filter choices unavailable')).toBeNull());
    queryClient.clear();
  });

  it('keeps project and status choices available while scoped metadata is pending', async () => {
    const expandedMetadata = {
      ...metadata,
      projects: [...metadata.projects, { id: 5, name: 'Other project', level: 0 }],
      viewable_projects: [...metadata.viewable_projects, { id: 5, name: 'Other project', level: 0 }],
    };
    const boardSnapshot = makeBoardSnapshot();
    boardSnapshot.lists.projects.push({ id: 5, name: 'Other project', level: 0 });
    boardSnapshot.lists.viewable_projects.push({ id: 5, name: 'Other project', level: 0 });
    let releaseScopedMetadata: ((value: typeof expandedMetadata) => void) | undefined;
    let metadataCalls = 0;
    vi.mocked(getJson).mockImplementation((url) => {
      if (!url.includes('/metadata')) return Promise.resolve(boardSnapshot);
      metadataCalls += 1;
      if (metadataCalls === 1) return Promise.resolve(expandedMetadata);
      return new Promise((resolve) => { releaseScopedMetadata = resolve; });
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const app = (labels: Record<string, string> = {}) => React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(App, {
        dataUrl: '/projects/demo/kanban/data', initialCurrentUserId: 7,
        initialLabels: { project: 'Project', status: 'Status', assignee: 'Assignee', board_filter_options_incomplete: 'Filter choices unavailable', ...labels },
      }),
    );
    const view = render(app());
    await screen.findByTestId('canvas-issue-ids');
    const canvasShell = screen.getByTestId('canvas-issue-ids');
    const clickIcon = (icon: string) => {
      const element = [...document.querySelectorAll('.rk-toolbar .rk-icon')].find((item) => item.textContent === icon);
      if (!element?.closest('button')) throw new Error(`Missing ${icon} toolbar button`);
      fireEvent.click(element.closest('button')!);
    };

    clickIcon('folder');
    const projectDialog = document.querySelector('.rk-dropdown-menu[role="dialog"]')!;
    expect(screen.getByRole('button', { name: 'Other project' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Other project' }));
    expect(mockSetFilters).toHaveBeenCalledWith(expect.objectContaining({ projectIds: [4, 5] }));
    mockPreferenceFilters.projectIds = [4, 5];
    view.rerender(app());

    await waitFor(() => expect(releaseScopedMetadata).toBeTypeOf('function'));
    expect(projectDialog.isConnected).toBe(true);
    expect(screen.getByRole('button', { name: 'Other project' })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('canvas-issue-ids').textContent).toBe(''));
    expect(screen.getByTestId('canvas-issue-ids')).toBe(canvasShell);
    clickIcon('person');
    expect(screen.queryByRole('button', { name: 'Recovery Assignee' })).toBeNull();
    expect(screen.queryByText('Filter choices unavailable')).toBeNull();
    clickIcon('fact_check');
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();
    expect(screen.getByTestId('canvas-issue-ids')).toBe(canvasShell);

    await act(async () => { releaseScopedMetadata?.(expandedMetadata); });
    await waitFor(() => expect(metadataCalls).toBe(2));
    queryClient.clear();
  });

  it.each([500, 403])('does not show the incomplete filter notice when metadata fails with HTTP %i', async (status) => {
    vi.mocked(getJson).mockRejectedValue(Object.assign(new Error('metadata failed'), { status }));
    vi.mocked(isHttpError).mockImplementation((error) => typeof error === 'object' && error !== null && 'status' in error);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(App, {
      dataUrl: '/projects/demo/kanban/data', initialCurrentUserId: 7,
      initialLabels: { board_metadata_failed: 'Metadata failed', retry: 'Retry', board_filter_options_incomplete: 'Filter choices unavailable' },
    })));

    await screen.findByText('Metadata failed');
    expect(screen.queryByText('Filter choices unavailable')).toBeNull();
    queryClient.clear();
  });

  it.each(['missing lists', 'missing issue URLs', 'numeric tracker name'])('rejects %s before board rendering', async (scenario) => {
    const valid = makeBoardSnapshot();
    const malformed = scenario === 'missing lists' ? { ...valid, lists: {} }
      : scenario === 'missing issue URLs' ? { ...valid, entities: valid.entities.map(({ urls: _urls, ...issue }) => issue) }
        : { ...valid, lists: { ...valid.lists, trackers: [{ id: 1, name: 123 }] } };
    expect(() => parseBoardSnapshotV3(malformed)).toThrow('Invalid board snapshot');
    vi.mocked(getJson).mockResolvedValueOnce(metadata).mockResolvedValueOnce(malformed);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(App, { dataUrl: '/projects/demo/kanban/data', initialCurrentUserId: 7, initialLabels: { load_failed: 'Snapshot load failed' } }),
    ));

    await screen.findByText('Snapshot load failed');
    expect(canvasRenderSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('canvas-issue-ids')).toBeNull();
    expect(queryClient.getQueriesData({ queryKey: ['kanban', 'board'] }).every(([, data]) => data === undefined)).toBe(true);
    queryClient.clear();
  });

  it('uses hydrated preferences in the first board request', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(App, { dataUrl: '/projects/demo/kanban/data', initialCurrentUserId: 7 }),
    ));

    await waitFor(() => expect(getJson).toHaveBeenCalledWith('/projects/demo/kanban/data?project_ids%5B%5D=4&issue_status_ids%5B%5D=2&filter_q=&filter_include_unassigned=0&filter_priority_enabled=0&filter_include_no_priority=0&filter_due=all', { signal: expect.any(AbortSignal) }));
    expect(vi.mocked(getJson).mock.calls.filter(([url]) => url.includes('/data?'))[0][0]).toBe('/projects/demo/kanban/data?project_ids%5B%5D=4&issue_status_ids%5B%5D=2&filter_q=&filter_include_unassigned=0&filter_priority_enabled=0&filter_include_no_priority=0&filter_due=all');
  });

  it('retries a relative-date snapshot with the current local day without fetching the old anchor', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 30, 12));
    mockPreferenceFilters.due = 'overdue';
    vi.mocked(getJson).mockResolvedValueOnce(metadata)
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('still offline'));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(App, {
        dataUrl: '/projects/demo/kanban/data', initialCurrentUserId: 7,
        initialLabels: { retry: 'Retry', board_recovery: 'Board recovery', board_recovery_help: 'Could not load board' },
      }),
    ));

    await screen.findByRole('button', { name: 'Retry' });
    const urls = () => vi.mocked(getJson).mock.calls.map(([url]) => url).filter((url) => url.includes('/data?'));
    expect(urls()).toHaveLength(1);
    expect(urls()[0]).toContain('filter_date_anchor=2026-09-30');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(urls()).toHaveLength(2), { timeout: 1500 });
    expect(urls()[1]).toContain('filter_date_anchor=2026-09-30');

    vi.setSystemTime(new Date(2026, 9, 1, 12));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(urls()).toHaveLength(3), { timeout: 1500 });

    expect(urls()[2]).toContain('filter_date_anchor=2026-10-01');
    expect(urls()[2]).not.toContain('filter_date_anchor=2026-09-30');
    queryClient.clear();
  });

  it.each(['all', 'none'] as const)('keeps the %s due query identity unchanged when the local day changes', async (due) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 30, 12));
    mockPreferenceFilters.due = due;
    vi.mocked(getJson).mockResolvedValueOnce(metadata).mockRejectedValueOnce(new Error('offline'));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(App, {
        dataUrl: '/projects/demo/kanban/data', initialCurrentUserId: 7,
        initialLabels: { retry: 'Retry', board_recovery: 'Board recovery', board_recovery_help: 'Could not load board' },
      }),
    ));

    await screen.findByRole('button', { name: 'Retry' });
    const urls = () => vi.mocked(getJson).mock.calls.map(([url]) => url).filter((url) => url.includes('/data?'));
    vi.setSystemTime(new Date(2026, 9, 1, 12));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(urls()).toHaveLength(2), { timeout: 1500 });

    expect(urls()[0]).toBe(urls()[1]);
    expect(urls()[1]).not.toContain('filter_date_anchor=');
    queryClient.clear();
  });

  it('fetches a new relative-date snapshot when the window resumes on a new local day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 30, 12));
    mockPreferenceFilters.due = 'overdue';
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(App, { dataUrl: '/projects/demo/kanban/data', initialCurrentUserId: 7 }),
    );
    const view = render(tree);

    await screen.findByTestId('canvas-issue-ids');
    const urls = () => vi.mocked(getJson).mock.calls.map(([url]) => url).filter((url) => url.includes('/data?'));
    expect(urls()).toHaveLength(1);
    expect(urls()[0]).toContain('filter_date_anchor=2026-09-30');

    vi.setSystemTime(new Date(2026, 9, 1, 12));
    fireEvent.focus(window);
    await waitFor(() => expect(urls()).toHaveLength(2), { timeout: 1500 });

    expect(urls()[1]).toContain('filter_date_anchor=2026-10-01');
    expect(queryClient.getQueryCache().findAll({ queryKey: ['kanban', 'board'] })
      .some((query) => JSON.stringify(query.queryKey).includes('2026-10-01'))).toBe(true);
    queryClient.clear();
  });

  it.each(['all', 'none'] as const)('does not fetch a new %s due snapshot when the local day syncs', async (due) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 30, 12));
    mockPreferenceFilters.due = due;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(App, { dataUrl: '/projects/demo/kanban/data', initialCurrentUserId: 7 }),
    ));
    await screen.findByTestId('canvas-issue-ids');
    const urls = () => vi.mocked(getJson).mock.calls.map(([url]) => url).filter((url) => url.includes('/data?'));
    expect(urls()).toHaveLength(1);

    vi.setSystemTime(new Date(2026, 9, 1, 0, 0, 1));
    fireEvent.focus(window);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(urls()).toHaveLength(1);
    expect(urls()[0]).not.toContain('filter_date_anchor=');
    queryClient.clear();
  });

  it('requires explicit confirmation to remove an unavailable hidden status before loading a complete snapshot', async () => {
    mockHiddenStatuses.ids = [999];
    const saved = '{"version":1,"views":[]}';
    localStorage.setItem('rk_saved_views:/projects/demo/kanban:user:7', saved);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(App, { dataUrl: '/projects/demo/kanban/data', initialCurrentUserId: 7, initialLabels: {
        saved_views_unavailable: 'Unavailable', hidden_statuses: 'Hidden statuses',
        hidden_statuses_remove_unavailable: 'Remove unavailable', hidden_statuses_remove_confirm: 'Remove %{ids}?',
        hidden_statuses_remove_action: 'Remove now', cancel: 'Cancel',
      } }),
    ));
    const remove = await screen.findByRole('button', { name: 'Remove unavailable' });
    expect(screen.getByRole('alert').textContent).toContain('Hidden statuses: 999');
    expect(vi.mocked(getJson).mock.calls.filter(([url]) => url.includes('/data?'))).toHaveLength(0);
    fireEvent.click(remove);
    expect(screen.getByText('Remove 999?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(vi.mocked(getJson).mock.calls.filter(([url]) => url.includes('/data?'))).toHaveLength(0);
    fireEvent.click(remove);
    fireEvent.click(screen.getByRole('button', { name: 'Remove now' }));
    await waitFor(() => expect(screen.getByTestId('canvas-issue-ids')).toBeTruthy());
    expect(vi.mocked(getJson).mock.calls.filter(([url]) => url.includes('/data?'))).toHaveLength(1);
    expect(localStorage.getItem('rk_saved_views:/projects/demo/kanban:user:7')).toBe(saved);
    queryClient.clear();
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
      entities: [
        { id: 9, subject: 'Parent', status_id: 2, tracker_id: 1, project: { id: 4, name: 'Demo' }, description: '', assigned_to_id: null, lock_version: 1, urls: { issue: '/issues/9', issue_edit: '/issues/9/edit' } },
        { id: 10, subject: 'Child', status_id: 1, tracker_id: 1, parent_id: 9, project: { id: 4, name: 'Demo' }, description: '', assigned_to_id: null, lock_version: 1, urls: { issue: '/issues/10', issue_edit: '/issues/10/edit' } },
      ],
      tree: { root_ids: [9], children_by_parent_id: { '9': [10] } },
      labels: {},
    };
    vi.mocked(getJson).mockResolvedValueOnce(metadata).mockResolvedValueOnce(boardData);
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
      .mockResolvedValueOnce(metadata)
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
