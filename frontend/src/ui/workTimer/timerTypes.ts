export type TimerIntervalMinutes = 5 | 10 | 15 | 30 | 60;
export const TIMER_INTERVAL_MINUTES: TimerIntervalMinutes[] = [5, 10, 15, 30, 60];
export type TimerState = 'running' | 'expired' | 'stopped_pending_record';
export const TIMER_RECORDING_PHASES = ['editing', 'submitting', 'confirmed', 'unknown'] as const;
export type TimerRecordingPhase = (typeof TIMER_RECORDING_PHASES)[number];
export function isTimerRecordingPhase(value: unknown): value is TimerRecordingPhase {
  return typeof value === 'string' && TIMER_RECORDING_PHASES.includes(value as TimerRecordingPhase);
}
export type TimerRecordingResolution = 'recorded' | 'unregistered';
export type TimerSegment = { startedAt: number; stoppedAt?: number };
export type TimerRecordingAttempt = { id: string; ownerTabId: string; openedAt: number; phase: TimerRecordingPhase };
export type TimerSession = { version: number; sessionId: string; revision: number; issueId: number | string; subject: string; autoStop: boolean; deadlineAt?: number; segments: TimerSegment[]; state: TimerState; notifiedDeadlineAt?: number; notifiedType?: 'running_expired' | 'stopped'; recordingAttempt?: TimerRecordingAttempt; userId?: number; createdAt: number; updatedAt: number };
export type TimerRecordingContext = { origin: 'timer'; scope: { instanceKey: string; userId: number }; sessionId: string; issueId: number | string; attemptId: string; ownerTabId: string };
export type TimerPreferences = { autoStop: boolean };
