// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beginRecording, createTimerSession, stop } from './timerDomain';
import { getTabId, keysFor, load, mutate } from './timerStorage';
import { useWorkTimer } from './useWorkTimer';

const scope = { instanceKey: 'https://example.test/redmine', userId: 7 };

describe('useWorkTimer recording ownership', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem(keysFor(scope).session, JSON.stringify(stop(createTimerSession(1, 'Issue', 30, false, 7))));
  });
  afterEach(cleanup);

  it('opens only one recording context for simultaneous record requests', async () => {
    const { result } = renderHook(() => useWorkTimer({ scope, labels: {}, onError: vi.fn() }));
    await waitFor(() => expect(result.current.session?.state).toBe('stopped_pending_record'));

    await act(async () => {
      const contexts = await Promise.all([result.current.record(), result.current.record()]);
      expect(contexts.filter(Boolean)).toHaveLength(1);
      expect(contexts.find(Boolean)?.attemptId).toBe(load(scope)?.recordingAttempt?.id);
    });
    expect(load(scope)?.recordingAttempt?.ownerTabId).toBe(getTabId());
  });

  it('does not open an attempt claimed by another tab before the UI syncs', async () => {
    const { result } = renderHook(() => useWorkTimer({ scope, labels: {}, onError: vi.fn() }));
    await waitFor(() => expect(result.current.session?.state).toBe('stopped_pending_record'));
    await mutate(scope, current => current ? beginRecording(current, 'other-tab') : undefined);

    await act(async () => {
      expect(await result.current.record()).toBeNull();
    });
    expect(result.current.remoteOwner).toBe(true);
    expect(load(scope)?.recordingAttempt?.ownerTabId).toBe('other-tab');
  });
  it('completes idempotently but never treats a storage read error as completion', async () => {
    const { result } = renderHook(() => useWorkTimer({ scope, labels: {}, onError: vi.fn() }));
    await act(async () => {
      const context = (await result.current.record())!;
      expect(await result.current.lifecycle.submitting(context)).toMatchObject({ outcome: 'applied' });
      expect(await result.current.lifecycle.complete(context)).toMatchObject({ outcome: 'applied' });
      expect(await result.current.lifecycle.complete(context)).toMatchObject({ outcome: 'already_completed' });
      const originalRead = Storage.prototype.getItem;
      const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) { if (key === keysFor(scope).session) throw new Error('blocked'); return originalRead.call(this, key); });
      expect(await result.current.lifecycle.complete(context)).toMatchObject({ outcome: 'storage_error' });
      read.mockRestore();
    });
  });

});
