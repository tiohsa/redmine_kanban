import type { Column, Issue, Lists, Subtask } from '../board/types';

export type TrackerCatalog = ReadonlyMap<number, string>;

export function normalizeTrackerId(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

export function buildTrackerCatalog(trackers: Lists['trackers']): TrackerCatalog {
  const catalog = new Map<number, string>();
  for (const tracker of trackers ?? []) {
    if (normalizeTrackerId(tracker.id) === null) continue;
    if (!tracker.name.trim() || catalog.has(tracker.id)) continue;
    catalog.set(tracker.id, tracker.name);
  }
  return catalog;
}

export function resolveTrackerName(catalog: TrackerCatalog, trackerId: number | null | undefined): string | null {
  const normalizedTrackerId = normalizeTrackerId(trackerId);
  if (normalizedTrackerId === null) return null;
  return catalog.get(normalizedTrackerId) ?? null;
}

export function resolveClosedState(issue: Pick<Issue, 'is_closed' | 'status_is_closed' | 'status_id'> | Pick<Subtask, 'is_closed' | 'status_is_closed' | 'status_id'>, columns?: Column[]): boolean {
  return issue.is_closed ?? issue.status_is_closed ?? columns?.find((column) => column.id === issue.status_id)?.is_closed ?? false;
}
