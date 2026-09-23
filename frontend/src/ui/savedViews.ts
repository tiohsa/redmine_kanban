import type { Filters } from './boardFilters';
import type { SortConfig } from './board/sort';
import type { LaneType } from './useKanbanPreferences';
import { buildProjectScopeFromDataUrl, makeScopedStorageKey } from './utils/storage';

export type SavedViewSettings = {
  filters: Filters;
  sortConfig: SortConfig;
  laneType: LaneType;
  hiddenStatusIds: number[];
  viewableProjectsEnabled: boolean;
};
export type SavedView = { id: string; name: string; settings: SavedViewSettings };
export type SavedViewsDocument = { version: 1; views: SavedView[] };
export const MAX_SAVED_VIEWS = 20;

export function savedViewsKey(dataUrl: string, userId: number): string {
  const url = new URL(dataUrl, window.location.origin);
  return makeScopedStorageKey('rk_saved_views', `${buildProjectScopeFromDataUrl(url.pathname)}:user:${userId}`);
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const ids = (value: unknown): value is number[] => Array.isArray(value) && value.every(id);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');
export function validViewSettings(value: unknown): value is SavedViewSettings {
  if (!record(value) || !record(value.filters)) return false;
  const f = value.filters;
  return strings(f.assigneeIds) && f.assigneeIds.every((v) => v === 'unassigned' || /^[1-9]\d*$/.test(v)) &&
    typeof f.q === 'string' && typeof f.due === 'string' && ['all', 'overdue', 'thisweek', '3days', '7days', '1day', 'custom', 'none'].includes(String(f.due)) &&
    (f.dueDays === undefined || id(f.dueDays)) && strings(f.priority) && f.priority.every((v) => v === 'no_priority' || /^[1-9]\d*$/.test(v)) &&
    typeof f.priorityFilterEnabled === 'boolean' && ids(f.projectIds) && ids(f.statusIds) && ids(f.trackerIds) &&
    typeof value.laneType === 'string' && ['none', 'assignee', 'priority', 'category'].includes(value.laneType) &&
    typeof value.viewableProjectsEnabled === 'boolean' && ids(value.hiddenStatusIds) &&
    Array.isArray(value.sortConfig) && value.sortConfig.length >= 1 && value.sortConfig.length <= 3 &&
    value.sortConfig.every((v) => record(v) && typeof v.field === 'string' && typeof v.direction === 'string' && ['due', 'priority', 'updated'].includes(v.field) && ['asc', 'desc'].includes(v.direction)) &&
    new Set(value.sortConfig.map((v) => v.field)).size === value.sortConfig.length;
}
// Pick only the supported settings, including when callers pass a wider object.
export function copyViewSettings(value: SavedViewSettings): SavedViewSettings {
  const f = value.filters;
  return {
    filters: { assigneeIds: [...f.assigneeIds], q: f.q, due: f.due, ...(f.dueDays === undefined ? {} : { dueDays: f.dueDays }), priority: [...f.priority], priorityFilterEnabled: f.priorityFilterEnabled, projectIds: [...f.projectIds], statusIds: [...f.statusIds], trackerIds: [...f.trackerIds] },
    sortConfig: value.sortConfig.map(({ field, direction }) => ({ field, direction })),
    laneType: value.laneType, hiddenStatusIds: [...value.hiddenStatusIds], viewableProjectsEnabled: value.viewableProjectsEnabled,
  };
}
export function parseSavedViews(raw: string | null): SavedViewsDocument {
  if (raw === null) return { version: 1, views: [] };
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.version !== 1 || !Array.isArray(value.views) || value.views.length > MAX_SAVED_VIEWS) throw new Error('saved_views_unreadable');
  const views: SavedView[] = [];
  for (const view of value.views) {
    if (!record(view) || typeof view.id !== 'string' || !view.id || typeof view.name !== 'string' || !view.name.trim() || view.name !== view.name.trim() || [...view.name].length > 80 || !validViewSettings(view.settings)) throw new Error('saved_views_unreadable');
    if (views.some((v) => v.id === view.id || v.name === view.name)) throw new Error('saved_views_unreadable');
    views.push({ id: view.id, name: view.name, settings: copyViewSettings(view.settings) });
  }
  return { version: 1, views };
}
export function validateViewName(name: string, views: SavedView[], exceptId?: string): string {
  const trimmed = name.trim();
  if ([...trimmed].length < 1 || [...trimmed].length > 80) throw new Error('saved_views_name_invalid');
  if (views.some((view) => view.id !== exceptId && view.name === trimmed)) throw new Error('saved_views_duplicate');
  return trimmed;
}
export function viewSettingsEqual(a: SavedViewSettings, b: SavedViewSettings): boolean {
  const canonical = (settings: SavedViewSettings) => {
    const v = copyViewSettings(settings);
    const sorted = <T extends string | number>(values: T[]) => [...new Set(values)].sort();
    v.filters.assigneeIds = sorted(v.filters.assigneeIds);
    v.filters.priority = sorted(v.filters.priority);
    v.filters.projectIds = sorted(v.filters.projectIds);
    v.filters.statusIds = sorted(v.filters.statusIds);
    v.filters.trackerIds = sorted(v.filters.trackerIds);
    v.filters.dueDays ??= 7;
    v.hiddenStatusIds = sorted(v.hiddenStatusIds);
    return JSON.stringify(v);
  };
  return canonical(a) === canonical(b);
}
