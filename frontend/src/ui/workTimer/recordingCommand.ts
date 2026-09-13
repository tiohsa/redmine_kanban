import { beginSubmission, cancelRecording, cleanupConfirmedRecording, completeRecording, markUnknown, markValidationError, resolveUnknown, takeOverRecording } from './timerDomain';
import { getTabId, mutate, type TimerMutationResult, type TimerScope } from './timerStorage';
import type { TimerRecordingContext, TimerRecordingPhase, TimerSession } from './timerTypes';

export type RecordingCommand = 'submitting' | 'validationError' | 'cancel' | 'unknown' | 'close' | 'complete' | 'recover' | 'recorded' | 'unregistered';
export const conflictResult = (): TimerMutationResult => ({ outcome: 'semantic_conflict', session: null, applied: false, lock: 'acquired' });

export function recordingContext(scope: TimerScope, session: TimerSession): TimerRecordingContext | null {
  const attempt = session.recordingAttempt;
  return attempt ? { origin: 'timer', scope: { ...scope }, sessionId: session.sessionId, issueId: session.issueId, attemptId: attempt.id, ownerTabId: attempt.ownerTabId } : null;
}

export async function runRecordingCommand(scope: TimerScope, context: TimerRecordingContext, command: RecordingCommand, expectedPhase?: TimerRecordingPhase): Promise<TimerMutationResult> {
  if (context.scope.instanceKey !== scope.instanceKey || context.scope.userId !== scope.userId) return conflictResult();
  const tabId = getTabId();
  const confirmation = command === 'recover' || command === 'recorded' || command === 'unregistered' || (command === 'complete' && expectedPhase !== undefined);
  if ((!confirmation && context.ownerTabId !== tabId) || (confirmation && !expectedPhase)) return conflictResult();
  const execute = () => mutate(scope, current => {
    const attempt = current?.recordingAttempt;
    if (!current || current.sessionId !== context.sessionId || String(current.issueId) !== String(context.issueId)
      || !attempt || attempt.id !== context.attemptId || attempt.ownerTabId !== context.ownerTabId
      || (expectedPhase && attempt.phase !== expectedPhase)) return undefined;
    switch (command) {
      case 'submitting': return beginSubmission(current, context.attemptId);
      case 'validationError': return attempt.phase === 'editing' ? current : markValidationError(current, context.attemptId);
      case 'cancel': return cancelRecording(current, context.attemptId);
      case 'unknown': return attempt.phase === 'unknown' ? current : markUnknown(current, context.attemptId);
      case 'complete': return completeRecording(current, context.attemptId);
      case 'close':
        if (attempt.phase === 'editing') return cancelRecording(current, context.attemptId);
        if (attempt.phase === 'submitting') return markUnknown(current, context.attemptId);
        if (attempt.phase === 'unknown' || attempt.phase === 'confirmed') return current;
        return undefined;
      case 'recover': return takeOverRecording(current, context.attemptId, tabId);
      case 'recorded': case 'unregistered': return resolveUnknown(current, context.attemptId, command);
    }
  }, { absentOutcome: command === 'complete' ? 'already_completed' : 'absent', unchangedOutcome: command === 'close' || command === 'unknown' || command === 'complete' || command === 'validationError' ? 'already_satisfied' : undefined, requireStrongLock: true });
  const executeWithRetry = async () => {
    let result = await execute();
    for (let retry = 0; retry < 2 && result.outcome === 'locked'; retry += 1) {
      await new Promise(resolve => setTimeout(resolve, 50 * (retry + 1)));
      result = await execute();
    }
    return result;
  };
  const result = await executeWithRetry();
  if (command !== 'complete' || !result.session?.recordingAttempt || result.session.recordingAttempt.phase !== 'confirmed') return result;

  const cleanup = () => mutate(scope, current => {
    if (!current || current.sessionId !== context.sessionId || String(current.issueId) !== String(context.issueId)
      || !current.recordingAttempt || current.recordingAttempt.id !== context.attemptId
      || current.recordingAttempt.ownerTabId !== context.ownerTabId
      || current.recordingAttempt.phase !== 'confirmed') return undefined;
    return cleanupConfirmedRecording(current, context.attemptId);
  }, { absentOutcome: 'already_completed', requireStrongLock: true });
  let cleanupResult = await cleanup();
  for (let retry = 0; retry < 2 && cleanupResult.outcome === 'locked'; retry += 1) {
    await new Promise(resolve => setTimeout(resolve, 50 * (retry + 1)));
    cleanupResult = await cleanup();
  }
  return cleanupResult;
}
