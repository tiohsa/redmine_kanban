import type { BoardData, BoardMetadata } from '../board/types';
import type { SavedViewSettings } from './savedViews';

export type ViewValidation = { pending: boolean; unavailable: string[] };
export function validateViewReferences(settings: SavedViewSettings, metadata: BoardMetadata | null, data: BoardData | null, labels: Record<string, string>): ViewValidation {
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
  check(f.assigneeIds.filter((id) => id !== 'unassigned'), data?.lists.assignees.filter((a) => a.id !== null).map((a) => String(a.id)), labels.assignee);
  check(f.trackerIds, data?.lists.trackers.map((t) => t.id), labels.issue_tracker);
  check(f.priority, data?.lists.priorities.map((p) => String(p.id)).concat('no_priority'), labels.issue_priority);
  return { pending, unavailable };
}
