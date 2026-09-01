import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTimerSession } from './timerDomain';
import { keysFor, load, mutate } from './timerStorage';

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
});
