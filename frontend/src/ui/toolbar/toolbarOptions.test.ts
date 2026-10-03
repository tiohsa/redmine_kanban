import type { BoardData } from '../types';
import type { Filters } from '../boardFilters';
import { describe, expect, it } from 'vitest';
import { buildToolbarOptions, togglePriorityFilter } from './toolbarOptions';

describe('togglePriorityFilter', () => {
  it('normalizes selecting all priority options to a disabled filter', () => {
    expect(togglePriorityFilter(['1', '2'], 2)).toEqual({
      priority: [],
      priorityFilterEnabled: false,
    });
  });

  it('preserves a partial selection as an enabled filter', () => {
    expect(togglePriorityFilter(['2'], 2)).toEqual({
      priority: ['2'],
      priorityFilterEnabled: true,
    });
  });
});

describe('buildToolbarOptions', () => {
  const filters: Filters = {
    assigneeIds: [],
    q: '',
    due: 'all',
    priority: [],
    priorityFilterEnabled: false,
    projectIds: [],
    statusIds: [],
    trackerIds: [],
  };
  const data = {
    labels: { all: 'All' },
    columns: [],
    lists: {
      assignees: [],
      trackers: [],
      priorities: [],
      projects: [{ id: 1, name: 'Project A', level: 0 }],
      viewable_projects: [{ id: 2, name: 'Project B', level: 1 }],
      creatable_projects: [],
    },
  } as unknown as BoardData;
  const filterOptions = {
    assignees: [{ id: 5, name: 'Assignee', available_project_ids: [1, 2] }],
    trackers: [{ id: 8, name: 'Tracker', available_project_ids: [2] }],
    priorities: [{ id: 3, name: 'High' }],
  };

  it('keeps the project search text separate from the indented display name', () => {
    expect(buildToolbarOptions(data, filters, false, filterOptions).projectOptions).toEqual([
      { id: '1', name: 'Project A', searchText: 'Project A' },
    ]);
    expect(buildToolbarOptions(data, filters, true, filterOptions).projectOptions).toEqual([
      { id: '2', name: '\xA0\xA0Project B', searchText: 'Project B' },
    ]);
  });

  it('projects metadata filter candidates to the active project scope', () => {
    const options = buildToolbarOptions(data, { ...filters, projectIds: [1] }, false, filterOptions);
    expect(options.assigneeOptions).toEqual([{ id: 'unassigned', name: undefined }, { id: '5', name: 'Assignee' }]);
    expect(options.trackerOptions).toEqual([]);
    expect(options.priorityOptions).toEqual([{ id: '3', name: 'High' }, { id: 'no_priority', name: undefined }]);
  });
});
