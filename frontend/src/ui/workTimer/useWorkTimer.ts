import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Issue } from '../types';
import { beginRecording, createTimerSession, elapsed, extend, recordedHours, recoverRecording, stopAndBeginRecording, tick } from './timerDomain';
import { getTabId, keysFor, load, loadPreferences, mutate, readSession, savePreferences, type TimerScope, type TimerMutationResult } from './timerStorage';
import { conflictResult, recordingContext, runRecordingCommand, type RecordingCommand } from './recordingCommand';
import type { TimerIntervalMinutes, TimerPreferences, TimerRecordingPhase, TimerRecordingContext, TimerSession } from './timerTypes';

type Options = { scope: TimerScope; onError: (message: string) => void; labels: Record<string, string> };
export function useWorkTimer({ scope, onError, labels }: Options) {
  const [session, setSession] = useState<TimerSession | null>(() => load(scope));
  const [startIssue, setStartIssue] = useState<Issue | null>(null);
  const [preferences, setPreferences] = useState<TimerPreferences>(() => loadPreferences(scope));
  const [conflictSession, setConflictSession] = useState<TimerSession | null>(null);
  const feedback = useRef({ labels, onError });
  useEffect(() => { feedback.current = { labels, onError }; }, [labels, onError]);
  const acceptResult = useCallback((result: TimerMutationResult) => {
    if (result.outcome === 'storage_error' || result.outcome === 'locked') {
      feedback.current.onError(feedback.current.labels.timer_sync_failed ?? 'Timer state synchronization failed.');
    } else if (result.outcome !== 'semantic_conflict' || result.session) setSession(result.session);
    return result;
  }, []);
  const sync = useCallback(() => {
    const read = readSession(scope);
    if (read.outcome !== 'storage_error') setSession(read.session);
  }, [scope]);
  useEffect(() => { sync(); setPreferences(loadPreferences(scope)); const keys = keysFor(scope); const onStorage = (event: StorageEvent) => { if (event.key === keys.session) sync(); if (event.key === keys.preferences) setPreferences(loadPreferences(scope)); }; addEventListener('storage', onStorage); return () => removeEventListener('storage', onStorage); }, [scope, sync]);
  useEffect(() => { void mutate(scope, current => current ? recoverRecording(current, getTabId()) : undefined).then(acceptResult); }, [scope, acceptResult]);
  useEffect(() => { if (!session || session.state !== 'running' || !session.deadlineAt) return; const timeout = window.setTimeout(() => { let notify = false; void mutate(scope, current => { if (!current) return undefined; notify = current.state === 'running' && current.deadlineAt === session.deadlineAt && current.notifiedDeadlineAt !== current.deadlineAt; return tick(current); }).then(result => { acceptResult(result); if (notify && result.outcome === 'applied' && typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(labels.work_timer ?? 'Work timer', { body: `${result.session?.subject ?? session.subject}: ${result.session?.state === 'expired' ? (labels.timer_expired ?? 'Time is over') : (labels.timer_pending ?? 'Work time not recorded')}` }); }); }, Math.max(0, session.deadlineAt - Date.now())); return () => clearTimeout(timeout); }, [acceptResult, labels, scope, session]);
  const open = useCallback((issue: Issue) => { if (!issue.can_log_time) { onError(labels.timer_permission_denied ?? 'You do not have permission to log time on this issue.'); return; } const read = readSession(scope); if (read.outcome === 'storage_error') { onError(labels.timer_sync_failed ?? 'Timer state synchronization failed.'); return; } const current = read.session; if (current && String(current.issueId) !== String(issue.id)) { setConflictSession(current); return; } if (current?.state === 'stopped_pending_record') return; if (!current) setStartIssue(issue); }, [labels, onError, scope]);
  const start = useCallback(async (minutes: TimerIntervalMinutes, autoStop: boolean) => { if (!startIssue) return conflictResult(); if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission(); const result = await mutate(scope, current => current ? undefined : createTimerSession(startIssue.id, startIssue.subject, minutes, autoStop, scope.userId)); acceptResult(result); if (result.outcome === 'applied') { const next = { autoStop }; savePreferences(scope, next); setPreferences(next); } setStartIssue(null); if (result.outcome !== 'applied') onError(labels.timer_conflict ?? 'Timer session conflict.'); return result; }, [acceptResult, labels, onError, scope, startIssue]);
  const change = useCallback(async (fn: (current: TimerSession) => TimerSession | null | undefined) => { const id = session?.sessionId; if (!id) return conflictResult(); const result = await mutate(scope, current => current?.sessionId === id ? fn(current) : undefined); acceptResult(result); return result; }, [acceptResult, scope, session?.sessionId]);
  const extendTimer = useCallback(async (minutes: TimerIntervalMinutes) => change(current => current.recordingAttempt ? undefined : extend(tick(current), minutes)), [change]);
  const stopTimer = useCallback(async () => {
    const id = session?.sessionId;
    if (!id) return null;

    const ownerTabId = getTabId();
    const stopped = await mutate(scope, (current) => current?.sessionId === id ? stopAndBeginRecording(current, ownerTabId) : undefined);
    acceptResult(stopped);
    const next = stopped.session;
    if (!next || stopped.outcome !== 'applied' || !next.recordingAttempt || next.recordingAttempt.ownerTabId !== ownerTabId) return null;
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(labels.work_timer ?? 'Work timer', { body: `${next.subject}: ${labels.timer_pending ?? 'Work time not recorded'}` });
    }
    return { ...recordingContext(scope, next)!, hours: recordedHours(next) };
  }, [acceptResult, labels, scope, session?.sessionId]);
  const record = useCallback(async () => {
    const ownerTabId = getTabId();
    const result = await change(current => beginRecording(current, ownerTabId));
    const next = result.session;
    if (result.outcome !== 'applied' || !next?.recordingAttempt || next.recordingAttempt.ownerTabId !== ownerTabId) return null;
    return { ...recordingContext(scope, next)!, hours: recordedHours(next) };
  }, [change, scope]);
  const command = useCallback(async (context: TimerRecordingContext, operation: RecordingCommand, phase?: TimerRecordingPhase) => {
    const result = await runRecordingCommand(scope, context, operation, phase);
    acceptResult(result);
    if (result.outcome === 'semantic_conflict') onError(labels.timer_conflict ?? 'Timer session conflict.');
    return result;
  }, [acceptResult, scope, labels, onError]);
  const recover = useCallback(async (expected: TimerSession) => {
    const context = recordingContext(scope, expected);
    return context ? command(context, 'recover', expected.recordingAttempt!.phase) : conflictResult();
  }, [scope, command]);
  const discard = useCallback(async () => {
    const id = session?.sessionId;
    if (!id) return conflictResult();
    const result = await mutate(scope, current => current?.sessionId === id && current.state === 'stopped_pending_record' && !current.recordingAttempt ? null : undefined);
    acceptResult(result);
    return result;
  }, [acceptResult, scope, session?.sessionId]);
  const lifecycle = useMemo(() => ({
    submitting: (context: TimerRecordingContext) => command(context, 'submitting'),
    validationError: (context: TimerRecordingContext) => command(context, 'validationError'),
    cancel: (context: TimerRecordingContext) => command(context, 'cancel'),
    unknown: (context: TimerRecordingContext) => command(context, 'unknown'),
    close: (context: TimerRecordingContext) => command(context, 'close'),
    complete: (context: TimerRecordingContext) => command(context, 'complete'),
    resolve: (expected: TimerSession, resolution: 'recorded' | 'unregistered') => {
      const context = recordingContext(scope, expected);
      return context ? command(context, resolution, expected.recordingAttempt!.phase) : Promise.resolve(conflictResult());
    },
  }), [command, scope]);
  const remoteOwner = Boolean(session?.recordingAttempt && session.recordingAttempt.ownerTabId !== getTabId());
  return { session, startIssue, setStartIssue, conflictSession, setConflictSession, preferences, open, start, extendTimer, stopTimer, record, recover, discard, remoteOwner, lifecycle, elapsed: session ? elapsed(session) : 0 };
}
