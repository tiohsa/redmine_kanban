import { beginSubmission, cancelRecording, completeRecording, markUnknown, markValidationError, resolveUnknown, takeOverRecording } from './timerDomain';
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
  const confirmation = command === 'recover' || command === 'recorded' || command === 'unregistered';
  if ((!confirmation && context.ownerTabId !== tabId) || (confirmation && !expectedPhase)) return conflictResult();
  const execute = () => mutate(scope, current => {
    const attempt = current?.recordingAttempt;
    if (!current || current.sessionId !== context.sessionId || String(current.issueId) !== String(context.issueId)
      || !attempt || attempt.id !== context.attemptId || attempt.ownerTabId !== context.ownerTabId
      || (expectedPhase && attempt.phase !== expectedPhase)) return undefined;
    switch (command) {
      case 'submitting': return beginSubmission(current, context.attemptId);
      case 'validationError': return markValidationError(current, context.attemptId);
      case 'cancel': return cancelRecording(current, context.attemptId);
      case 'unknown': return markUnknown(current, context.attemptId);
      case 'complete': return completeRecording(current, context.attemptId);
      case 'close': return attempt.phase === 'editing' ? cancelRecording(current, context.attemptId) : markUnknown(current, context.attemptId);
      case 'recover': return takeOverRecording(current, context.attemptId, tabId);
      case 'recorded': case 'unregistered': return resolveUnknown(current, context.attemptId, command);
    }
  }, { absentOutcome: command === 'complete' ? 'already_completed' : 'absent' });
  let result = await execute();
  for (let retry = 0; retry < 2 && result.outcome === 'locked'; retry += 1) {
    await new Promise(resolve => setTimeout(resolve, 50 * (retry + 1)));
    result = await execute();
  }
  return result;
}
