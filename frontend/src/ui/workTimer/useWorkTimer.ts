import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Issue } from '../types';
import { beginRecording, beginSubmission, cancelRecording, completeRecording, createTimerSession, elapsed, extend, markUnknown, markValidationError, recordedHours, recoverRecording, resolveUnknown, stop, takeOverRecording, tick } from './timerDomain';
import { getTabId, keysFor, load, loadPreferences, mutate, savePreferences, type TimerScope } from './timerStorage';
import type { TimerIntervalMinutes, TimerPreferences, TimerRecordingContext, TimerSession } from './timerTypes';

type Options = { scope: TimerScope; onError: (message: string) => void; labels: Record<string, string> };
export function useWorkTimer({ scope, onError, labels }: Options) {
  const [session, setSession] = useState<TimerSession | null>(() => load(scope));
  const [startIssue, setStartIssue] = useState<Issue | null>(null);
  const [preferences, setPreferences] = useState<TimerPreferences>(() => loadPreferences(scope));
  const sync = useCallback(() => setSession(load(scope)), [scope]);
  useEffect(() => { sync(); setPreferences(loadPreferences(scope)); const keys = keysFor(scope); const onStorage = (event: StorageEvent) => { if (event.key === keys.session) sync(); if (event.key === keys.preferences) setPreferences(loadPreferences(scope)); }; addEventListener('storage', onStorage); return () => removeEventListener('storage', onStorage); }, [scope, sync]);
  useEffect(() => { void mutate(scope, current => current ? recoverRecording(current, getTabId()) : undefined).then(result => setSession(result.session)); }, [scope]);
  useEffect(() => { if (!session || session.state !== 'running' || !session.deadlineAt) return; const timeout = window.setTimeout(() => { let notify = false; void mutate(scope, current => { if (!current) return undefined; notify = current.state === 'running' && current.deadlineAt === session.deadlineAt && current.notifiedDeadlineAt !== current.deadlineAt; return tick(current); }).then(result => { setSession(result.session); if (notify && result.applied && typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(labels.work_timer ?? 'Work timer', { body: `${result.session?.subject ?? session.subject}: ${result.session?.state === 'expired' ? (labels.timer_expired ?? 'Time is over') : (labels.timer_pending ?? 'Work time not recorded')}` }); }); }, Math.max(0, session.deadlineAt - Date.now())); return () => clearTimeout(timeout); }, [labels, scope, session]);
  const open = useCallback((issue: Issue) => { if (!issue.can_log_time) { onError(labels.timer_permission_denied ?? 'You do not have permission to log time on this issue.'); return; } const current = load(scope); if (current && String(current.issueId) !== String(issue.id)) { onError((labels.timer_existing ?? 'A work timer already exists for #%{id}.').replace('%{id}', String(current.issueId))); return; } if (current?.state === 'stopped_pending_record') return; if (!current) setStartIssue(issue); }, [labels, onError, scope]);
  const start = useCallback(async (minutes: TimerIntervalMinutes, autoStop: boolean) => { if (!startIssue) return false; if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission(); const result = await mutate(scope, current => current ? undefined : createTimerSession(startIssue.id, startIssue.subject, minutes, autoStop, scope.userId)); setSession(result.session); if (result.applied) { const next = { autoStop }; savePreferences(scope, next); setPreferences(next); } setStartIssue(null); if (!result.applied) onError(labels.timer_conflict ?? 'Timer session conflict.'); return result.applied; }, [labels, onError, scope, startIssue]);
  const change = useCallback(async (fn: (current: TimerSession) => TimerSession | null | undefined) => { const id = session?.sessionId; if (!id) return { session: null, applied: false }; const result = await mutate(scope, current => current?.sessionId === id ? fn(current) : undefined); setSession(result.session); return result; }, [scope, session?.sessionId]);
  const changeWithRetry = useCallback(async (fn: (current: TimerSession) => TimerSession | null | undefined) => {
    let result = await change(fn);
    for (let attempt = 0; attempt < 2 && !result.applied; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      result = await change(fn);
    }
    return result;
  }, [change]);
  const extendTimer = useCallback(async (minutes: TimerIntervalMinutes) => (await change(current => extend(tick(current), minutes))).session, [change]);
  const stopTimer = useCallback(async () => { const next = (await change(current => stop(tick(current)))).session; if (!next) return null; if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && next.state === 'stopped_pending_record') new Notification(labels.work_timer ?? 'Work timer', { body: `${next.subject}: ${labels.timer_pending ?? 'Work time not recorded'}` }); const recording = (await change(current => beginRecording(current, getTabId()))).session; return recording?.recordingAttempt ? { origin: 'timer' as const, sessionId: recording.sessionId, issueId: recording.issueId, attemptId: recording.recordingAttempt.id, hours: recordedHours(recording) } : null; }, [change, labels]);
  const record = useCallback(async () => { const next = (await change(current => beginRecording(current, getTabId()))).session; return next?.recordingAttempt ? { origin: 'timer' as const, sessionId: next.sessionId, issueId: next.issueId, attemptId: next.recordingAttempt.id, hours: recordedHours(next) } : null; }, [change]);
  const recover = useCallback(async () => {
    const current = load(scope);
    const attempt = current?.recordingAttempt;
    if (!current || !attempt || attempt.ownerTabId === getTabId()) return false;
    const result = await mutate(scope, next => next?.sessionId === current.sessionId ? takeOverRecording(next, attempt.id, getTabId()) : undefined);
    setSession(result.session);
    return result.applied;
  }, [scope]);
  const lifecycle = useMemo(() => ({ submitting: async (context: TimerRecordingContext) => (await change(current => beginSubmission(current, context.attemptId))).applied, validationError: async (context: TimerRecordingContext) => (await changeWithRetry(current => markValidationError(current, context.attemptId))).applied, cancel: async (context: TimerRecordingContext) => (await change(current => cancelRecording(current, context.attemptId))).applied, unknown: async (context: TimerRecordingContext) => (await changeWithRetry(current => markUnknown(current, context.attemptId))).applied, close: async (context: TimerRecordingContext) => { const phase = load(scope)?.recordingAttempt?.phase; return phase === 'editing' ? (await changeWithRetry(current => cancelRecording(current, context.attemptId))).applied : phase === 'submitting' ? (await changeWithRetry(current => markUnknown(current, context.attemptId))).applied : false; }, complete: async (context: TimerRecordingContext) => (await changeWithRetry(current => completeRecording(current, context.attemptId))).applied, resolve: async (context: TimerRecordingContext, resolution: 'recorded' | 'unregistered') => (await changeWithRetry(current => resolveUnknown(current, context.attemptId, resolution))).applied }), [change, changeWithRetry, scope]);
  const remoteOwner = Boolean(session?.recordingAttempt && session.recordingAttempt.ownerTabId !== getTabId());
  return { session, startIssue, setStartIssue, preferences, open, start, extendTimer, stopTimer, record, recover, remoteOwner, lifecycle, elapsed: session ? elapsed(session) : 0 };
}
