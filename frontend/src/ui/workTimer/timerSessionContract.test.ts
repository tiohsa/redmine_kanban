// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/timer-session-v4.json';
import { beginRecording, beginSubmission, completeRecording, createTimerSession, markUnknown, stop } from './timerDomain';
import { isTimerSession } from './timerStorage';
import { recordingContext, runRecordingCommand } from './recordingCommand';
import type { TimerRecordingPhase, TimerSession } from './timerTypes';

const canvasGanttV4Phases = ['editing', 'submitting', 'confirmed', 'unknown'] as const;
const isCanvasGanttV4Readable = (value: unknown): boolean => {
  // Keep this reader contract independent from the Kanban validator so schema drift fails here.
  if (!value || typeof value !== 'object') return false;
  const session = value as Record<string, unknown>;
  if (session.version !== 4 || typeof session.sessionId !== 'string' || !session.sessionId.trim()
    || !Number.isInteger(session.revision) || (session.revision as number) < 1
    || (typeof session.issueId !== 'number' && typeof session.issueId !== 'string')
    || !Number.isSafeInteger(Number(session.issueId)) || Number(session.issueId) <= 0
    || typeof session.subject !== 'string' || typeof session.autoStop !== 'boolean'
    || typeof session.createdAt !== 'number' || !Number.isFinite(session.createdAt)
    || typeof session.updatedAt !== 'number' || !Number.isFinite(session.updatedAt)
    || !['running', 'expired', 'stopped_pending_record'].includes(String(session.state))
    || !Array.isArray(session.segments) || session.segments.length === 0) return false;
  if (session.recordingAttempt === undefined) return true;
  if (session.state !== 'stopped_pending_record' || !session.recordingAttempt || typeof session.recordingAttempt !== 'object') return false;
  const attempt = session.recordingAttempt as Record<string, unknown>;
  return typeof attempt.id === 'string' && attempt.id.trim().length > 0
    && typeof attempt.ownerTabId === 'string' && attempt.ownerTabId.trim().length > 0
    && typeof attempt.openedAt === 'number' && Number.isFinite(attempt.openedAt)
    && typeof attempt.phase === 'string' && canvasGanttV4Phases.includes(attempt.phase as typeof canvasGanttV4Phases[number]);
};

const toJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe('Kanban / Canvas Gantt TimerSession v4 contract', () => {
  it('accepts every shared v4 recording phase in both readers', () => {
    for (const candidate of fixture.sessions) {
      expect(isTimerSession(candidate), candidate.recordingAttempt.phase).toBe(true);
      expect(isCanvasGanttV4Readable(candidate), candidate.recordingAttempt.phase).toBe(true);
    }
  });

  it('emits Canvas Gantt-readable sessions for every phase without changing version 4', () => {
    const stopped = stop(createTimerSession(101, 'Contract fixture', 5, false, 7, 1700000000000), 1700000060000);
    const editing = beginRecording(stopped, 'kanban-tab', 1700000061000)!;
    const sessions: Record<TimerRecordingPhase, TimerSession> = {
      editing,
      submitting: beginSubmission(editing, editing.recordingAttempt!.id)!,
      confirmed: completeRecording(beginSubmission(editing, editing.recordingAttempt!.id)!, editing.recordingAttempt!.id)!,
      unknown: markUnknown(beginSubmission(editing, editing.recordingAttempt!.id)!, editing.recordingAttempt!.id)!,
    };

    for (const session of Object.values(sessions)) {
      expect(session.version).toBe(4);
      expect(isCanvasGanttV4Readable(toJson(session)), session.recordingAttempt?.phase).toBe(true);
    }
  });

  it('keeps confirmed sessions readable and non-submittable', async () => {
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, callback: () => unknown) => callback() } });
    const confirmed = fixture.sessions.find(candidate => candidate.recordingAttempt.phase === 'confirmed')!;
    const session = toJson(confirmed) as TimerSession;
    expect(isTimerSession(session)).toBe(true);
    const result = await runRecordingCommand(
      { instanceKey: 'https://example.test/redmine', userId: 7 },
      recordingContext({ instanceKey: 'https://example.test/redmine', userId: 7 }, session)!,
      'submitting',
    );
    expect(result.outcome).toBe('semantic_conflict');
  });

  it('rejects malformed phase data without treating it as an absent session', () => {
    const malformed = { ...fixture.sessions[2], recordingAttempt: { ...fixture.sessions[2].recordingAttempt, phase: 'invalid' } };
    expect(isTimerSession(malformed)).toBe(false);
    expect(isCanvasGanttV4Readable(malformed)).toBe(false);
  });
});
