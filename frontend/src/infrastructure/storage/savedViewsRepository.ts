import { parseSavedViews, type SavedView } from '../../model/view/savedViews';
import { buildProjectScopeFromDataUrl, makeScopedStorageKey } from './scopedStorage';

export function savedViewsKey(dataUrl: string, userId: number): string {
  const url = new URL(dataUrl, window.location.origin);
  return makeScopedStorageKey('rk_saved_views', `${buildProjectScopeFromDataUrl(url.pathname)}:user:${userId}`);
}

export function readSavedViews(key: string): { views: SavedView[]; error: string | null } {
  try { return { views: parseSavedViews(localStorage.getItem(key)).views, error: null }; }
  catch { return { views: [], error: 'saved_views_unreadable' }; }
}

export function writeSavedViews<T>(key: string, update: (views: SavedView[]) => { views: SavedView[]; result: T }): { views: SavedView[]; result: T } {
  // Keep the read and final document validation adjacent to the write.
  const latest = parseSavedViews(localStorage.getItem(key));
  const next = update(latest.views);
  const serialized = JSON.stringify({ version: 1, views: next.views });
  const validated = parseSavedViews(serialized);
  localStorage.setItem(key, serialized);
  return { views: validated.views, result: next.result };
}

export function newSavedViewCandidateId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `view_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
