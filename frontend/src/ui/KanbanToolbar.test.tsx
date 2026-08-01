// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KanbanToolbar } from './KanbanToolbar';
import type { BoardData } from './types';
import type { Filters } from './boardFilters';

function makeData(): BoardData {
  return {
    ok: true,
    meta: {
      project_id: 1,
      current_user_id: 7,
      can_move: true,
      can_create: true,
      can_delete: true,
      lane_type: 'assignee',
      aging_warn_days: 3,
      aging_danger_days: 7,
      aging_exclude_closed: true,
    },
    columns: [{ id: 1, name: 'Open', is_closed: false, count: 1 }],
    lanes: [{ id: 'unassigned', name: 'Unassigned', assigned_to_id: null }],
    lists: {
      assignees: [
        { id: null, name: 'Unassigned' },
        { id: 7, name: 'Alice' },
        { id: 8, name: 'Bob' },
      ],
      trackers: [{ id: 1, name: 'Bug' }],
      priorities: [{ id: 1, name: 'Normal' }, { id: 2, name: 'High' }],
      projects: [{ id: 1, name: 'Demo', level: 0 }],
      viewable_projects: [{ id: 1, name: 'Demo', level: 0 }],
      creatable_projects: [{ id: 1, name: 'Demo', level: 0 }],
    },
    issues: [],
    labels: {
      all: 'All',
      assignee: 'Assignee',
      create: 'Create',
      due_date: 'Due',
      filter: 'Filter',
      filter_subject: 'Filter subject',
      filter_task: 'Filter task',
      font_size: 'Font size',
      help: 'Help',
      issue_priority: 'Priority',
      me: 'Me',
      not_set: 'Not set',
      overdue: 'Overdue',
      priority: 'Priority',
      project: 'Project',
      reset: 'Reset',
      show_subtasks: 'Show subtasks',
      status: 'Status',
      issue_tracker: 'Tracker',
      this_week: 'This week',
      unassigned: 'Unassigned',
      within_1_day: 'Within 1 day',
      within_1_week: 'Within 1 week',
      within_3_days: 'Within 3 days',
      within_specified_days: 'Within specified days',
    },
  };
}

function makeFilters(overrides: Partial<Filters> = {}): Filters {
  return {
    assigneeIds: [],
    q: '',
    due: 'all',
    dueDays: 7,
    priority: [],
    priorityFilterEnabled: false,
    projectIds: [],
    statusIds: [],
    trackerIds: [],
    ...overrides,
  };
}

describe('KanbanToolbar', () => {
  function renderToolbar(filters: Filters, onChange = vi.fn(), data = makeData(), onRefreshTree = vi.fn(), onLoadMoreTree = vi.fn()) {
    const onChangeSort = vi.fn();
    const rendered = render(
      <KanbanToolbar
        data={data}
        filters={filters}
        onChange={onChange}
        sortKey="updated_desc"
        onChangeSort={onChangeSort}
        fullWindow={false}
        onToggleFullWindow={vi.fn()}
        fitMode="none"
        onToggleFitMode={vi.fn()}
        showSubtasks
        onToggleShowSubtasks={vi.fn()}
        fontSize={13}
        onChangeFontSize={vi.fn()}
        canCreate={false}
        onCreate={vi.fn()}
        onScrollToTop={vi.fn()}
        onLoadMoreTree={onLoadMoreTree}
        onRefreshTree={onRefreshTree}
        timeEntryOnClose={false}
        onToggleTimeEntryOnClose={vi.fn()}
        viewableProjectsEnabled={false}
        onToggleViewableProjects={vi.fn()}
        onOpenHelp={vi.fn()}
      />,
    );
    return { onChange, onChangeSort, ...rendered };
  }

  it('shows selection count for multi-assignee filters', () => {
    renderToolbar(makeFilters({ assigneeIds: ['unassigned', '7'] }));

    expect(screen.getByTitle('Unassigned, Alice').textContent).toContain('Assignee (2)');
  });

  it('shows the text filter trigger as an icon only', () => {
    const { container, unmount } = renderToolbar(makeFilters());

    const trigger = container.querySelector('[title="Filter"]');
    expect(trigger?.textContent).toBe('filter_list');
    unmount();
  });

  it('updates assigneeIds when an assignee is selected', () => {
    const { onChange } = renderToolbar(makeFilters());

    fireEvent.click(screen.getByTitle('Assignee'));
    fireEvent.click(screen.getByText('Alice'));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ assigneeIds: ['7'] }));
  });

  it('updates trackerIds when a tracker is selected', () => {
    const { onChange, container } = renderToolbar(makeFilters());

    const trigger = container.querySelector('[title="Tracker"]');
    if (!(trigger instanceof HTMLElement)) throw new Error('Tracker trigger not found');
    fireEvent.click(trigger);
    const option = Array.from(container.querySelectorAll('.rk-dropdown-item')).find((item) => item.textContent === 'Bug');
    if (!(option instanceof HTMLElement)) throw new Error('Tracker option not found');
    fireEvent.click(option);

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ trackerIds: [1] }));
  });

  it('shows selection count for tracker filters', () => {
    const { container } = renderToolbar(makeFilters({ trackerIds: [1] }));

    expect(Array.from(container.querySelectorAll('.rk-dropdown-trigger')).find((item) => item.textContent?.includes('Tracker'))?.textContent).toContain('Tracker (1)');
  });

  it('resets assigneeIds to an empty selection', () => {
    const { container, onChange } = renderToolbar(makeFilters({ assigneeIds: ['7'] }));

    fireEvent.click(screen.getByTitle('Alice'));
    const resetButton = container.querySelector('.rk-dropdown-menu .rk-dropdown-link');
    if (!(resetButton instanceof HTMLButtonElement)) throw new Error('Reset button not found');
    fireEvent.click(resetButton);

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ assigneeIds: [] }));
  });

  it('includes not-set in priority filter options', () => {
    const { container } = renderToolbar(makeFilters());

    const triggers = Array.from(container.querySelectorAll('.rk-dropdown-trigger'));
    const priorityTrigger = triggers.find((element) => element.textContent?.includes('Priority'));
    if (!(priorityTrigger instanceof HTMLDivElement)) throw new Error('Priority trigger not found');
    fireEvent.click(priorityTrigger);

    expect(screen.getByText('Not set')).toBeTruthy();
  });

  it('opens a single sort menu and changes the selected direction', () => {
    const { onChangeSort } = renderToolbar(makeFilters());

    const sortTriggers = screen.getAllByTitle('Sort');
    fireEvent.click(sortTriggers[sortTriggers.length - 1]);
    expect(screen.getByRole('menu', { name: 'Sort' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Priority' }));

    expect(onChangeSort).toHaveBeenCalledWith('priority_asc');
    expect(screen.getByRole('menu', { name: 'Sort' })).toBeTruthy();
  });

  it('groups display switches and selects in the display settings menu', () => {
    const { container } = renderToolbar(makeFilters());

    const settingsTriggers = screen.getAllByTitle('Display settings');
    fireEvent.click(settingsTriggers[settingsTriggers.length - 1]);
    expect(screen.getByRole('dialog', { name: 'Display settings' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Show subtasks' })).toBeTruthy();
    expect(container.querySelectorAll('.rk-settings-select-row')).toHaveLength(5);
  });

  it('places the viewable-project switch in the project filter popup', () => {
    const { container } = renderToolbar(makeFilters());
    const projectTriggers = container.querySelectorAll('.rk-dropdown-trigger[title="Project"]');
    fireEvent.click(projectTriggers[projectTriggers.length - 1]);

    expect(container.querySelector('.rk-dropdown-extra [role="switch"]')).toBeTruthy();
    expect(container.querySelector('.rk-settings-menu')?.textContent ?? '').not.toContain('Show viewable projects');
  });

  it('announces tree truncation and exposes a refresh recovery action', () => {
    const data = makeData();
    const onRefreshTree = vi.fn();
    data.meta.tree = {
      node_limit: 1500,
      root_issue_count: 1,
      unique_node_count: 1500,
      serialized_node_count: 1500,
      duplicate_node_count: 0,
      truncated: true,
    };
    data.meta.pagination = {
      issue_limit: 500,
      offset: 0,
      issue_count: 500,
      total_issue_count: 1000,
      next_offset: 500,
      has_more_issues: true,
    };

    renderToolbar(makeFilters(), vi.fn(), data, onRefreshTree);

    expect(screen.getByRole('status').textContent).toContain('Some subtasks are not shown yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh tree' }));
    expect(onRefreshTree).toHaveBeenCalledOnce();
  });

  it('exposes recovery for an unexpanded parent', () => {
    const data = makeData();
    const onLoadMoreTree = vi.fn();
    data.meta.tree = {
      node_limit: 1500,
      root_issue_count: 1,
      unique_node_count: 1,
      serialized_node_count: 1,
      duplicate_node_count: 0,
      truncated: true,
      truncated_parent_ids: [],
      unexpanded_parent_ids: [7],
    };

    renderToolbar(makeFilters(), vi.fn(), data, vi.fn(), onLoadMoreTree);

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(onLoadMoreTree).toHaveBeenCalledOnce();
  });
});
