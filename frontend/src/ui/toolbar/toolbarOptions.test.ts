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

  it('keeps the project search text separate from the indented display name', () => {
    expect(buildToolbarOptions(data, filters, false).projectOptions).toEqual([
      { id: '1', name: 'Project A', searchText: 'Project A' },
    ]);
    expect(buildToolbarOptions(data, filters, true).projectOptions).toEqual([
      { id: '2', name: '\xA0\xA0Project B', searchText: 'Project B' },
    ]);
  });
});
