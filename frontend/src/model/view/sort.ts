import type { Issue } from '../board/types';
import type { SortConfig, SortCriterion, SortDirection, SortField } from './types';
export type { SortConfig, SortCriterion, SortDirection, SortField } from './types';

export const DEFAULT_SORT_CONFIG: SortConfig = [
  { field: 'updated', direction: 'desc' },
];

const LEGACY_SORT_CONFIGS: Record<string, SortCriterion> = {
  due_asc: { field: 'due', direction: 'asc' },
  due_desc: { field: 'due', direction: 'desc' },
  priority_asc: { field: 'priority', direction: 'asc' },
  priority_desc: { field: 'priority', direction: 'desc' },
  updated_asc: { field: 'updated', direction: 'asc' },
  updated_desc: { field: 'updated', direction: 'desc' },
};

const SORT_FIELDS = new Set<SortField>(['due', 'priority', 'updated']);
const SORT_DIRECTIONS = new Set<SortDirection>(['asc', 'desc']);

export function cloneSortConfig(config: SortConfig = DEFAULT_SORT_CONFIG): SortConfig {
  return config.map((criterion) => ({ ...criterion }));
}

export function normalizeSortConfig(value: unknown): SortConfig {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    return cloneSortConfig();
  }

  const fields = new Set<SortField>();
  const config: SortConfig = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return cloneSortConfig();
    const criterion = item as { field?: unknown; direction?: unknown };
    if (!SORT_FIELDS.has(criterion.field as SortField) || !SORT_DIRECTIONS.has(criterion.direction as SortDirection)) {
      return cloneSortConfig();
    }

    const field = criterion.field as SortField;
    if (fields.has(field)) return cloneSortConfig();
    fields.add(field);
    config.push({ field, direction: criterion.direction as SortDirection });
  }

  return config;
}

export function parseSortConfig(value: string | null | undefined): SortConfig {
  if (!value) return cloneSortConfig();

  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === 'string') {
      return cloneSortConfig(LEGACY_SORT_CONFIGS[parsed] ? [LEGACY_SORT_CONFIGS[parsed]] : DEFAULT_SORT_CONFIG);
    }
    return normalizeSortConfig(parsed);
  } catch {
    const legacy = LEGACY_SORT_CONFIGS[value];
    return cloneSortConfig(legacy ? [legacy] : DEFAULT_SORT_CONFIG);
  }
}

export function serializeSortConfig(config: SortConfig): string {
  return JSON.stringify(normalizeSortConfig(config));
}

export function sortIssues(issues: Issue[], sortConfig: SortConfig, priorityRank: Map<number, number>) {
  const arr = [...issues];
  const cmp = buildIssueComparator(sortConfig, priorityRank);
  arr.sort(cmp);
  return arr;
}

function parseComparableDate(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function priorityValue(issue: Issue, priorityRank: Map<number, number>): number | null {
  const id = issue.priority_id;
  if (id === null || id === undefined) return null;
  const rank = priorityRank.get(id);
  return typeof rank === 'number' && Number.isFinite(rank) ? rank : null;
}

function criterionValue(issue: Issue, field: SortField, priorityRank: Map<number, number>): number | null {
  switch (field) {
    case 'due':
      return parseComparableDate(issue.due_date);
    case 'priority':
      return priorityValue(issue, priorityRank);
    case 'updated':
      return parseComparableDate(issue.updated_on);
  }
}

function compareNullable(a: number | null, b: number | null, direction: SortDirection): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction === 'asc' ? a - b : b - a;
}

export function buildIssueComparator(sortConfig: SortConfig, priorityRank: Map<number, number>) {
  const normalizedConfig = normalizeSortConfig(sortConfig);
  return (a: Issue, b: Issue) => {
    for (const criterion of normalizedConfig) {
      const result = compareNullable(
        criterionValue(a, criterion.field, priorityRank),
        criterionValue(b, criterion.field, priorityRank),
        criterion.direction,
      );
      if (result !== 0) return result;
    }
    return a.id - b.id;
  };
}
