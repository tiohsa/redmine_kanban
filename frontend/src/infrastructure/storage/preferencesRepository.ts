import type { Filters } from '../../model/view/types';
import { DEFAULT_FILTERS } from '../../model/view/preferences';
import { readScopedValueWithLegacy } from './scopedStorage';

export function readStorageValue(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorageValue(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export function removeStorageValue(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function readFilters(storageKey: string | null, legacyKey?: string): Filters {
  try {
    const value = storageKey && legacyKey ? readScopedValueWithLegacy(storageKey, legacyKey) : null;
    if (value) {
      const parsed = JSON.parse(value);
      return {
        assigneeIds: Array.isArray(parsed.assigneeIds) ? parsed.assigneeIds.map(String) : [],
        q: parsed.q || '',
        due: parsed.due || 'all',
        dueDays: parsed.dueDays || 7,
        priority: Array.isArray(parsed.priority) ? parsed.priority : [],
        priorityFilterEnabled:
          typeof parsed.priorityFilterEnabled === 'boolean'
            ? parsed.priorityFilterEnabled
            : Array.isArray(parsed.priority) && parsed.priority.length > 0,
        projectIds: Array.isArray(parsed.projectIds) ? parsed.projectIds.map(Number) : [],
        statusIds: Array.isArray(parsed.statusIds) ? parsed.statusIds.map(Number) : [],
        trackerIds: Array.isArray(parsed.trackerIds) ? parsed.trackerIds.map(Number) : [],
      };
    }
  } catch {
    // ignore
  }
  return DEFAULT_FILTERS;
}
