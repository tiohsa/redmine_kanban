import { useCallback, useState } from 'react';
import type { BoardData } from './types';
import { buildDefaultIssueCreateUrl, type ModalContext } from './issueDialog';
import { resolveBoardIssue } from './kanbanShared';

type IframeEditContext = { url: string; issueId: number; issueTitle?: string };
type PriorityPopupState = { issueId: number; currentId: number; x: number; y: number };
type DatePopupState = { issueId: number; currentDate: string | null; x: number; y: number };

function buildIssueTitle(data: BoardData | null, issueId: number): string | undefined {
  if (!data) return undefined;

  const issue = resolveBoardIssue(data, issueId);
  if (!issue) return undefined;

  if (issue.kind === 'subtask') {
    return `#${issueId} ${issue.subject}`.trim();
  }

  const trackerName = data.lists.trackers.find((tracker) => tracker.id === issue.trackerId)?.name ?? '';
  return `${trackerName} #${issueId} ${issue.subject}`.trim();
}

export function useKanbanDialogs(
  baseUrl: string,
  data: BoardData | null,
  effectiveLaneType: BoardData['meta']['lane_type'] | undefined,
) {
  const [modal, setModal] = useState<ModalContext | null>(null);
  const [iframeEditContext, setIframeEditContext] = useState<IframeEditContext | null>(null);
  const [iframeCreateUrl, setIframeCreateUrl] = useState<string | null>(null);
  const [iframeTimeEntryUrl, setIframeTimeEntryUrl] = useState<string | null>(null);
  const [priorityPopup, setPriorityPopup] = useState<PriorityPopupState | null>(null);
  const [datePopup, setDatePopup] = useState<DatePopupState | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const openCreate = useCallback((ctx: ModalContext) => {
    setIframeCreateUrl(buildDefaultIssueCreateUrl(baseUrl, data?.meta.project_id, effectiveLaneType, ctx));
  }, [baseUrl, data?.meta.project_id, effectiveLaneType]);

  const openEdit = useCallback((issueId: number) => {
    if (!data) return;
    const issue = resolveBoardIssue(data, issueId);
    if (!issue) return;
    setIframeEditContext({
      url: issue.issueEditUrl,
      issueId,
      issueTitle: buildIssueTitle(data, issueId),
    });
  }, [data]);

  const openView = useCallback((issueId: number) => {
    if (!data) return;
    const issue = resolveBoardIssue(data, issueId);
    if (!issue) return;
    setIframeEditContext({
      url: issue.issueUrl,
      issueId,
      issueTitle: buildIssueTitle(data, issueId),
    });
  }, [data]);

  const openIssueUrl = useCallback((urlPath: string) => {
    const match = urlPath.match(/\/issues\/(\d+)/);
    if (!match) return;
    const issueId = parseInt(match[1], 10);
    setIframeEditContext({
      url: urlPath,
      issueId,
      issueTitle: buildIssueTitle(data, issueId),
    });
  }, [data]);

  return {
    modal,
    setModal,
    iframeEditContext,
    setIframeEditContext,
    iframeCreateUrl,
    setIframeCreateUrl,
    iframeTimeEntryUrl,
    setIframeTimeEntryUrl,
    priorityPopup,
    setPriorityPopup,
    datePopup,
    setDatePopup,
    openCreate,
    openEdit,
    openView,
    openIssueUrl,
    helpOpen,
    setHelpOpen,
  };
}
