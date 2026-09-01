import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Issue } from '../types';
import { beginRecording, clearRecording, createTimerSession, elapsed, extend, recordedHours, stop, tick, transitionRecording } from './timerDomain';
import { getTabId, keysFor, load, mutate, type TimerScope } from './timerStorage';
import type { TimerIntervalMinutes, TimerRecordingContext, TimerSession } from './timerTypes';

type Options = { scope: TimerScope; onError: (message: string) => void; labels: Record<string, string> };
export function useWorkTimer({ scope, onError, labels }: Options) {
  const [session, setSession] = useState<TimerSession | null>(() => load(scope));
  const [startIssue, setStartIssue] = useState<Issue | null>(null);
  const notifiedState = useRef<string | null>(null);
  const sync = useCallback(() => setSession(load(scope)), [scope]);
  useEffect(() => { sync(); const key = keysFor(scope).session; const onStorage = (event: StorageEvent) => { if (event.key === key) sync(); }; addEventListener('storage', onStorage); return () => removeEventListener('storage', onStorage); }, [scope, sync]);
  useEffect(() => { if (!session || session.state !== 'running' || !session.deadlineAt) return; const timeout = window.setTimeout(() => { void mutate(scope, current => current ? tick(current) : undefined).then(result => setSession(result.session)); }, Math.max(0, session.deadlineAt - Date.now())); return () => clearTimeout(timeout); }, [scope, session]);
  useEffect(() => {
    if (!session || session.state === 'running') return;
    const key = `${session.sessionId}:${session.state}:${session.deadlineAt}`;
    if (notifiedState.current === key) return;
    notifiedState.current = key;
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(labels.work_timer ?? 'Work timer', { body: `${session.subject}: ${session.state === 'expired' ? (labels.timer_expired ?? 'Time is over') : (labels.timer_pending ?? 'Work time not recorded')}` });
    }
  }, [labels, session]);
  const open = useCallback((issue: Issue) => { if (!issue.can_log_time) { onError(labels.timer_permission_denied ?? 'You do not have permission to log time on this issue.'); return; } const current = load(scope); if (current && String(current.issueId) !== String(issue.id)) { onError((labels.timer_existing ?? 'A work timer already exists for #%{id}.').replace('%{id}', String(current.issueId))); return; } if (current?.state === 'stopped_pending_record') return; if (!current) setStartIssue(issue); }, [labels, onError, scope]);
  const start = useCallback(async (minutes: TimerIntervalMinutes, autoStop: boolean) => { if (!startIssue) return false; if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission(); const result = await mutate(scope, current => current ? undefined : createTimerSession(startIssue.id, startIssue.subject, minutes, autoStop, scope.userId)); setSession(result.session); setStartIssue(null); if (!result.applied) onError(labels.timer_conflict ?? 'Timer session conflict.'); return result.applied; }, [labels, onError, scope, startIssue]);
  const change = useCallback(async (fn: (current: TimerSession) => TimerSession | null | undefined) => { const id = session?.sessionId; if (!id) return null; const result = await mutate(scope, current => current?.sessionId === id ? fn(current) : undefined); setSession(result.session); return result.session; }, [scope, session?.sessionId]);
  const extendTimer = useCallback((minutes: TimerIntervalMinutes) => change(current => extend(tick(current), minutes)), [change]);
  const stopTimer = useCallback(async () => { const next = await change(current => stop(tick(current))); if (!next) return null; const recording = await change(current => current ? beginRecording(current, getTabId()) : undefined); return recording?.recordingAttempt ? { origin: 'timer' as const, sessionId: recording.sessionId, issueId: recording.issueId, attemptId: recording.recordingAttempt.id, hours: recordedHours(recording) } : null; }, [change]);
  const record = useCallback(async () => { const next = await change(current => current ? beginRecording(current, getTabId()) : undefined); return next?.recordingAttempt ? { origin: 'timer' as const, sessionId: next.sessionId, issueId: next.issueId, attemptId: next.recordingAttempt.id, hours: recordedHours(next) } : null; }, [change]);
  const lifecycle = useMemo(() => ({ submitting: async (context: TimerRecordingContext) => { await change(current => current ? transitionRecording(current, context.attemptId, 'submitting') : undefined); }, validationError: async (context: TimerRecordingContext) => { await change(current => current ? transitionRecording(current, context.attemptId, 'editing') : undefined); }, cancel: async (context: TimerRecordingContext) => { await change(current => current ? clearRecording(current, context.attemptId) : undefined); }, unknown: async (context: TimerRecordingContext) => { await change(current => current ? transitionRecording(current, context.attemptId, 'unknown') : undefined); }, complete: async (context: TimerRecordingContext) => { await change(current => current?.recordingAttempt?.phase === 'submitting' && current.recordingAttempt.id === context.attemptId ? null : undefined); } }), [change]);
  return { session, startIssue, setStartIssue, open, start, extendTimer, stopTimer, record, lifecycle, elapsed: session ? elapsed(session) : 0 };
}
