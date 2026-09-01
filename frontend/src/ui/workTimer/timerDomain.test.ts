import { describe, expect, it } from 'vitest';
import { beginRecording, beginSubmission, cancelRecording, completeRecording, createTimerSession, elapsed, extend, markUnknown, markValidationError, recoverRecording, resolveUnknown, stop, tick } from './timerDomain';

describe('work timer domain', () => {
  it('auto-stops exactly at its deadline and retains the recorded segment', () => {
    const session = createTimerSession(1, 'Issue', 5, true, 10, 1_000);
    const next = tick(session, 301_500);
    expect(next.state).toBe('stopped_pending_record');
    expect(elapsed(next, 999_999)).toBe(300_000);
    expect(next).toMatchObject({ notifiedDeadlineAt: 301_000, notifiedType: 'stopped' });
  });

  it('keeps pending work while recording and resumes as a separate segment', () => {
    const started = createTimerSession(1, 'Issue', 5, false, 10, 1_000);
    const stopped = stop(started, 61_000);
    const recording = beginRecording(stopped, 'tab', 62_000);
    expect(recording?.recordingAttempt?.phase).toBe('editing');
    expect(extend(stopped, 10, 100_000).segments).toEqual([{ startedAt: 1_000, stoppedAt: 61_000 }, { startedAt: 100_000 }]);
  });

  it('only permits the recording state machine transitions', () => {
    const stopped = stop(createTimerSession(1, 'Issue', 5, false, 10, 1_000), 61_000);
    const editing = beginRecording(stopped, 'tab', 62_000)!;
    expect(cancelRecording(editing, editing.recordingAttempt!.id)).toBeDefined();
    expect(completeRecording(editing, editing.recordingAttempt!.id)).toBeUndefined();
    const submitting = beginSubmission(editing, editing.recordingAttempt!.id)!;
    expect(cancelRecording(submitting, submitting.recordingAttempt!.id)).toBeUndefined();
    expect(markValidationError(submitting, submitting.recordingAttempt!.id)?.recordingAttempt?.phase).toBe('editing');
    const unknown = markUnknown(submitting, submitting.recordingAttempt!.id)!;
    expect(beginSubmission(unknown, unknown.recordingAttempt!.id)).toBeUndefined();
    expect(resolveUnknown(unknown, unknown.recordingAttempt!.id, 'unregistered')?.recordingAttempt).toBeUndefined();
    expect(resolveUnknown(unknown, unknown.recordingAttempt!.id, 'recorded')).toBeNull();
    expect(completeRecording(submitting, submitting.recordingAttempt!.id)).toBeNull();
  });

  it('recovers a local editing attempt but preserves another tab and marks submits unknown', () => {
    const stopped = stop(createTimerSession(1, 'Issue', 5, false, 10, 1_000), 61_000);
    const localEditing = beginRecording(stopped, 'tab-a', 62_000)!;
    expect(recoverRecording(localEditing, 'tab-a')?.recordingAttempt).toBeUndefined();
    expect(recoverRecording(localEditing, 'tab-b')).toBeUndefined();
    const submitting = beginSubmission(localEditing, localEditing.recordingAttempt!.id)!;
    expect(recoverRecording(submitting, 'tab-a')?.recordingAttempt?.phase).toBe('unknown');
  });
});
