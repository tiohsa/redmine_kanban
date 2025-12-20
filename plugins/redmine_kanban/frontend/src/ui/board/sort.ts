import type { Issue } from '../types';

export type SortKey =
  | 'updated_desc'
  | 'updated_asc'
  | 'due_asc'
  | 'due_desc'
  | 'priority_desc'
  | 'priority_asc';

export function sortIssues(issues: Issue[], sortKey: SortKey, priorityRank: Map<number, number>) {
  const arr = [...issues];
  const cmp = buildIssueComparator(sortKey, priorityRank);
  arr.sort(cmp);
  return arr;
}

export function buildIssueComparator(sortKey: SortKey, priorityRank: Map<number, number>) {
  const dueTime = (it: Issue) => {
    const v = it.due_date;
    if (!v) return null;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  };

  const updatedTime = (it: Issue) => {
    const v = it.updated_on;
    if (!v) return null;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  };

  const priority = (it: Issue) => {
    const id = it.priority_id;
    if (!id) return null;
    const r = priorityRank.get(id);
    return typeof r === 'number' ? r : null;
  };

  const nullsLast = (a: number | null, b: number | null, dir: 'asc' | 'desc') => {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return dir === 'asc' ? a - b : b - a;
  };

  const tie = (a: Issue, b: Issue) => a.id - b.id;

  switch (sortKey) {
    case 'due_asc':
      return (a: Issue, b: Issue) => nullsLast(dueTime(a), dueTime(b), 'asc') || tie(a, b);
    case 'due_desc':
      return (a: Issue, b: Issue) => nullsLast(dueTime(a), dueTime(b), 'desc') || tie(a, b);
    case 'priority_asc':
      return (a: Issue, b: Issue) => nullsLast(priority(a), priority(b), 'asc') || tie(a, b);
    case 'priority_desc':
      return (a: Issue, b: Issue) => nullsLast(priority(a), priority(b), 'desc') || tie(a, b);
    case 'updated_asc':
      return (a: Issue, b: Issue) => nullsLast(updatedTime(a), updatedTime(b), 'asc') || tie(a, b);
    case 'updated_desc':
    default:
      return (a: Issue, b: Issue) => nullsLast(updatedTime(a), updatedTime(b), 'desc') || tie(a, b);
  }
}
