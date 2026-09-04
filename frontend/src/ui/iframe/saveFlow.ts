import { timeEntryIdentity, type TimeEntryOperation } from './timeEntryOperation';
import { extractIssueIdFromUrl } from '../utils/url';
import {
  findJournalEditForm,
  getActiveSaveForm,
  hasRedmineFormError,
  hasRedmineSuccessNotice,
  shouldTreatEditLoadAsSuccess,
  type IframeMode,
  type SaveTarget,
} from './redmineForm';

export type SaveLoadOutcome =
  | { type: 'error' }
  | { type: 'success'; issueId: number }
  | { type: 'unknown' }
  | { type: 'keep-submitting' }
  | { type: 'release-submit-lock' };

export function resolveSaveLoadOutcome({
  doc,
  currentUrl,
  saveTarget,
  mode,
  fallbackIssueId,
  operation,
}: {
  doc: Document;
  currentUrl: string;
  saveTarget: SaveTarget;
  mode: IframeMode;
  fallbackIssueId: number;
  operation?: TimeEntryOperation;
}): SaveLoadOutcome {
  if (hasRedmineFormError(doc)) return { type: 'error' };

  if (saveTarget === 'new-issue') {
    const issueId = extractIssueIdFromUrl(currentUrl);
    return issueId ? { type: 'success', issueId } : { type: 'release-submit-lock' };
  }
  if (saveTarget === 'issue' && shouldTreatEditLoadAsSuccess(currentUrl, doc)) {
    return { type: 'success', issueId: extractIssueIdFromUrl(currentUrl) ?? fallbackIssueId };
  }
  if (saveTarget === 'time_entry') {
    // Allow only confirmed Redmine outcomes. Login, error, plugin, and other
    // unexpected pages must not delete a possibly unrecorded TimerSession.
    try {
      if (!operation) return { type: 'unknown' };
      const identity = timeEntryIdentity(operation);
      if (!identity || operation.issueId !== fallbackIssueId) return { type: 'unknown' };
      const { initial, instancePath } = identity;
      const current = new URL(currentUrl, initial);
      if (current.origin !== initial.origin) return { type: 'unknown' };
      const issuePath = `${instancePath}/issues/${fallbackIssueId}`;
      if (current.pathname === issuePath) return { type: 'success', issueId: fallbackIssueId };
      const newFormPaths = [initial.pathname, `${instancePath}/time_entries/new`, `${issuePath}/time_entries/new`];
      if (newFormPaths.includes(current.pathname) && hasRedmineSuccessNotice(doc)) return { type: 'success', issueId: fallbackIssueId };
    } catch { /* Invalid or unexpected URLs leave the recording result unknown. */ }
    return { type: 'unknown' };
  }
  if (saveTarget === 'journal' && !findJournalEditForm(doc)) {
    return { type: 'success', issueId: fallbackIssueId };
  }
  if (saveTarget === 'issue' && getActiveSaveForm(doc, mode, currentUrl)?.target === 'issue') {
    return { type: 'keep-submitting' };
  }
  return { type: 'release-submit-lock' };
}
