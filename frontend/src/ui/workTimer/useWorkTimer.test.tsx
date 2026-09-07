// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Issue } from '../types';
import { beginRecording, createTimerSession, stop } from './timerDomain';
import { getTabId, keysFor, load, mutate } from './timerStorage';
import { GlobalTimer, OtherNoticeModal } from './WorkTimer';
import { useWorkTimer } from './useWorkTimer';

const scope = { instanceKey: 'https://example.test/redmine', userId: 7 };

function PendingCardHarness() {
  const timer = useWorkTimer({ scope, labels: {}, onError: vi.fn() });
  const callbacks = {
    onExtend: vi.fn(), onStop: vi.fn(), onRecord: vi.fn(), onResume: vi.fn(), onDiscard: vi.fn(),
    onResolveUnknown: vi.fn(), onRecover: vi.fn(),
  };
  return <>
    <button type="button" onClick={() => timer.open({ id: 1, subject: 'Issue', can_log_time: true } as Issue)}>Worktime #1</button>
    <button type="button" onClick={() => timer.open({ id: 2, subject: 'Other issue', can_log_time: true } as Issue)}>Worktime #2</button>
    <GlobalTimer labels={{}} session={timer.session} remoteOwner={timer.remoteOwner} openPendingRequest={timer.pendingManageRequest} {...callbacks} />
    <OtherNoticeModal labels={{}} session={timer.conflictSession} onClose={() => timer.setConflictSession(null)} />
  </>;
}

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

  it('requests pending management when opening the same Issue from a card', async () => {
    const { result } = renderHook(() => useWorkTimer({ scope, labels: {}, onError: vi.fn() }));
    await waitFor(() => expect(result.current.session?.state).toBe('stopped_pending_record'));

    await act(async () => {
      result.current.open({ id: 1, subject: 'Issue', can_log_time: true } as Issue);
    });

    expect(result.current.pendingManageRequest).toBe(1);
    expect(result.current.startIssue).toBeNull();
  });

  it('connects card Worktime actions to PendingWorkModal and preserves OtherNotice for another Issue', async () => {
    render(<PendingCardHarness />);
    await waitFor(() => expect(screen.getByTestId('global-timer')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Worktime #1' }));
    await waitFor(() => expect(screen.getByTestId('pending-work-modal')).toBeTruthy());
    expect(within(screen.getByTestId('pending-work-modal')).getByText('#1 Issue')).toBeTruthy();
    fireEvent.click(screen.getByTestId('pending-work-close-button'));

    fireEvent.click(screen.getByRole('button', { name: 'Worktime #2' }));
    const otherHeading = await screen.findByRole('heading', { name: 'There is unrecorded work time' });
    expect(within(otherHeading.closest('[role="dialog"]')!).getByText('#1 Issue')).toBeTruthy();
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
