import type { Filters } from '../view/types';

export type BoardFilterScope = {
  q: string;
  assignee_ids: number[];
  include_unassigned: boolean;
  tracker_ids: number[];
  priority_filter_enabled: boolean;
  priority_ids: number[];
  include_no_priority: boolean;
  due: Filters['due'];
  due_days?: number | null;
  date_anchor?: string | null;
};

export function hasActiveBoardFilterScope(scope: BoardFilterScope | undefined): boolean {
  return Boolean(scope && (scope.q || scope.assignee_ids.length || scope.include_unassigned
    || scope.tracker_ids.length || scope.priority_filter_enabled || scope.due !== 'all'));
}

const TIME_RELATIVE_DUE = new Set<Filters['due']>(['overdue', 'thisweek', '1day', '3days', '7days', 'custom']);

function positiveIds(values: Iterable<number>): number[] {
  return [...new Set(Array.from(values).filter((id) => Number.isSafeInteger(id) && id > 0))].sort((a, b) => a - b);
}

export function localDateAnchor(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function canonicalBoardFilterScope(scope: BoardFilterScope): BoardFilterScope {
  const dueDays = Number(scope.due_days);
  const result: BoardFilterScope = {
    q: String(scope.q ?? '').trim().toLowerCase(),
    assignee_ids: positiveIds(scope.assignee_ids ?? []),
    include_unassigned: Boolean(scope.include_unassigned),
    tracker_ids: positiveIds(scope.tracker_ids ?? []),
    priority_filter_enabled: Boolean(scope.priority_filter_enabled),
    priority_ids: scope.priority_filter_enabled ? positiveIds(scope.priority_ids ?? []) : [],
    include_no_priority: scope.priority_filter_enabled && Boolean(scope.include_no_priority),
    due: scope.due,
  };
  if (scope.due === 'custom' && Number.isSafeInteger(dueDays) && dueDays > 0) result.due_days = dueDays;
  if (TIME_RELATIVE_DUE.has(scope.due) && /^\d{4}-\d{2}-\d{2}$/.test(scope.date_anchor ?? '')) result.date_anchor = scope.date_anchor;
  return result;
}

export function boardFilterScopeFromFilters(filters: Filters, dateAnchor = localDateAnchor()): BoardFilterScope {
  const assignees = filters.assigneeIds.filter((id) => id !== 'unassigned').map(Number);
  const priorityIds = filters.priority.filter((id) => id !== 'no_priority').map(Number);
  return canonicalBoardFilterScope({
    q: filters.q,
    assignee_ids: assignees,
    include_unassigned: filters.assigneeIds.includes('unassigned'),
    tracker_ids: filters.trackerIds,
    priority_filter_enabled: filters.priorityFilterEnabled,
    priority_ids: priorityIds,
    include_no_priority: filters.priority.includes('no_priority'),
    due: filters.due,
    due_days: filters.due === 'custom' ? (filters.dueDays ?? 7) : filters.dueDays,
    date_anchor: dateAnchor,
  });
}

export function boardFilterScopeKey(scope: BoardFilterScope): string {
  return JSON.stringify(canonicalBoardFilterScope(scope));
}
