import type { Filters, KanbanColorTheme } from './types';

export const DEFAULT_COLOR_THEME: KanbanColorTheme = 'light';

export function parseColorTheme(value: string | null): KanbanColorTheme {
  return value === 'dark' ? 'dark' : 'light';
}

export function restoreAgingDays(value: string | null, fallback: number): number {
  if (value === null || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export const DEFAULT_FILTERS: Filters = {
  assigneeIds: [],
  q: '',
  due: 'all',
  priority: [],
  priorityFilterEnabled: false,
  projectIds: [],
  statusIds: [],
  trackerIds: [],
};
