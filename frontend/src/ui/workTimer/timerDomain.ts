import type { TimerIntervalMinutes, TimerSegment, TimerSession } from './timerTypes';
export const TIMER_SESSION_VERSION = 4;
export const timerId = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `timer_${Date.now()}_${Math.random().toString(36).slice(2)}`;
export function createTimerSession(issueId: number, subject: string, minutes: TimerIntervalMinutes, autoStop: boolean, userId: number, now = Date.now()): TimerSession { return { version: TIMER_SESSION_VERSION, sessionId: timerId(), revision: 1, issueId, subject, autoStop, deadlineAt: now + minutes * 60000, segments: [{ startedAt: now }], state: 'running', userId, createdAt: now, updatedAt: now }; }
export function elapsed(session: TimerSession, now = Date.now()) { return session.segments.reduce((total, segment) => total + Math.max(0, (segment.stoppedAt ?? now) - segment.startedAt), 0); }
export function remaining(session: TimerSession, now = Date.now()) { return session.state === 'stopped_pending_record' || !session.deadlineAt ? 0 : Math.max(0, session.deadlineAt - now); }
export function recordedHours(session: TimerSession) { return (Math.round(elapsed(session) / 36000) / 100).toFixed(2); }
export function tick(session: TimerSession, now = Date.now()): TimerSession { if (session.state !== 'running' || !session.deadlineAt || now < session.deadlineAt) return session; const notifiedType = session.autoStop ? 'stopped' : 'running_expired'; if (!session.autoStop) return { ...session, state: 'expired', notifiedDeadlineAt: session.deadlineAt, notifiedType, updatedAt: now }; const segments = session.segments.map((segment, index) => index === session.segments.length - 1 && !segment.stoppedAt ? { ...segment, stoppedAt: session.deadlineAt } : segment); return { ...session, state: 'stopped_pending_record', segments, notifiedDeadlineAt: session.deadlineAt, notifiedType, updatedAt: now }; }
export function stop(session: TimerSession, now = Date.now()): TimerSession { if (session.state === 'stopped_pending_record') return session; const segments: TimerSegment[] = session.segments.map((segment, index) => index === session.segments.length - 1 && !segment.stoppedAt ? { ...segment, stoppedAt: now } : segment); return { ...session, state: 'stopped_pending_record', segments, updatedAt: now }; }
export function extend(session: TimerSession, minutes: TimerIntervalMinutes, now = Date.now()): TimerSession { if (session.recordingAttempt) return session; if (session.state === 'stopped_pending_record') return { ...session, state: 'running', segments: [...session.segments, { startedAt: now }], deadlineAt: now + minutes * 60000, updatedAt: now }; return { ...session, state: 'running', deadlineAt: (session.state === 'running' ? session.deadlineAt ?? now : now) + minutes * 60000, updatedAt: now }; }
export function beginRecording(session: TimerSession, ownerTabId: string, now = Date.now()): TimerSession | undefined { if (session.state !== 'stopped_pending_record' || session.recordingAttempt) return undefined; return { ...session, recordingAttempt: { id: timerId(), ownerTabId, openedAt: now, phase: 'editing' }, updatedAt: now }; }
function updateRecording(session: TimerSession, attemptId: string, from: 'editing' | 'submitting' | 'unknown', phase: 'editing' | 'submitting' | 'unknown'): TimerSession | undefined {
  if (!session.recordingAttempt || session.recordingAttempt.id !== attemptId || session.recordingAttempt.phase !== from) return undefined;
  return { ...session, recordingAttempt: { ...session.recordingAttempt, phase }, updatedAt: Date.now() };
}
function clearRecording(session: TimerSession, attemptId: string, phase: 'editing' | 'unknown'): TimerSession | undefined {
  if (!session.recordingAttempt || session.recordingAttempt.id !== attemptId || session.recordingAttempt.phase !== phase) return undefined;
  const next = { ...session };
  delete next.recordingAttempt;
  return { ...next, updatedAt: Date.now() };
}
export const beginSubmission = (session: TimerSession, attemptId: string) => updateRecording(session, attemptId, 'editing', 'submitting');
export const markValidationError = (session: TimerSession, attemptId: string) => updateRecording(session, attemptId, 'submitting', 'editing');
export const markUnknown = (session: TimerSession, attemptId: string) => updateRecording(session, attemptId, 'submitting', 'unknown');
export const cancelRecording = (session: TimerSession, attemptId: string) => clearRecording(session, attemptId, 'editing');
export const completeRecording = (session: TimerSession, attemptId: string) => session.recordingAttempt?.id === attemptId && session.recordingAttempt.phase === 'submitting' ? null : undefined;
export const resolveUnknown = (session: TimerSession, attemptId: string, resolution: 'recorded' | 'unregistered') => resolution === 'recorded' ? (session.recordingAttempt?.id === attemptId && session.recordingAttempt.phase === 'unknown' ? null : undefined) : clearRecording(session, attemptId, 'unknown');
export function recoverRecording(session: TimerSession, ownerTabId: string): TimerSession | undefined {
  const attempt = session.recordingAttempt;
  if (!attempt) return undefined;
  if (attempt.phase === 'submitting') return { ...session, recordingAttempt: { ...attempt, phase: 'unknown' }, updatedAt: Date.now() };
  if (attempt.phase === 'editing' && attempt.ownerTabId === ownerTabId) return clearRecording(session, attempt.id, 'editing');
  return undefined;
}
