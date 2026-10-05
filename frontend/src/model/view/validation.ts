import type { BoardMetadata, FilterOptionsState } from '../board/types';
import type { SavedViewSettings } from './savedViews';

export type ViewValidation = { pending: boolean; unavailable: string[] };
export function validateViewReferences(settings: SavedViewSettings, metadata: BoardMetadata | null, labels: Record<string, string>, filterOptionsState?: FilterOptionsState): ViewValidation {
  const unavailable: string[] = [];
  let pending = false;
  const check = <T extends string | number>(selected: T[], available: T[] | undefined, label: string) => {
    if (!selected.length) return;
    if (!available) { pending = true; return; }
    const allowed = new Set(available);
    const missing = selected.filter((id) => !allowed.has(id));
    if (missing.length) unavailable.push(`${label}: ${missing.join(', ')}`);
  };
  const { filters: f } = settings;
  check(f.projectIds, metadata ? (settings.viewableProjectsEnabled ? metadata.viewable_projects : metadata.projects).map((p) => p.id) : undefined, labels.project);
  check(f.statusIds, metadata?.statuses.map((s) => s.id), labels.status);
  check(settings.hiddenStatusIds, metadata?.statuses.map((s) => s.id), labels.hidden_statuses);
  const candidatesAvailable = filterOptionsState?.state === 'complete'
    ? filterOptionsState.options
    : filterOptionsState
      ? undefined
      : metadata?.filter_options_complete ? metadata.filter_options : undefined;
  check(f.assigneeIds.filter((id) => id !== 'unassigned'), candidatesAvailable?.assignees.map((a) => String(a.id)), labels.assignee);
  check(f.trackerIds, candidatesAvailable?.trackers.map((t) => t.id), labels.issue_tracker);
  check(f.priority, candidatesAvailable?.priorities.map((p) => String(p.id)).concat('no_priority'), labels.issue_priority);
  return { pending, unavailable };
}
