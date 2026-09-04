import { TIMER_SESSION_VERSION, timerId } from './timerDomain';
import type { TimerSession } from './timerTypes';
export type TimerScope = { instanceKey: string; userId: number };
const sessionBase = 'redmine_canvas_gantt_timer_session'; const prefsBase = 'redmine_canvas_gantt_timer_preferences'; const tabBase = 'redmine_canvas_gantt_timer_tab_id';
let fallbackTabId: string | null = null;
const suffix = (scope: TimerScope) => `${encodeURIComponent(scope.instanceKey)}:user:${scope.userId}`;
export const keysFor = (scope: TimerScope) => ({ session: `${sessionBase}:${suffix(scope)}`, preferences: `${prefsBase}:${suffix(scope)}`, lock: `redmine_canvas_gantt_timer_lock:${suffix(scope)}` });
export function getTabId() { try { const old = sessionStorage.getItem(tabBase); if (old?.trim()) return old; const next = timerId(); sessionStorage.setItem(tabBase, next); return next; } catch { fallbackTabId ??= timerId(); return fallbackTabId; } }
export function isTimerSession(value: unknown): value is TimerSession { const x = value as Partial<TimerSession> | null; return !!x && x.version === TIMER_SESSION_VERSION && typeof x.sessionId === 'string' && x.sessionId.trim().length > 0 && Number.isInteger(x.revision) && (x.revision ?? 0) > 0 && x.issueId !== undefined && x.issueId !== null && x.issueId !== '' && typeof x.subject === 'string' && typeof x.autoStop === 'boolean' && typeof x.createdAt === 'number' && Number.isFinite(x.createdAt) && typeof x.updatedAt === 'number' && Number.isFinite(x.updatedAt) && (x.userId === undefined || (typeof x.userId === 'number' && Number.isFinite(x.userId))) && Array.isArray(x.segments) && x.segments.length > 0 && x.segments.every(segment => typeof segment?.startedAt === 'number' && Number.isFinite(segment.startedAt) && segment.startedAt > 0 && (segment.stoppedAt === undefined || (typeof segment.stoppedAt === 'number' && Number.isFinite(segment.stoppedAt) && segment.stoppedAt >= segment.startedAt))) && ['running', 'expired', 'stopped_pending_record'].includes(String(x.state)) && (x.deadlineAt === undefined || (typeof x.deadlineAt === 'number' && Number.isFinite(x.deadlineAt))) && (x.notifiedDeadlineAt === undefined || (typeof x.notifiedDeadlineAt === 'number' && Number.isFinite(x.notifiedDeadlineAt))) && (x.notifiedType === undefined || ['running_expired', 'stopped'].includes(x.notifiedType)) && (!x.recordingAttempt || (x.state === 'stopped_pending_record' && typeof x.recordingAttempt.id === 'string' && x.recordingAttempt.id.trim().length > 0 && typeof x.recordingAttempt.ownerTabId === 'string' && x.recordingAttempt.ownerTabId.trim().length > 0 && typeof x.recordingAttempt.openedAt === 'number' && Number.isFinite(x.recordingAttempt.openedAt) && ['editing', 'submitting', 'unknown'].includes(x.recordingAttempt.phase))); }
function migrate(value: unknown): TimerSession | null { if (isTimerSession(value)) return value; const x = value as Partial<TimerSession> & { recordingAttemptId?: unknown } | null; if (!x || ![2, 3, TIMER_SESSION_VERSION].includes(x.version ?? 0)) return null; const base = { ...x, version: TIMER_SESSION_VERSION }; delete base.recordingAttempt; delete base.recordingAttemptId; if (x.state !== 'stopped_pending_record') return !x.recordingAttempt && !x.recordingAttemptId && isTimerSession(base) ? base : null; const legacy = x.recordingAttempt as Partial<TimerSession['recordingAttempt']> | undefined; if (typeof x.recordingAttemptId === 'string' && x.recordingAttemptId.trim()) base.recordingAttempt = { id: x.recordingAttemptId, ownerTabId: 'legacy-owner', openedAt: x.updatedAt!, phase: 'unknown' }; else if (legacy && typeof legacy.id === 'string' && typeof legacy.openedAt === 'number' && ['editing', 'submitting', 'unknown'].includes(String(legacy.phase))) base.recordingAttempt = { id: legacy.id, ownerTabId: typeof legacy.ownerTabId === 'string' && legacy.ownerTabId.trim() ? legacy.ownerTabId : 'legacy-owner', openedAt: legacy.openedAt, phase: legacy.phase! }; else if (x.recordingAttempt || x.recordingAttemptId) return null; return isTimerSession(base) ? base : null; }
export type TimerReadResult =
  | { outcome: 'found'; session: TimerSession }
  | { outcome: 'absent'; session: null }
  | { outcome: 'storage_error'; session: null };
export function readSession(scope: TimerScope): TimerReadResult {
  try {
    const raw = localStorage.getItem(keysFor(scope).session);
    if (raw === null) return { outcome: 'absent', session: null };
    const session = migrate(JSON.parse(raw));
    if (!session || (session.userId !== undefined && session.userId !== scope.userId)) return { outcome: 'storage_error', session: null };
    return { outcome: 'found', session };
  } catch { return { outcome: 'storage_error', session: null }; }
}
export function load(scope: TimerScope): TimerSession | null { return readSession(scope).session; }
export function loadPreferences(scope: TimerScope): { autoStop: boolean } { try { const raw = localStorage.getItem(keysFor(scope).preferences); const value = raw ? JSON.parse(raw) as { autoStop?: unknown } : null; return typeof value?.autoStop === 'boolean' ? { autoStop: value.autoStop } : { autoStop: false }; } catch { return { autoStop: false }; } }
export function savePreferences(scope: TimerScope, preferences: { autoStop: boolean }) { try { localStorage.setItem(keysFor(scope).preferences, JSON.stringify(preferences)); } catch { /* Preference storage is non-critical. */ } }
type LockStatus = 'acquired' | 'locked' | 'storage_error';
type LockResult<T> = { result?: T; status: LockStatus };
type Lease = { token: string; expiresAt: number };

function parseLease(raw: string | null): Lease | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Lease>;
    return typeof parsed.token === 'string' && typeof parsed.expiresAt === 'number' ? parsed as Lease : null;
  } catch { return null; }
}

async function localStorageLock<T>(name: string, fn: () => T): Promise<LockResult<T>> {
  try {
    const existing = parseLease(localStorage.getItem(name));
    if (existing && existing.expiresAt > Date.now()) return { status: 'locked' };
    const token = timerId();
    localStorage.setItem(name, JSON.stringify({ token, expiresAt: Date.now() + 2000 }));
    if (parseLease(localStorage.getItem(name))?.token !== token) return { status: 'locked' };
    try { return { result: fn(), status: 'acquired' }; }
    finally { if (parseLease(localStorage.getItem(name))?.token === token) localStorage.removeItem(name); }
  } catch { return { status: 'storage_error' }; }
}

async function indexedDbLock<T>(name: string, fn: () => T): Promise<LockResult<T> | null> {
  if (typeof indexedDB === 'undefined') return null;
  let database: IDBDatabase | undefined;
  try {
    database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('redmine_canvas_gantt_timer_locks', 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('locks')) request.result.createObjectStore('locks'); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
      request.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
    return await new Promise<LockResult<T>>((resolve) => {
      const transaction = database!.transaction('locks', 'readwrite');
      let result: T | undefined;
      transaction.oncomplete = () => { database?.close(); resolve({ result, status: 'acquired' }); };
      transaction.onerror = () => { database?.close(); resolve({ status: 'storage_error' }); };
      transaction.onabort = () => { database?.close(); resolve({ status: 'storage_error' }); };
      const request = transaction.objectStore('locks').put(Date.now(), name);
      request.onsuccess = () => {
        try { result = fn(); }
        catch { transaction.abort(); }
      };
    });
  } catch { database?.close(); return { status: 'storage_error' }; }
}

async function lock<T>(scope: TimerScope, update: () => T): Promise<LockResult<T>> {
  // A fallback must never execute the logical mutation twice after a lock backend fails.
  let executed = false;
  let result: T;
  const fn = () => { if (!executed) { executed = true; result = update(); } return result; };
  const name = keysFor(scope).lock;
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    try { return { result: await navigator.locks.request(name, { mode: 'exclusive' }, fn), status: 'acquired' }; } catch { if (executed) return { status: 'storage_error' }; }
  }
  const indexed = await indexedDbLock(name, fn);
  if (indexed?.status === 'acquired') return indexed;
  if (executed) return { status: 'storage_error' };
  return localStorageLock(name, fn);
}
export type TimerMutationOutcome = 'applied' | 'semantic_conflict' | 'locked' | 'storage_error' | 'absent' | 'already_completed';
export type TimerMutationResult = { session: TimerSession | null; outcome: TimerMutationOutcome; applied: boolean; lock: LockStatus };
export const mutationSucceeded = (result: { outcome: TimerMutationOutcome }) => result.outcome === 'applied' || result.outcome === 'already_completed';

export async function mutate(
  scope: TimerScope,
  updater: (session: TimerSession | null) => TimerSession | null | undefined,
  options: { absentOutcome?: 'absent' | 'already_completed' } = {},
): Promise<TimerMutationResult> {
  const locked = await lock(scope, () => {
    const read = readSession(scope);
    if (read.outcome === 'storage_error') return { session: null, outcome: 'storage_error' as const, applied: false };
    const current = read.session;
    if (!current && options.absentOutcome) return { session: null, outcome: options.absentOutcome, applied: false };
    const next = updater(current);
    if (next === undefined || next === current) return { session: current, outcome: current ? 'semantic_conflict' as const : 'absent' as const, applied: false };
    const persisted = next === null ? null : { ...next, revision: (current?.revision ?? 0) + 1, updatedAt: Date.now() };
    try {
      const key = keysFor(scope).session;
      if (persisted === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(persisted));
      return { session: persisted, outcome: 'applied' as const, applied: true };
    } catch { return { session: current, outcome: 'storage_error' as const, applied: false }; }
  });
  return locked.result ? { ...locked.result, lock: locked.status } : { session: null, outcome: locked.status === 'locked' ? 'locked' : 'storage_error', applied: false, lock: locked.status };
}
