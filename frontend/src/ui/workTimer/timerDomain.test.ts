import { describe, expect, it } from 'vitest';
import { beginRecording, createTimerSession, elapsed, extend, stop, tick } from './timerDomain';

describe('work timer domain', () => {
  it('auto-stops exactly at its deadline and retains the recorded segment', () => {
    const session = createTimerSession(1, 'Issue', 5, true, 10, 1_000);
    const next = tick(session, 301_500);
    expect(next.state).toBe('stopped_pending_record');
    expect(elapsed(next, 999_999)).toBe(300_000);
  });

  it('keeps pending work while recording and resumes as a separate segment', () => {
    const started = createTimerSession(1, 'Issue', 5, false, 10, 1_000);
    const stopped = stop(started, 61_000);
    const recording = beginRecording(stopped, 'tab', 62_000);
    expect(recording?.recordingAttempt?.phase).toBe('editing');
    expect(extend(stopped, 10, 100_000).segments).toEqual([{ startedAt: 1_000, stoppedAt: 61_000 }, { startedAt: 100_000 }]);
  });
});
