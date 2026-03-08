import type { BoardData, Issue } from './types';

export type Filters = {
  assignee: 'all' | 'me' | 'unassigned' | string;
  q: string;
  due: 'all' | 'overdue' | 'thisweek' | '3days' | '7days' | '1day' | 'custom' | 'none';
  dueDays?: number;
  priority: string[];
  priorityFilterEnabled: boolean;
  projectIds: number[];
  statusIds: number[];
};

export function applyBoardDataFilters(
  displayData: BoardData | null,
  showSubtasks: boolean,
  statusIds: number[],
): BoardData | null {
  if (!displayData) return null;

  let result = displayData;
  if (!showSubtasks) {
    result = {
      ...result,
      issues: result.issues.filter((issue) => !issue.parent_id),
    };
  }
  if (statusIds.length > 0) {
    result = {
      ...result,
      columns: result.columns.filter((column) => statusIds.includes(column.id)),
    };
  }
  return result;
}

export function buildVisibleIssues(
  filteredData: BoardData | null,
  filters: Filters,
  hiddenStatusIds: Set<number>,
  pendingDeleteIssue: Issue | null,
): Issue[] {
  let visible = filterIssues(filteredData?.issues ?? [], filteredData, filters);
  visible = visible.filter((issue) => !hiddenStatusIds.has(issue.status_id));

  if (pendingDeleteIssue) {
    visible = visible.filter((issue) => issue.id !== pendingDeleteIssue.id);
  }

  return visible;
}

function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfWeek(date: Date): Date {
  const s = startOfWeek(date);
  const e = new Date(s);
  e.setDate(e.getDate() + 7);
  e.setMilliseconds(e.getMilliseconds() - 1);
  return e;
}

function filterIssues(issues: Issue[], data: BoardData | null, filters: Filters): Issue[] {
  const q = filters.q.trim().toLowerCase();
  const now = new Date();
  const now0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = startOfWeek(now);
  const end = endOfWeek(now);

  return issues.filter((issue) => {
    if (q && !issue.subject.toLowerCase().includes(q)) return false;

    if (filters.assignee !== 'all') {
      if (filters.assignee === 'me') {
        if (String(issue.assigned_to_id) !== String(data?.meta.current_user_id)) return false;
      } else if (filters.assignee === 'unassigned') {
        if (issue.assigned_to_id !== null) return false;
      } else if (String(issue.assigned_to_id) !== String(filters.assignee)) {
        return false;
      }
    }

    if (filters.priorityFilterEnabled) {
      if (filters.priority.length === 0) return false;
      if (!filters.priority.includes(String(issue.priority_id))) return false;
    }

    if (filters.due !== 'all') {
      if (!issue.due_date) return filters.due === 'none';
      if (filters.due === 'none') return false;

      const due = parseISODate(issue.due_date);
      if (!due) return false;

      if (filters.due === 'overdue') return due < now0;
      if (filters.due === 'thisweek') return due >= start && due <= end;

      if (filters.due === '3days') {
        const limit = new Date(now0);
        limit.setDate(now0.getDate() + 3);
        return due >= now0 && due < limit;
      }

      if (filters.due === '7days') {
        const limit = new Date(now0);
        limit.setDate(now0.getDate() + 7);
        return due >= now0 && due < limit;
      }

      if (filters.due === '1day') {
        const limit = new Date(now0);
        limit.setDate(now0.getDate() + 1);
        return due >= now0 && due < limit;
      }

      if (filters.due === 'custom') {
        const limit = new Date(now0);
        limit.setDate(now0.getDate() + (filters.dueDays ?? 7));
        return due >= now0 && due < limit;
      }
    }

    return true;
  });
}

function parseISODate(dateString: string): Date | null {
  const parts = dateString.split('-');
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map((x) => Number(x));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
