import { TIMER_SESSION_VERSION, timerId } from './timerDomain';
import type { TimerSession } from './timerTypes';
export type TimerScope = { instanceKey: string; userId: number };
const sessionBase = 'redmine_canvas_gantt_timer_session'; const prefsBase = 'redmine_canvas_gantt_timer_preferences'; const tabBase = 'redmine_canvas_gantt_timer_tab_id';
const suffix = (scope: TimerScope) => `${encodeURIComponent(scope.instanceKey)}:user:${scope.userId}`;
export const keysFor = (scope: TimerScope) => ({ session: `${sessionBase}:${suffix(scope)}`, preferences: `${prefsBase}:${suffix(scope)}`, lock: `redmine_canvas_gantt_timer_lock:${suffix(scope)}` });
export function getTabId() { try { const old = sessionStorage.getItem(tabBase); if (old) return old; const next = timerId(); sessionStorage.setItem(tabBase, next); return next; } catch { return `kanban-${timerId()}`; } }
export function isTimerSession(value: unknown): value is TimerSession { const x = value as Partial<TimerSession> | null; return !!x && x.version === TIMER_SESSION_VERSION && typeof x.sessionId === 'string' && x.sessionId.trim().length > 0 && Number.isInteger(x.revision) && (x.revision ?? 0) > 0 && x.issueId !== undefined && x.issueId !== null && x.issueId !== '' && typeof x.subject === 'string' && typeof x.autoStop === 'boolean' && typeof x.createdAt === 'number' && Number.isFinite(x.createdAt) && typeof x.updatedAt === 'number' && Number.isFinite(x.updatedAt) && (x.userId === undefined || (typeof x.userId === 'number' && Number.isFinite(x.userId))) && Array.isArray(x.segments) && x.segments.length > 0 && x.segments.every(segment => typeof segment?.startedAt === 'number' && Number.isFinite(segment.startedAt) && segment.startedAt > 0 && (segment.stoppedAt === undefined || (typeof segment.stoppedAt === 'number' && Number.isFinite(segment.stoppedAt) && segment.stoppedAt >= segment.startedAt))) && ['running', 'expired', 'stopped_pending_record'].includes(String(x.state)) && (x.deadlineAt === undefined || (typeof x.deadlineAt === 'number' && Number.isFinite(x.deadlineAt))) && (x.notifiedDeadlineAt === undefined || (typeof x.notifiedDeadlineAt === 'number' && Number.isFinite(x.notifiedDeadlineAt))) && (x.notifiedType === undefined || ['running_expired', 'stopped'].includes(x.notifiedType)) && (!x.recordingAttempt || (x.state === 'stopped_pending_record' && typeof x.recordingAttempt.id === 'string' && x.recordingAttempt.id.trim().length > 0 && typeof x.recordingAttempt.ownerTabId === 'string' && x.recordingAttempt.ownerTabId.trim().length > 0 && typeof x.recordingAttempt.openedAt === 'number' && Number.isFinite(x.recordingAttempt.openedAt) && ['editing', 'submitting', 'unknown'].includes(x.recordingAttempt.phase))); }
function migrate(value: unknown): TimerSession | null { if (isTimerSession(value)) return value; const x = value as Partial<TimerSession> & { recordingAttemptId?: unknown } | null; if (!x || ![2, 3, TIMER_SESSION_VERSION].includes(x.version ?? 0)) return null; const base = { ...x, version: TIMER_SESSION_VERSION }; delete base.recordingAttempt; delete base.recordingAttemptId; if (x.state !== 'stopped_pending_record') return isTimerSession(base) ? base : null; const legacy = x.recordingAttempt as Partial<TimerSession['recordingAttempt']> | undefined; if (typeof x.recordingAttemptId === 'string' && x.recordingAttemptId.trim()) base.recordingAttempt = { id: x.recordingAttemptId, ownerTabId: 'legacy-timer-tab', openedAt: x.updatedAt!, phase: 'unknown' }; else if (legacy && typeof legacy.id === 'string' && typeof legacy.openedAt === 'number' && ['editing', 'submitting', 'unknown'].includes(String(legacy.phase))) base.recordingAttempt = { id: legacy.id, ownerTabId: typeof legacy.ownerTabId === 'string' && legacy.ownerTabId.trim() ? legacy.ownerTabId : 'legacy-timer-tab', openedAt: legacy.openedAt, phase: legacy.phase! }; return isTimerSession(base) ? base : null; }
export function load(scope: TimerScope): TimerSession | null { try { const raw = localStorage.getItem(keysFor(scope).session); const value = raw ? migrate(JSON.parse(raw)) : null; return value && (value.userId === undefined || value.userId === scope.userId) ? value : null; } catch { return null; } }
export function loadPreferences(scope: TimerScope): { autoStop: boolean } { try { const raw = localStorage.getItem(keysFor(scope).preferences); const value = raw ? JSON.parse(raw) as { autoStop?: unknown } : null; return typeof value?.autoStop === 'boolean' ? { autoStop: value.autoStop } : { autoStop: false }; } catch { return { autoStop: false }; } }
export function savePreferences(scope: TimerScope, preferences: { autoStop: boolean }) { try { localStorage.setItem(keysFor(scope).preferences, JSON.stringify(preferences)); } catch { /* Preference storage is non-critical. */ } }
type LockStatus = 'acquired' | 'locked' | 'storage_error';
type LockResult<T> = { result?: T; status: LockStatus };
type Lease = { owner?: string; until?: number };

async function localStorageLock<T>(name: string, fn: () => T): Promise<LockResult<T>> {
  const owner = getTabId();
  for (let retries = 0; retries < 20; retries += 1) {
    try {
      const existing = JSON.parse(localStorage.getItem(name) || 'null') as Lease | null;
      if (!existing || !existing.until || existing.until < Date.now() || existing.owner === owner) {
        localStorage.setItem(name, JSON.stringify({ owner, until: Date.now() + 2000 }));
        const claimed = JSON.parse(localStorage.getItem(name) || 'null') as Lease | null;
        if (claimed?.owner === owner) {
          try { return { result: fn(), status: 'acquired' }; } finally {
            try {
              const current = JSON.parse(localStorage.getItem(name) || 'null') as Lease | null;
              if (current?.owner === owner) localStorage.removeItem(name);
            } catch { /* The lease will expire if storage becomes unavailable. */ }
          }
        }
      }
    } catch { return { status: 'storage_error' }; }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return { status: 'locked' };
}

async function indexedDbLock<T>(name: string, fn: () => T): Promise<LockResult<T> | null> {
  if (typeof indexedDB === 'undefined') return null;
  const owner = getTabId();
  try {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('redmine_canvas_gantt_timer_locks', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('locks');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
    });
    const acquired = await new Promise<boolean>((resolve, reject) => {
      const transaction = database.transaction('locks', 'readwrite');
      const store = transaction.objectStore('locks');
      const request = store.get(name);
      request.onsuccess = () => {
        const existing = request.result as Lease | undefined;
        if (existing?.until && existing.until >= Date.now() && existing.owner !== owner) return resolve(false);
        store.put({ owner, until: Date.now() + 2000 }, name);
        resolve(true);
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'));
    });
    database.close();
    if (!acquired) return { status: 'locked' };
    try { return { result: fn(), status: 'acquired' }; } finally {
      const cleanup = indexedDB.open('redmine_canvas_gantt_timer_locks', 1);
      cleanup.onsuccess = () => {
        const transaction = cleanup.result.transaction('locks', 'readwrite');
        const store = transaction.objectStore('locks');
        const request = store.get(name);
        request.onsuccess = () => { if ((request.result as Lease | undefined)?.owner === owner) store.delete(name); };
        transaction.oncomplete = () => cleanup.result.close();
      };
    }
  } catch { return { status: 'storage_error' }; }
}

async function lock<T>(scope: TimerScope, fn: () => T): Promise<LockResult<T>> {
  const name = keysFor(scope).lock;
  if (navigator.locks?.request) {
    try { return { result: await navigator.locks.request(name, { mode: 'exclusive' }, fn), status: 'acquired' }; } catch { /* Try the shared fallback chain. */ }
  }
  const indexed = await indexedDbLock(name, fn);
  if (indexed) {
    if (indexed.status === 'acquired' || indexed.status === 'locked') return indexed;
  }
  return localStorageLock(name, fn);
}
export async function mutate(scope: TimerScope, updater: (session: TimerSession | null) => TimerSession | null | undefined): Promise<{ session: TimerSession | null; applied: boolean; lock: 'acquired' | 'locked' | 'storage_error' }> { const locked = await lock(scope, () => { const current = load(scope); const next = updater(current); if (next === undefined) return { session: current, applied: false }; try { const key = keysFor(scope).session; if (next === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify({ ...next, revision: (current?.revision ?? 0) + 1, updatedAt: Date.now() })); return { session: next === null ? null : load(scope), applied: true }; } catch { return { session: current, applied: false }; } }); return locked.result ? { ...locked.result, lock: locked.status } : { session: load(scope), applied: false, lock: locked.status }; }
