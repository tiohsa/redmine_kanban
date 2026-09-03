import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTimerSession, stopAndBeginRecording } from './timerDomain';
import { getTabId, keysFor, load, loadPreferences, mutate, savePreferences } from './timerStorage';

describe('work timer storage', () => {
  const scope = { instanceKey: 'https://example.test/redmine', userId: 7 };
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    });
    vi.stubGlobal('navigator', {});
  });
  it('scopes Gantt-compatible sessions by instance and user', async () => {
    await mutate(scope, () => createTimerSession(1, 'Issue', 30, true, 7));
    expect(keysFor(scope).session).toContain('redmine_canvas_gantt_timer_session');
    expect(load(scope)?.issueId).toBe(1);
    expect(load({ ...scope, userId: 8 })).toBeNull();
  });
  it('serializes starts so the second mutation observes the first session', async () => {
    const first = await mutate(scope, (current) => current ?? createTimerSession(1, 'One', 30, true, 7));
    const second = await mutate(scope, (current) => current ? undefined : createTimerSession(2, 'Two', 30, true, 7));
    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(load(scope)?.issueId).toBe(1);
  });
  it('allows only one tab to own an atomic stop-and-record transition', async () => {
    await mutate(scope, () => createTimerSession(1, 'One', 30, false, 7, 1_000));
    const [tabA, tabB] = await Promise.all([
      mutate(scope, current => current ? stopAndBeginRecording(current, 'tab-a', 2_000) : undefined),
      mutate(scope, current => current ? stopAndBeginRecording(current, 'tab-b', 2_000) : undefined),
    ]);
    expect([tabA, tabB].filter(result => result.applied)).toHaveLength(1);
    expect(load(scope)?.recordingAttempt?.ownerTabId).toMatch(/^tab-[ab]$/);
  });
  it('rejects malformed version 4 sessions', () => {
    localStorage.setItem(keysFor(scope).session, JSON.stringify({ version: 4, sessionId: 'x', revision: 1, issueId: 1, subject: 'Issue', autoStop: true, segments: [], state: 'running', createdAt: 1, updatedAt: 1 }));
    expect(load(scope)).toBeNull();
  });
  it('migrates Gantt v2/v3 sessions and legacy recording attempts', () => {
    const legacy = { ...createTimerSession(1, 'Issue', 30, true, 7), version: 3, recordingAttemptId: 'legacy-attempt', state: 'stopped_pending_record' as const, segments: [{ startedAt: 1, stoppedAt: 2 }] };
    localStorage.setItem(keysFor(scope).session, JSON.stringify(legacy));
    expect(load(scope)).toMatchObject({ version: 4, recordingAttempt: { id: 'legacy-attempt', ownerTabId: 'legacy-owner', phase: 'unknown' } });
  });
  it('shares the Gantt auto-stop preference key', () => {
    expect(loadPreferences(scope)).toEqual({ autoStop: false });
    savePreferences(scope, { autoStop: true });
    expect(keysFor(scope).preferences).toContain('redmine_canvas_gantt_timer_preferences');
    expect(loadPreferences(scope)).toEqual({ autoStop: true });
  });
  it('fails closed when the lease is held by another tab', async () => {
    vi.stubGlobal('navigator', {});
    localStorage.setItem(keysFor(scope).lock, JSON.stringify({ token: 'other-tab', expiresAt: Date.now() + 10_000 }));
    const result = await mutate(scope, () => createTimerSession(1, 'Issue', 30, true, 7));
    expect(result).toMatchObject({ applied: false, lock: 'locked' });
    expect(load(scope)).toBeNull();
  });
  it('fails closed when lease storage throws', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => undefined, removeItem: () => undefined });
    const result = await mutate(scope, () => createTimerSession(1, 'Issue', 30, true, 7));
    expect(result).toMatchObject({ applied: false, lock: 'storage_error' });
  });
  it('falls back to the lease when the Web Locks API rejects', async () => {
    vi.stubGlobal('navigator', { locks: { request: vi.fn().mockRejectedValue(new Error('unavailable')) } });
    const result = await mutate(scope, () => createTimerSession(1, 'Issue', 30, true, 7));
    expect(result).toMatchObject({ applied: true, lock: 'acquired' });
    expect(load(scope)?.issueId).toBe(1);
  });
  it('keeps a stable in-memory tab id when sessionStorage is unavailable', () => {
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(getTabId()).toBe(getTabId());
  });
});
