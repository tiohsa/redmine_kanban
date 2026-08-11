import type { BoardData, Column, Issue } from './types';
import { flattenIssueTree, nestedIssueIds } from './boardTree';

export type Filters = {
  assigneeIds: string[];
  q: string;
  due: 'all' | 'overdue' | 'thisweek' | '3days' | '7days' | '1day' | 'custom' | 'none';
  dueDays?: number;
  priority: string[];
  priorityFilterEnabled: boolean;
  projectIds: number[];
  statusIds: number[];
  trackerIds: number[];
};

export type BoardPresentationProjection = {
  columns: Column[];
  issues: Issue[];
};

export function applyBoardDataFilters(
  displayData: BoardData | null,
  showSubtasks: boolean,
  statusIds: number[],
  trackerIds: number[] = [],
): BoardData | null {
  if (!displayData) return null;

  let result = displayData;
  if (showSubtasks) {
    const loadedNestedIds = nestedIssueIds(result.issues);
    result = {
      ...result,
      // A child root is removed only when the current parent tree contains it.
      issues: result.issues.filter((issue) => !loadedNestedIds.has(issue.id)),
    };
  } else {
    result = {
      ...result,
      // Keep the displayed Issue collection stable when nested rows are rendered as cards.
      issues: flattenIssueTree(result.issues),
    };
  }
  result = { ...result, columns: buildPrimaryColumns(result, trackerIds, statusIds) };
  return result;
}

export function buildPrimaryColumns(data: BoardData, selectedTrackerIds: number[], statusIds: number[]): Column[] {
  const statusFilter = new Set(statusIds);
  const catalog = new Map(data.lists.trackers.map((tracker) => [tracker.id, tracker]));
  let trackerStatusIds: Set<number> | null = null;

  if (selectedTrackerIds.length > 0) {
    const selectedTrackers = selectedTrackerIds.map((trackerId) => catalog.get(trackerId));
    const metadataComplete = selectedTrackers.every((tracker) => (
      tracker !== undefined && Array.isArray(tracker.workflow_status_ids)
    ));

    if (metadataComplete) {
      const validStatusIds = new Set(data.columns.map((column) => column.id));
      const selectedStatusIds = new Set<number>();
      for (const tracker of selectedTrackers) {
        for (const statusId of tracker!.workflow_status_ids ?? []) {
          if (validStatusIds.has(statusId)) selectedStatusIds.add(statusId);
        }
        const defaultStatusId = tracker!.default_status_id;
        if (defaultStatusId !== null && defaultStatusId !== undefined && validStatusIds.has(defaultStatusId)) {
          selectedStatusIds.add(defaultStatusId);
        }
      }
      if (selectedStatusIds.size > 0) trackerStatusIds = selectedStatusIds;
    }
  }

  return data.columns.filter((column) => (
    (!trackerStatusIds || trackerStatusIds.has(column.id))
    && (statusFilter.size === 0 || statusFilter.has(column.id))
  ));
}

export function withContextColumns(
  data: BoardData,
  primaryColumns: Column[],
  rootIssues: Issue[],
  statusIds: number[] = [],
  hiddenStatusIds: ReadonlySet<number> = new Set(),
): Column[] {
  const primaryStatusIds = new Set(primaryColumns.map((column) => column.id));
  const requiredRootStatusIds = new Set(rootIssues.map((issue) => issue.status_id));
  const statusFilter = new Set(statusIds);
  return data.columns.filter((column) => (
    (primaryStatusIds.has(column.id) || (requiredRootStatusIds.has(column.id) && !hiddenStatusIds.has(column.id)))
    && (statusFilter.size === 0 || statusFilter.has(column.id))
  ));
}

export function buildPresentationProjection(
  data: BoardData,
  primaryColumns: Column[],
  rootIssues: Issue[],
  statusIds: number[] = [],
  hiddenStatusIds: ReadonlySet<number> = new Set(),
): BoardPresentationProjection {
  const columns = withContextColumns(data, primaryColumns, rootIssues, statusIds, hiddenStatusIds);
  const renderedColumnIds = new Set(
    columns.filter((column) => !hiddenStatusIds.has(column.id)).map((column) => column.id),
  );

  return {
    columns,
    issues: projectPresentationRoots(rootIssues, renderedColumnIds),
  };
}

export function projectPresentationRoots(rootIssues: Issue[], renderedColumnIds: ReadonlySet<number>): Issue[] {
  const roots: Issue[] = [];
  const seenRootIds = new Set<number>();

  const visit = (issue: Issue) => {
    if (renderedColumnIds.has(issue.status_id)) {
      if (!seenRootIds.has(issue.id)) {
        seenRootIds.add(issue.id);
        roots.push(issue);
      }
      return;
    }

    for (const child of issue.subtasks ?? []) {
      visit(child as Issue);
    }
  };

  for (const issue of rootIssues) visit(issue);
  return roots;
}

export function resolvePreferredTrackerId(
  data: BoardData,
  selectedTrackerIds: number[],
  targetProjectId: number | undefined,
): number | undefined {
  if (!targetProjectId || selectedTrackerIds.length !== 1) return undefined;
  const tracker = data.lists.trackers.find((candidate) => candidate.id === selectedTrackerIds[0]);
  if (!tracker || !Array.isArray(tracker.available_project_ids)) return undefined;
  return tracker.available_project_ids.includes(targetProjectId) ? tracker.id : undefined;
}

export function defaultCreateStatusId(columns: Column[], preferredStatusId?: number): number | undefined {
  if (preferredStatusId !== undefined && columns.some((column) => column.id === preferredStatusId)) {
    return preferredStatusId;
  }
  return columns.find((column) => !column.is_closed)?.id ?? columns[0]?.id;
}

export function resolveCreateStatusId(
  data: BoardData,
  candidateColumns: Column[],
  selectedTrackerIds: number[],
  targetProjectId: number | undefined,
): number | undefined {
  const preferredTrackerId = resolvePreferredTrackerId(data, selectedTrackerIds, targetProjectId);
  const preferredStatusId = preferredTrackerId === undefined
    ? undefined
    : data.lists.trackers.find((tracker) => tracker.id === preferredTrackerId)?.default_status_id ?? undefined;
  return defaultCreateStatusId(candidateColumns, preferredStatusId);
}

export function buildVisibleIssues(
  filteredData: BoardData | null,
  filters: Filters,
  hiddenStatusIds: Set<number>,
  pendingDeleteIssue: Issue | null,
): Issue[] {
  let visible = filterIssues(filteredData?.issues ?? [], filteredData, filters)
    .filter((issue) => !hiddenStatusIds.has(issue.status_id) || hasVisibleDescendant(issue, hiddenStatusIds));

  if (pendingDeleteIssue) {
    visible = visible.filter((issue) => issue.id !== pendingDeleteIssue.id);
  }

  return visible;
}

function hasVisibleDescendant(issue: Issue, hiddenStatusIds: ReadonlySet<number>): boolean {
  return (issue.subtasks ?? []).some((child) => (
    !hiddenStatusIds.has(child.status_id) || hasVisibleDescendant(child as Issue, hiddenStatusIds)
  ));
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

  return issues.flatMap((issue) => {
    const filteredSubtasks = filterSubtasks(issue.subtasks, filters);
    const matchesSelf = matchesIssue(issue, data, filters, q, now0, start, end);
    if (!matchesSelf && filteredSubtasks.length === 0) return [];
    return [{ ...issue, subtasks: filteredSubtasks }];
  });
}

function filterSubtasks(subtasks: Issue['subtasks'], filters: Filters): NonNullable<Issue['subtasks']> {
  return (subtasks ?? []).flatMap((subtask) => {
    const child = subtask as unknown as Issue;
    const nested = filterSubtasks(child.subtasks, filters);
    const now = new Date();
    const now0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const matchesSelf = matchesIssue(child, null, filters, filters.q.trim().toLowerCase(), now0, startOfWeek(now), endOfWeek(now));
    if (!matchesSelf && nested.length === 0) return [];
    return [{ ...subtask, subtasks: nested }];
  });
}

function matchesIssue(issue: Issue, _data: BoardData | null, filters: Filters, q: string, now0: Date, start: Date, end: Date): boolean {
    if (q && !issue.subject.toLowerCase().includes(q)) return false;

    if (filters.statusIds.length > 0 && !filters.statusIds.includes(issue.status_id)) return false;

    if (filters.projectIds.length > 0) {
      const projectId = issue.project?.id ?? _data?.meta.project_id;
      if (projectId === undefined || !filters.projectIds.includes(projectId)) return false;
    }

    if (filters.assigneeIds.length > 0) {
      const matchesAssignee = filters.assigneeIds.some((assigneeId) => {
        if (assigneeId === 'unassigned') return issue.assigned_to_id === null;
        return String(issue.assigned_to_id) === assigneeId;
      });
      if (!matchesAssignee) {
        return false;
      }
    }

    if (filters.trackerIds.length > 0 && (issue.tracker_id === null || !filters.trackerIds.includes(issue.tracker_id))) return false;

    if (filters.priorityFilterEnabled) {
      if (filters.priority.length === 0) return false;
      const matchesPriority = filters.priority.some((priorityId) => {
        if (priorityId === 'no_priority') return issue.priority_id === null;
        return String(issue.priority_id) === priorityId;
      });
      if (!matchesPriority) return false;
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
}

function parseISODate(dateString: string): Date | null {
  const parts = dateString.split('-');
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map((x) => Number(x));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
