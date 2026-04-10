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
      wip_limit_mode: 'column',
      wip_exceed_behavior: 'block',
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
      priorities: [{ id: 1, name: 'Normal' }],
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
      me: 'Me',
      not_set: 'Not set',
      overdue: 'Overdue',
      priority: 'Priority',
      project: 'Project',
      reset: 'Reset',
      show_subtasks: 'Show subtasks',
      status: 'Status',
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
    ...overrides,
  };
}

describe('KanbanToolbar', () => {
  function renderToolbar(filters: Filters, onChange = vi.fn()) {
    const rendered = render(
      <KanbanToolbar
        data={makeData()}
        filters={filters}
        onChange={onChange}
        sortKey="updated_desc"
        onChangeSort={vi.fn()}
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
        timeEntryOnClose={false}
        onToggleTimeEntryOnClose={vi.fn()}
        priorityLaneEnabled={false}
        onTogglePriorityLane={vi.fn()}
        viewableProjectsEnabled={false}
        onToggleViewableProjects={vi.fn()}
        onOpenHelp={vi.fn()}
      />,
    );
    return { onChange, ...rendered };
  }

  it('shows selection count for multi-assignee filters', () => {
    renderToolbar(makeFilters({ assigneeIds: ['unassigned', '7'] }));

    expect(screen.getByTitle('Unassigned, Alice').textContent).toContain('Assignee (2)');
  });

  it('updates assigneeIds when an assignee is selected', () => {
    const { onChange } = renderToolbar(makeFilters());

    fireEvent.click(screen.getByTitle('Assignee'));
    fireEvent.click(screen.getByText('Alice'));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ assigneeIds: ['7'] }));
  });

  it('resets assigneeIds to an empty selection', () => {
    const { container, onChange } = renderToolbar(makeFilters({ assigneeIds: ['7'] }));

    fireEvent.click(screen.getByTitle('Alice'));
    const resetButton = container.querySelector('.rk-dropdown-menu .rk-dropdown-link');
    if (!(resetButton instanceof HTMLButtonElement)) throw new Error('Reset button not found');
    fireEvent.click(resetButton);

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ assigneeIds: [] }));
  });
});
