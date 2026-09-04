// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beginRecording, createTimerSession, stop } from './timerDomain';
import { keysFor, load, mutate, readSession } from './timerStorage';
import { recordingContext, runRecordingCommand } from './recordingCommand';

const scope = { instanceKey: 'https://example.test/redmine', userId: 7 };
const seed = async () => {
  await mutate(scope, () => beginRecording(stop(createTimerSession(12, 'Issue', 5, false, 7, 1000), 61000), 'tab-a', 62000));
  return recordingContext(scope, load(scope)!)!;
};
const command = (context: ReturnType<typeof recordingContext>, operation: Parameters<typeof runRecordingCommand>[2], phase?: Parameters<typeof runRecordingCommand>[3]) => runRecordingCommand(scope, context!, operation, phase);

describe('recording commands and canonical outcomes', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); sessionStorage.setItem('redmine_canvas_gantt_timer_tab_id', 'tab-a'); });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('distinguishes absence, corrupt data and unavailable storage without invoking the updater', async () => {
    expect(readSession(scope).outcome).toBe('absent');
    const updater = vi.fn(() => null);
    for (const raw of ['', 'null', '{', '{}', JSON.stringify({ ...stop(createTimerSession(12, 'Issue', 5, false, 7)), recordingAttempt: { id: 'unknown-attempt', phase: 'invalid' } })]) {
      localStorage.setItem(keysFor(scope).session, raw);
      expect(readSession(scope).outcome).toBe('storage_error');
      expect((await mutate(scope, updater)).outcome).toBe('storage_error');
      expect(localStorage.getItem(keysFor(scope).session)).toBe(raw);
    }
    expect(updater).not.toHaveBeenCalled();
  });

  it('has one canonical read and write per mutation, and monotonically increments revision', async () => {
    const context = await seed();
    const previous = load(scope)!.revision;
    const get = vi.spyOn(Storage.prototype, 'getItem');
    const set = vi.spyOn(Storage.prototype, 'setItem');
    const result = await command(context, 'submitting');
    expect(result).toMatchObject({ outcome: 'applied', session: { revision: previous + 1 } });
    expect(get.mock.calls.filter(([key]) => key === keysFor(scope).session)).toHaveLength(1);
    expect(set.mock.calls.filter(([key]) => key === keysFor(scope).session)).toHaveLength(1);
  });

  it('completes idempotently, rejects a new session and preserves state on write failure', async () => {
    const context = await seed();
    expect((await command(context, 'submitting')).outcome).toBe('applied');
    const originalRemove = Storage.prototype.removeItem;
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key: string) { if (key === keysFor(scope).session) throw new Error('denied'); originalRemove.call(this, key); });
    expect((await command(context, 'complete')).outcome).toBe('storage_error');
    expect(load(scope)?.recordingAttempt?.phase).toBe('submitting');
    remove.mockRestore();
    expect((await command(context, 'complete')).outcome).toBe('applied');
    expect((await command(context, 'complete')).outcome).toBe('already_completed');
    await mutate(scope, () => createTimerSession(12, 'New session', 5, false, 7));
    const canonical = localStorage.getItem(keysFor(scope).session);
    expect((await command(context, 'complete')).outcome).toBe('semantic_conflict');
    expect(localStorage.getItem(keysFor(scope).session)).toBe(canonical);
  });

  it.each(['sessionId', 'attemptId', 'ownerTabId', 'issueId'] as const)('rejects stale %s without a write', async field => {
    const context = await seed();
    const previous = localStorage.getItem(keysFor(scope).session);
    expect((await command({ ...context, [field]: 'stale' }, 'submitting')).outcome).toBe('semantic_conflict');
    expect(localStorage.getItem(keysFor(scope).session)).toBe(previous);
  });

  it('rejects another scope and an owner change before submit', async () => {
    const context = await seed();
    expect((await command({ ...context, scope: { ...scope, userId: 8 } }, 'submitting')).outcome).toBe('semantic_conflict');
    sessionStorage.setItem('redmine_canvas_gantt_timer_tab_id', 'tab-b');
    expect((await command(context, 'submitting')).outcome).toBe('semantic_conflict');
  });

  it('rechecks phase at confirmation, then prevents the old editing tab from submitting', async () => {
    const context = await seed();
    await command(context, 'submitting');
    sessionStorage.setItem('redmine_canvas_gantt_timer_tab_id', 'tab-b');
    expect((await command(context, 'recover', 'editing')).outcome).toBe('semantic_conflict');
    expect((await command(context, 'recover', 'submitting')).session?.recordingAttempt).toMatchObject({ phase: 'unknown', ownerTabId: 'tab-b' });
    sessionStorage.setItem('redmine_canvas_gantt_timer_tab_id', 'tab-a');
    expect((await command(context, 'complete')).outcome).toBe('semantic_conflict');
    expect((await command(context, 'submitting')).outcome).toBe('semantic_conflict');
  });

  it('recovers remote editing and rejects its stale Save after a new attempt is reserved', async () => {
    const old = await seed();
    sessionStorage.setItem('redmine_canvas_gantt_timer_tab_id', 'tab-b');
    expect((await command(old, 'recover', 'editing')).session?.recordingAttempt).toBeUndefined();
    await mutate(scope, current => beginRecording(current!, 'tab-b'));
    const canonical = localStorage.getItem(keysFor(scope).session);
    sessionStorage.setItem('redmine_canvas_gantt_timer_tab_id', 'tab-a');
    expect((await command(old, 'submitting')).outcome).toBe('semantic_conflict');
    expect(localStorage.getItem(keysFor(scope).session)).toBe(canonical);
  });

  it.each(['recorded', 'unregistered'] as const)('resolves only the confirmed unknown attempt: %s', async resolution => {
    const context = await seed();
    await command(context, 'submitting');
    await command(context, 'unknown');
    expect((await command(context, resolution, 'editing')).outcome).toBe('semantic_conflict');
    expect((await command(context, resolution, 'unknown')).outcome).toBe('applied');
    expect(load(scope)?.recordingAttempt).toBeUndefined();
    expect(load(scope) === null).toBe(resolution === 'recorded');
    expect((await command(context, 'submitting')).outcome).not.toBe('applied');
  });

  it('runs cancel, record, validation, resubmit and success without losing elapsed segments', async () => {
    const first = await seed();
    await command(first, 'cancel');
    await mutate(scope, current => beginRecording(current!, 'tab-a'));
    const second = recordingContext(scope, load(scope)!)!;
    expect(second.attemptId).not.toBe(first.attemptId);
    expect((await command(first, 'submitting')).outcome).toBe('semantic_conflict');
    await command(second, 'submitting');
    expect((await command(second, 'validationError')).session?.segments).toEqual([{ startedAt: 1000, stoppedAt: 61000 }]);
    await command(second, 'submitting');
    expect((await command(second, 'complete')).outcome).toBe('applied');
  });

  it('retries locks at most three times and never retries semantic conflict or storage error', async () => {
    const context = await seed();
    vi.useFakeTimers();
    const spy = vi.spyOn(Storage.prototype, 'getItem');
    localStorage.setItem(keysFor(scope).lock, JSON.stringify({ token: 'held', expiresAt: Date.now() + 10000 }));
    const pending = command(context, 'submitting');
    await vi.runAllTimersAsync();
    expect((await pending).outcome).toBe('locked');
    expect(spy.mock.calls.filter(([key]) => key === keysFor(scope).lock)).toHaveLength(3);
    localStorage.removeItem(keysFor(scope).lock);
    spy.mockClear();
    expect((await command({ ...context, attemptId: 'stale' }, 'submitting')).outcome).toBe('semantic_conflict');
    expect(spy.mock.calls.filter(([key]) => key === keysFor(scope).session)).toHaveLength(1);
    spy.mockRestore();
    const originalGet = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) { if (key === keysFor(scope).session) throw new Error('read'); return originalGet.call(this, key); });
    expect((await command(context, 'complete')).outcome).toBe('storage_error');
  });
});
