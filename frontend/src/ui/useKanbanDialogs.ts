import { useCallback, useState } from 'react';
import type { TimeEntryOperation } from './iframe/timeEntryOperation';
import type { BoardData } from './types';
import { buildDefaultIssueCreateUrl, type ModalContext } from './issueDialog';
import { buildIssueTitle, resolveBoardIssue } from './kanbanShared';

type DialogRuntimeContext = {
  baseUrl: string;
  boardQueryKey: readonly unknown[];
  labels: Record<string, string>;
  projectIds: number[];
  scopeStatusIds: number[];
  dependencyStatusIds: number[];
  boardEntityLimit?: number;
};
type IframeEditContext = DialogRuntimeContext & { url: string; issueId: number; issueTitle?: string; projectId?: number };
type IframeCreateContext = DialogRuntimeContext & { url: string };
type PriorityPopupState = { issueId: number; currentId: number; x: number; y: number };
type DatePopupState = { issueId: number; currentDate: string | null; x: number; y: number };
type ProgressPopupState = { issueId: number; currentDoneRatio: number; x: number; y: number };

export function useKanbanDialogs(
  baseUrl: string,
  data: BoardData | null,
  effectiveLaneType: BoardData['meta']['lane_type'] | undefined,
  boardQueryKey: readonly unknown[] = [],
) {
  const [modal, setModal] = useState<ModalContext | null>(null);
  const [iframeEditContext, setIframeEditContext] = useState<IframeEditContext | null>(null);
  const [iframeCreateContext, setIframeCreateContext] = useState<IframeCreateContext | null>(null);
  const [iframeTimeEntryOperation, setIframeTimeEntryOperation] = useState<TimeEntryOperation | null>(null);
  const [priorityPopup, setPriorityPopup] = useState<PriorityPopupState | null>(null);
  const [datePopup, setDatePopup] = useState<DatePopupState | null>(null);
  const [progressPopup, setProgressPopup] = useState<ProgressPopupState | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const captureRuntimeContext = useCallback((): DialogRuntimeContext | null => {
    if (!data) return null;
    return {
      baseUrl,
      boardQueryKey,
      labels: data.labels,
      projectIds: data.meta.project_ids ?? [],
      scopeStatusIds: data.meta.scope_status_ids ?? [],
      dependencyStatusIds: data.meta.dependency_status_ids ?? data.meta.scope_status_ids ?? [],
      boardEntityLimit: data.meta.requested_entity_limit ?? data.meta.effective_entity_limit,
    };
  }, [baseUrl, boardQueryKey, data]);

  const openCreate = useCallback((ctx: ModalContext) => {
    if (!data) return;
    const runtimeContext = captureRuntimeContext();
    if (!runtimeContext) return;
    setIframeCreateContext({
      ...runtimeContext,
      url: buildDefaultIssueCreateUrl(baseUrl, data.meta.project_id, effectiveLaneType, ctx),
    });
  }, [baseUrl, captureRuntimeContext, data, effectiveLaneType]);

  const openIssue = useCallback((context: { url: string; issueId: number; issueTitle?: string; projectId?: number }) => {
    const runtimeContext = captureRuntimeContext();
    if (!runtimeContext) return;
    setIframeEditContext({ ...runtimeContext, ...context });
  }, [captureRuntimeContext]);

  const openEdit = useCallback((issueId: number) => {
    if (!data) return;
    const issue = resolveBoardIssue(data, issueId);
    if (!issue) return;
    openIssue({
      url: issue.issueEditUrl,
      issueId,
      issueTitle: buildIssueTitle(data, issueId),
      projectId: issue.projectId,
    });
  }, [data, openIssue]);

  const openView = useCallback((issueId: number) => {
    if (!data) return;
    const issue = resolveBoardIssue(data, issueId);
    if (!issue) return;
    openIssue({
      url: issue.issueUrl,
      issueId,
      issueTitle: buildIssueTitle(data, issueId),
      projectId: issue.projectId,
    });
  }, [data, openIssue]);

  const openIssueUrl = useCallback((urlPath: string) => {
    if (!data) return;
    const match = urlPath.match(/\/issues\/(\d+)/);
    if (!match) return;
    const issueId = parseInt(match[1], 10);
    openIssue({
      url: urlPath,
      issueId,
      issueTitle: buildIssueTitle(data, issueId),
      projectId: resolveBoardIssue(data, issueId)?.projectId,
    });
  }, [data, openIssue]);

  return {
    modal,
    setModal,
    iframeEditContext,
    setIframeEditContext,
    iframeCreateContext,
    setIframeCreateContext,
    iframeTimeEntryOperation,
    setIframeTimeEntryOperation,
    priorityPopup,
    setPriorityPopup,
    datePopup,
    setDatePopup,
    progressPopup,
    setProgressPopup,
    openCreate,
    openIssue,
    openEdit,
    openView,
    openIssueUrl,
    helpOpen,
    setHelpOpen,
  };
}
