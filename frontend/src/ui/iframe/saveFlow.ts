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
  initialUrl,
}: {
  doc: Document;
  currentUrl: string;
  saveTarget: SaveTarget;
  mode: IframeMode;
  fallbackIssueId: number;
  initialUrl?: string;
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
      const initial = new URL(initialUrl ?? `/issues/${fallbackIssueId}/time_entries/new`, 'http://redmine-kanban.local');
      const current = new URL(currentUrl, initial);
      const match = initial.pathname.match(/^(.*?)\/(?:issues\/\d+\/|projects\/[^/]+\/)?time_entries\/new\/?$/);
      if (!match || current.origin !== initial.origin) return { type: 'unknown' };
      const instancePath = match[1];
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
