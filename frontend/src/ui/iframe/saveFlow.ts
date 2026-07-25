import { extractIssueIdFromUrl } from '../utils/url';
import {
  findJournalEditForm,
  getActiveSaveForm,
  hasRedmineFormError,
  shouldTreatEditLoadAsSuccess,
  type IframeMode,
  type SaveTarget,
} from './redmineForm';

export type SaveLoadOutcome =
  | { type: 'error' }
  | { type: 'success'; issueId: number }
  | { type: 'keep-submitting' }
  | { type: 'release-submit-lock' };

export function resolveSaveLoadOutcome({
  doc,
  currentUrl,
  saveTarget,
  mode,
  fallbackIssueId,
}: {
  doc: Document;
  currentUrl: string;
  saveTarget: SaveTarget;
  mode: IframeMode;
  fallbackIssueId: number;
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
    return currentUrl.includes('/time_entries/new')
      ? { type: 'release-submit-lock' }
      : { type: 'success', issueId: fallbackIssueId };
  }
  if (saveTarget === 'journal' && !findJournalEditForm(doc)) {
    return { type: 'success', issueId: fallbackIssueId };
  }
  if (saveTarget === 'issue' && getActiveSaveForm(doc, mode, currentUrl)?.target === 'issue') {
    return { type: 'keep-submitting' };
  }
  return { type: 'release-submit-lock' };
}
