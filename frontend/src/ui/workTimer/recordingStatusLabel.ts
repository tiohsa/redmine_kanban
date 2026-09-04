import type { TimerSession } from './timerTypes';

export function recordingStatusLabel(labels: Record<string, string>, attempt: TimerSession['recordingAttempt']): string | null {
  switch (attempt?.phase) {
    case 'editing': return labels.timer_editing ?? 'Entering work time';
    case 'submitting': return labels.timer_submitting ?? 'Recording work time';
    case 'unknown': return labels.timer_unknown ?? 'Could not confirm whether work time was recorded.';
    default: return null;
  }
}
