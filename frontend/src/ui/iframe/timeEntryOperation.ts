import { buildWorkTimerTimeEntryUrl } from '../workTimer/timeEntryUrl';
import type { TimerRecordingContext } from '../workTimer/timerTypes';

export type TimeEntryOperation = Readonly<{
  issueId: number;
  url: string;
} & ({ origin: 'time_entry_on_close' } | { origin: 'work_timer'; recording: TimerRecordingContext })>;

export function createTimeEntryOperation(instanceKey: string, issueId: number): Extract<TimeEntryOperation, { origin: 'time_entry_on_close' }>;
export function createTimeEntryOperation(instanceKey: string, issueId: number, recording: TimerRecordingContext & { hours: string }): Extract<TimeEntryOperation, { origin: 'work_timer' }>;
export function createTimeEntryOperation(
  instanceKey: string,
  issueId: number,
  recording?: TimerRecordingContext & { hours: string },
): TimeEntryOperation {
  if (!Number.isSafeInteger(issueId) || issueId <= 0) throw new Error('Invalid Time Entry issue');
  if (recording && (Number(recording.issueId) !== issueId || recording.scope.instanceKey !== instanceKey)) throw new Error('Mismatched Time Entry operation');
  const issueUrl = `${instanceKey.replace(/\/$/, '')}/issues/${issueId}`;
  const url = recording ? buildWorkTimerTimeEntryUrl(instanceKey, issueId, recording.hours)
    : `${issueUrl}/time_entries/new?${new URLSearchParams({ back_url: issueUrl })}`;
  return Object.freeze(recording
    ? { origin: 'work_timer', issueId, url, recording }
    : { origin: 'time_entry_on_close', issueId, url });
}

export function timeEntryIdentity(operation: TimeEntryOperation, base = window.location.href) {
  try {
    if (!Number.isSafeInteger(operation.issueId) || operation.issueId <= 0) return null;
    const initial = new URL(operation.url, base);
    if (!['http:', 'https:'].includes(initial.protocol)) return null;
    const suffix = `/issues/${operation.issueId}/time_entries/new`;
    if (!initial.pathname.endsWith(suffix)) return null;
    return { initial, instancePath: initial.pathname.slice(0, -suffix.length) };
  } catch { return null; }
}

export function canSubmitTimeEntry(operation: TimeEntryOperation, form: HTMLFormElement, currentUrl: string) {
  const identity = timeEntryIdentity(operation);
  if (!identity) return false;
  try {
    const { initial, instancePath } = identity;
    const current = new URL(currentUrl, initial);
    const issuePath = `${instancePath}/issues/${operation.issueId}`;
    const paths = [initial.pathname, `${instancePath}/time_entries`, `${issuePath}/time_entries`, `${instancePath}/time_entries/new`];
    if (current.origin !== initial.origin || !paths.includes(current.pathname)) return false;
    const action = form.getAttribute('action');
    if (action) {
      const target = new URL(action, current);
      if (target.origin !== initial.origin || ![`${instancePath}/time_entries`, `${issuePath}/time_entries`].includes(target.pathname)) return false;
    }
    const issueFields = new FormData(form).getAll('time_entry[issue_id]');
    return issueFields.every(value => Number(value) === operation.issueId);
  } catch { return false; }
}
