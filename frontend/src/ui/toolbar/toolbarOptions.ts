import type { Filters } from '../boardFilters';
import type { BoardData } from '../types';

type ToolbarOption = { id: string; name: string };

export function buildToolbarOptions(
  data: BoardData,
  filters: Filters,
  viewableProjectsEnabled: boolean,
) {
  const labels = data.labels;
  const projects = (viewableProjectsEnabled ? data.lists.viewable_projects : data.lists.projects) ?? [];
  const assigneeOptions: ToolbarOption[] = [
    { id: 'unassigned', name: labels.unassigned },
    ...(data.lists.assignees ?? [])
      .filter((assignee) => assignee.id !== null)
      .map((assignee) => ({ id: String(assignee.id), name: assignee.name })),
  ];
  const dueOptions = [
    { id: 'all', name: labels.all },
    { id: 'overdue', name: labels.overdue },
    { id: 'thisweek', name: labels.this_week },
    { id: '3days', name: labels.within_3_days },
    { id: '7days', name: labels.within_1_week },
    { id: '1day', name: labels.within_1_day },
    { id: 'custom', name: labels.within_specified_days },
    { id: 'none', name: labels.not_set },
  ] satisfies Array<{ id: Filters['due']; name: string }>;
  const priorityOptions: ToolbarOption[] = [
    ...(data.lists.priorities ?? []).map((priority) => ({ id: String(priority.id), name: priority.name })),
    { id: 'no_priority', name: labels.not_set },
  ];

  return {
    assigneeOptions,
    dueOptions,
    priorityOptions,
    priorityValue: filters.priorityFilterEnabled ? filters.priority : priorityOptions.map((option) => option.id),
    projectOptions: projects.map((project) => ({
      id: String(project.id),
      name: '\xA0'.repeat(project.level * 2) + project.name,
    })),
    statusOptions: data.columns.map((column) => ({ id: String(column.id), name: column.name })),
    trackerOptions: (data.lists.trackers ?? []).map((tracker) => ({ id: String(tracker.id), name: tracker.name })),
  };
}

export function togglePriorityFilter(selectedIds: string[], optionCount: number): Pick<Filters, 'priority' | 'priorityFilterEnabled'> {
  const priorityFilterEnabled = selectedIds.length !== optionCount;
  return {
    priority: priorityFilterEnabled ? selectedIds : [],
    priorityFilterEnabled,
  };
}
