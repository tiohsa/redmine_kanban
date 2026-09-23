import type { Filters } from './types';

export const DEFAULT_MAXIMUM_BOARD_ENTITY_COUNT = 1500;
export const MAXIMUM_BOARD_ENTITY_COUNT = 2_147_483_647;

export function parseMaximumBoardEntityCount(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return DEFAULT_MAXIMUM_BOARD_ENTITY_COUNT;
  const raw = String(value).trim();
  if (raw === '') return DEFAULT_MAXIMUM_BOARD_ENTITY_COUNT;
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAXIMUM_BOARD_ENTITY_COUNT) return null;
  return parsed;
}

export function normalizeMaximumBoardEntityCount(value: string | number | null | undefined): number {
  return parseMaximumBoardEntityCount(value) ?? DEFAULT_MAXIMUM_BOARD_ENTITY_COUNT;
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
