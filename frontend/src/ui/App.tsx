import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BoardApiResponse, BoardData, Issue } from './types';
import { getJson, isHttpError } from './http';
import { CanvasBoard, type CanvasBoardHandle } from './board/CanvasBoard';
import { buildBoardState } from './board/state';
import { applyBoardDataFilters, buildPresentationProjection, buildVisibleIssues, resolveCreateStatusId, resolvePreferredTrackerId } from './boardFilters';
import { buildBoardDataUrl, buildBoardQueryKey, effectiveDependencyStatusIds, effectiveScopeStatusIds } from './boardQuery';
import { IframeEditDialog } from './IframeEditDialog';
import { KanbanIssueModal } from './KanbanIssueModal';
import { KanbanPopupHost } from './KanbanPopupHost';
import { DatePopup, PriorityPopup, ProgressPopup } from './KanbanPopups';
import { KanbanToolbar } from './KanbanToolbar';
import { HelpDialog } from './HelpDialog';
import { buildDisplayData, buildIssueTitle, normalizeBoardData, payloadFieldError, payloadMessage, resolveMutationError } from './kanbanShared';
import { findIssueInBoard } from './kanbanShared';
import { useKanbanActions } from './useKanbanActions';
import { invalidateBoardSnapshot } from './useIssueMutation';
import { useKanbanDialogs } from './useKanbanDialogs';
import { useKanbanPreferences } from './useKanbanPreferences';
import { useWorkTimer } from './workTimer/useWorkTimer';
import { GlobalTimer, OtherNoticeModal, TimerStartModal } from './workTimer/WorkTimer';
import { createTimeEntryOperation, type TimeEntryOperation } from './iframe/timeEntryOperation';

type Props = { dataUrl: string; initialCurrentUserId: number; initialLabels?: Record<string, string> };

export function findIssueForAction(data: BoardData, issueId: number): Issue | null {
  return findIssueInBoard(data, issueId);
}

export function normalizeProjectIds(projectIds: number[], allowedProjectIds: Set<number>): number[] {
  return projectIds.filter((projectId) => allowedProjectIds.has(projectId));
}

export function normalizeAssigneeIds(assigneeIds: string[], allowedAssigneeIds: Set<string>): string[] {
  return assigneeIds.filter((assigneeId) => assigneeId === 'unassigned' || allowedAssigneeIds.has(assigneeId));
}

export function normalizeTrackerIds(trackerIds: number[], allowedTrackerIds: Set<number>): number[] {
  return trackerIds.filter((trackerId) => allowedTrackerIds.has(trackerId));
}

export function resolveDefaultCreateProjectId(
  selectedProjectIds: number[],
  creatableProjectIds: Set<number>,
  fallbackProjectId: number | undefined,
): number | null {
  const selectedCreatableProjectId = selectedProjectIds.find((projectId) => creatableProjectIds.has(projectId));
  if (selectedCreatableProjectId) return selectedCreatableProjectId;
  if (fallbackProjectId && creatableProjectIds.has(fallbackProjectId)) return fallbackProjectId;
  return null;
}

export function canCreateInBoard(projectId: number | null, statusId: number | undefined): boolean {
  return projectId !== null && statusId !== undefined;
}

export function App({ dataUrl, initialCurrentUserId, initialLabels = {} }: Props) {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const boardRef = useRef<CanvasBoardHandle>(null);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const dismissError = useCallback(() => setError(null), []);
  const [workTimeEntry, setWorkTimeEntry] = useState<Extract<TimeEntryOperation, { origin: 'work_timer' }> | null>(null);

  const {
    projectScope,
    filters,
    setFilters,
    fullWindow,
    setFullWindow,
    fitMode,
    setFitMode,
    showSubtasks,
    setShowSubtasks,
    sortKey,
    setSortKey,
    hiddenStatusIds,
    setHiddenStatusIds,
    fontSize,
    setFontSize,
    timeEntryOnClose,
    setTimeEntryOnClose,
    laneType,
    setLaneType,
    agingWarnDays,
    setAgingWarnDays,
    agingDangerDays,
    setAgingDangerDays,
    agingExcludeClosed,
    setAgingExcludeClosed,
    viewableProjectsEnabled,
    setViewableProjectsEnabled,
    maximumBoardEntityCount,
    setMaximumBoardEntityCount,
    preferencesReady,
  } = useKanbanPreferences(dataUrl, initialCurrentUserId);

  const baseUrl = useMemo(() => projectScope, [projectScope]);
  const boardQueryKey = useMemo(
    () => buildBoardQueryKey(baseUrl, filters.projectIds, filters.statusIds, hiddenStatusIds, maximumBoardEntityCount),
    [baseUrl, filters.projectIds, filters.statusIds, hiddenStatusIds, maximumBoardEntityCount],
  );

  const boardQuery = useQuery({
    queryKey: boardQueryKey,
    queryFn: async () => normalizeBoardData(
      await getJson<BoardApiResponse>(buildBoardDataUrl(baseUrl, filters.projectIds, filters.statusIds, hiddenStatusIds, maximumBoardEntityCount)),
    ),
    retry: false,
    enabled: preferencesReady,
  });

  const data = boardQuery.data ?? null;
  const timerInstanceKey = useMemo(() => {
    const pathname = new URL(dataUrl, window.location.origin).pathname;
    const projectIndex = pathname.indexOf('/projects/');
    return `${window.location.origin}${projectIndex >= 0 ? pathname.slice(0, projectIndex) : ''}`;
  }, [dataUrl]);
  const timerScope = useMemo(() => ({ instanceKey: timerInstanceKey, userId: data?.meta.current_user_id ?? initialCurrentUserId }), [data?.meta.current_user_id, initialCurrentUserId, timerInstanceKey]);
  const workTimer = useWorkTimer({ scope: timerScope, labels: data?.labels ?? initialLabels, onError: setError });

  const loading = boardQuery.isLoading;
  const labels = data?.labels;
  const emptyBoardData = useMemo<BoardData>(() => ({
    ok: true,
    contract_version: 3,
    scope_fingerprint: `pending:${baseUrl}`,
    meta: {
      project_id: 0,
      project_ids: [],
      scope_status_ids: [],
      current_user_id: 0,
      can_move: false,
      can_create: false,
      can_delete: false,
      lane_type: 'assignee',
      aging_warn_days: agingWarnDays,
      aging_danger_days: agingDangerDays,
      aging_exclude_closed: agingExcludeClosed,
      complete: false,
      entity_count: 0,
      requested_entity_limit: maximumBoardEntityCount,
      effective_entity_limit: maximumBoardEntityCount,
      server_entity_limit: 5000,
    },
    columns: [],
    lanes: [],
    lists: { assignees: [], trackers: [], priorities: [], projects: [], viewable_projects: [], creatable_projects: [] },
    issues: [],
    labels: initialLabels,
  }), [agingDangerDays, agingExcludeClosed, agingWarnDays, baseUrl, initialLabels, maximumBoardEntityCount]);
  const toolbarData = data ?? emptyBoardData;
  const suppressNextBoardErrorRef = useRef(false);

  useEffect(() => {
    if (!boardQuery.error) {
      if (boardQuery.data) suppressNextBoardErrorRef.current = false;
      return;
    }
    if (suppressNextBoardErrorRef.current) {
      suppressNextBoardErrorRef.current = false;
      return;
    }
    const payload = isHttpError<{ error?: { code?: string; requested_entity_limit?: number; effective_entity_limit?: number; server_entity_limit?: number; count_at_least?: number; maximum_response_bytes?: number } }>(boardQuery.error)
      ? boardQuery.error.payload
      : null;
    const boardError = payload?.error;
    if (boardError?.code === 'BOARD_SCOPE_TOO_LARGE') {
      const limit = boardError.effective_entity_limit ?? boardError.requested_entity_limit ?? maximumBoardEntityCount;
      const serverSuffix = boardError.server_entity_limit && boardError.requested_entity_limit && boardError.requested_entity_limit > boardError.server_entity_limit
        ? ` ${toolbarData.labels.board_server_limit_suffix.replace('%{limit}', boardError.server_entity_limit.toLocaleString())}`
        : '';
      setError(toolbarData.labels.board_scope_too_large.replace('%{limit}', limit.toLocaleString()) + serverSuffix);
    } else if (boardError?.code === 'BOARD_RESPONSE_TOO_LARGE') {
      setError(toolbarData.labels.board_response_too_large.replace('%{bytes}', (boardError.maximum_response_bytes ?? 0).toLocaleString()));
    } else {
      setError(toolbarData.labels.load_failed);
    }
  }, [boardQuery.data, boardQuery.error, maximumBoardEntityCount, toolbarData.labels]);

  const refresh = useCallback(async (options: { suppressError?: boolean } = {}) => {
    if (options.suppressError) suppressNextBoardErrorRef.current = true;
    await queryClient.invalidateQueries({ queryKey: boardQueryKey });
  }, [boardQueryKey, queryClient]);

  const displayData = useMemo(() => {
    if (!data) return null;
    return buildDisplayData(data, laneType, { warnDays: agingWarnDays, dangerDays: agingDangerDays, excludeClosed: agingExcludeClosed });
  }, [agingDangerDays, agingExcludeClosed, agingWarnDays, data, laneType]);

  const projectOptions = useMemo(
    () => (viewableProjectsEnabled ? data?.lists.viewable_projects : data?.lists.projects) ?? [],
    [data, viewableProjectsEnabled],
  );
  const allowedProjectIds = useMemo(() => new Set(projectOptions.map((project) => project.id)), [projectOptions]);
  const allowedAssigneeIds = useMemo(
    () => new Set((data?.lists.assignees ?? []).filter((assignee) => assignee.id !== null).map((assignee) => String(assignee.id))),
    [data],
  );
  const allowedTrackerIds = useMemo(
    () => new Set((data?.lists.trackers ?? []).map((tracker) => tracker.id)),
    [data],
  );
  const creatableProjectIds = useMemo(
    () => new Set((data?.lists.creatable_projects ?? []).map((project) => project.id)),
    [data],
  );

  useEffect(() => {
    if (!data) return;
    const normalizedProjectIds = normalizeProjectIds(filters.projectIds, allowedProjectIds);
    if (normalizedProjectIds.length === filters.projectIds.length) return;
    setFilters((previous) => ({ ...previous, projectIds: normalizedProjectIds }));
  }, [allowedProjectIds, data, filters.projectIds, setFilters]);

  useEffect(() => {
    if (!data) return;
    const normalizedAssigneeIds = normalizeAssigneeIds(filters.assigneeIds, allowedAssigneeIds);
    if (normalizedAssigneeIds.length === filters.assigneeIds.length) return;
    setFilters((previous) => ({ ...previous, assigneeIds: normalizedAssigneeIds }));
  }, [allowedAssigneeIds, data, filters.assigneeIds, setFilters]);

  useEffect(() => {
    if (!data) return;
    const normalizedTrackerIds = normalizeTrackerIds(filters.trackerIds, allowedTrackerIds);
    if (normalizedTrackerIds.length === filters.trackerIds.length) return;
    setFilters((previous) => ({ ...previous, trackerIds: normalizedTrackerIds }));
  }, [allowedTrackerIds, data, filters.trackerIds, setFilters]);

  const effectiveLaneType = displayData?.meta.lane_type;
  const dialogs = useKanbanDialogs(baseUrl, data, effectiveLaneType, boardQueryKey);
  const actions = useKanbanActions({
    baseUrl,
    boardQueryKey,
    data,
    refresh,
    timeEntryOnClose,
    isWorkTimerIssue: (issueId) => String(workTimer.session?.issueId) === String(issueId),
    setNotice,
    setError,
    setIframeTimeEntryOperation: dialogs.setIframeTimeEntryOperation,
  });

  const primaryFilteredData = useMemo(
    () => applyBoardDataFilters(displayData, showSubtasks, filters.statusIds, filters.trackerIds),
    [displayData, filters.statusIds, filters.trackerIds, showSubtasks],
  );
  const issues = useMemo(
    () => buildVisibleIssues(primaryFilteredData, filters, hiddenStatusIds, actions.pendingDeleteIssue),
    [actions.pendingDeleteIssue, filters, hiddenStatusIds, primaryFilteredData],
  );
  const presentation = useMemo(
    () => {
      if (!primaryFilteredData || !displayData) return null;
      return buildPresentationProjection(
        displayData,
        primaryFilteredData.columns,
        issues,
        filters.statusIds,
        hiddenStatusIds,
      );
    }, [displayData, filters.statusIds, hiddenStatusIds, issues, primaryFilteredData],
  );
  const filteredData = useMemo(
    () => {
      if (!primaryFilteredData || !presentation) return null;
      return {
        ...primaryFilteredData,
        columns: presentation.columns,
      };
    }, [presentation, primaryFilteredData],
  );
  const priorityRank = useMemo(() => {
    const rank = new Map<number, number>();
    for (const [index, priority] of (data?.lists.priorities ?? []).entries()) {
      rank.set(priority.id, index);
    }
    return rank;
  }, [data]);
  const boardState = useMemo(() => {
    if (!filteredData) return null;
    return buildBoardState(
      filteredData,
      presentation?.issues ?? [],
      sortKey,
      priorityRank,
      filters.assigneeIds,
      filters.priority,
      filters.priorityFilterEnabled,
    );
  }, [filteredData, presentation?.issues, priorityRank, sortKey, filters.assigneeIds, filters.priority, filters.priorityFilterEnabled]);

  const canMove = (presentation?.issues ?? []).some((issue) => issue.permissions?.can_move);
  const selectedProjectIds = useMemo(
    () => (filters.projectIds.length > 0 ? filters.projectIds : data?.meta.project_id ? [data.meta.project_id] : []),
    [data?.meta.project_id, filters.projectIds],
  );
  const defaultCreateProjectId = useMemo(
    () => resolveDefaultCreateProjectId(selectedProjectIds, creatableProjectIds, data?.meta.project_id),
    [creatableProjectIds, data?.meta.project_id, selectedProjectIds],
  );
  const createStatusId = useMemo(
    () => resolveCreateStatusId(
      toolbarData,
      primaryFilteredData?.columns ?? [],
      filters.trackerIds,
      defaultCreateProjectId ?? undefined,
    ),
    [defaultCreateProjectId, filters.trackerIds, primaryFilteredData?.columns, toolbarData],
  );
  const canCreate = canCreateInBoard(defaultCreateProjectId, createStatusId);

  return (
    <div className={`rk-root${fullWindow ? ' rk-root-fullwindow' : ''}`}>
      <KanbanPopupHost
        data={data}
        loading={loading}
        notice={notice}
        error={error}
        pendingDeleteIssue={actions.pendingDeleteIssue}
        isRestoring={actions.isRestoring}
        onCloseNotice={dismissNotice}
        onCloseError={dismissError}
        onDismissDeleteNotice={actions.dismissDeleteNotice}
        onUndoDelete={() => { void actions.handleUndo(); }}
      />

      {toolbarData ? (
        <KanbanToolbar
          data={toolbarData}
          filters={filters}
          onChange={setFilters}
          sortKey={sortKey}
          onChangeSort={setSortKey}
          fullWindow={fullWindow}
          onToggleFullWindow={() => setFullWindow((value) => !value)}
          fitMode={fitMode}
          onToggleFitMode={() => setFitMode((value) => (value === 'none' ? 'width' : 'none'))}
          showSubtasks={showSubtasks}
          onToggleShowSubtasks={() => setShowSubtasks((value) => !value)}
          fontSize={fontSize}
          onChangeFontSize={setFontSize}
          maximumBoardEntityCount={maximumBoardEntityCount}
          onChangeMaximumBoardEntityCount={setMaximumBoardEntityCount}
          serverEntityLimit={toolbarData.meta.server_entity_limit}
          canCreate={canCreate}
          onCreate={() => {
            if (defaultCreateProjectId === null || createStatusId === undefined) return;
            dialogs.openCreate({
              statusId: createStatusId,
              projectId: defaultCreateProjectId,
              preferredTrackerId: data ? resolvePreferredTrackerId(data, filters.trackerIds, defaultCreateProjectId) : undefined,
            });
          }}
          onScrollToTop={() => boardRef.current?.scrollToTop()}
          timeEntryOnClose={timeEntryOnClose}
          onToggleTimeEntryOnClose={() => setTimeEntryOnClose((value) => !value)}
          laneType={laneType}
          onChangeLaneType={setLaneType}
          agingWarnDays={agingWarnDays}
          onChangeAgingWarnDays={setAgingWarnDays}
          agingDangerDays={agingDangerDays}
          onChangeAgingDangerDays={setAgingDangerDays}
          agingExcludeClosed={agingExcludeClosed}
          onToggleAgingExcludeClosed={() => setAgingExcludeClosed((value) => !value)}
          viewableProjectsEnabled={viewableProjectsEnabled}
          onToggleViewableProjects={() => setViewableProjectsEnabled((value) => !value)}
          onOpenHelp={() => dialogs.setHelpOpen(true)}
        />
      ) : null}

      <div className="rk-board">
        {filteredData && boardState ? (
          <CanvasBoard
            ref={boardRef}
            data={filteredData}
            state={boardState}
            canMove={canMove}
            canCreate={canCreate}
            labels={filteredData.labels}
            fitMode={fitMode}
            busyIssueIds={actions.busyIssueIds}
            fontSize={fontSize}
            onCommand={(command) => {
              if (command.type === 'move_issue') {
                return actions.moveIssue(command.issueId, command.statusId, command.assignedToId, command.priorityId);
              }
              return false;
            }}
            onCreate={(ctx) => {
              const projectId = ctx.projectId ?? defaultCreateProjectId ?? undefined;
              dialogs.openCreate({
                ...ctx,
                projectId,
                preferredTrackerId: data ? resolvePreferredTrackerId(data, filters.trackerIds, projectId) : undefined,
              });
            }}
            defaultCreateStatusId={createStatusId}
            onEdit={dialogs.openEdit}
            onView={dialogs.openView}
            onDelete={actions.requestDelete}
            onEditClick={dialogs.openIssueUrl}
            timerSession={workTimer.session ? { sessionId: workTimer.session.sessionId, issueId: workTimer.session.issueId, state: workTimer.session.state } : null}
            onWorkTimer={(issueId) => {
              if (!data) return;
              const issue = findIssueForAction(data, issueId);
              if (issue) workTimer.open(issue);
            }}
            onPriorityClick={(issueId, currentPriorityId, x, y) => {
              dialogs.setPriorityPopup({ issueId, currentId: currentPriorityId, x, y });
            }}
            onDateClick={(issueId, currentDate, x, y) => {
              dialogs.setDatePopup({ issueId, currentDate, x, y });
            }}
            onProgressClick={(issueId, currentDoneRatio, x, y) => {
              dialogs.setProgressPopup({ issueId, currentDoneRatio, x, y });
            }}
            onSubtaskToggle={actions.toggleSubtask}
            hiddenStatusIds={hiddenStatusIds}
            onToggleStatusVisibility={(id) => {
              setHiddenStatusIds((previous) => {
                const next = new Set(previous);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              });
            }}
          />
        ) : null}
      </div>

      <GlobalTimer labels={toolbarData.labels} session={workTimer.session} remoteOwner={workTimer.remoteOwner} onRecover={(expected) => { void workTimer.recover(expected); }} onExtend={(minutes) => { void workTimer.extendTimer(minutes); }} onResume={(minutes) => { void workTimer.extendTimer(minutes); }} onDiscard={() => { void workTimer.discard(); }} onStop={() => { void workTimer.stopTimer().then((context) => { if (context) setWorkTimeEntry(createTimeEntryOperation(timerInstanceKey, Number(context.issueId), context)); }); }} onRecord={() => { void workTimer.record().then((context) => { if (context) setWorkTimeEntry(createTimeEntryOperation(timerInstanceKey, Number(context.issueId), context)); }); }} onResolveUnknown={(resolution, expected) => { void workTimer.lifecycle.resolve(expected, resolution); }} />
      <TimerStartModal labels={toolbarData.labels} startIssue={workTimer.startIssue} autoStop={workTimer.preferences.autoStop} onCloseStart={() => workTimer.setStartIssue(null)} onStart={(minutes, autoStop) => { void workTimer.start(minutes, autoStop); }} />
      <OtherNoticeModal labels={toolbarData.labels} session={workTimer.conflictSession} onClose={() => workTimer.setConflictSession(null)} />

      {data && dialogs.modal ? (
        <KanbanIssueModal
          data={data}
          baseUrl={baseUrl}
          ctx={dialogs.modal}
          onClose={() => dialogs.setModal(null)}
          onSaved={async (payload, isEdit) => {
            setNotice(null);
            if (isEdit) {
              const issueId = dialogs.modal?.issueId;
              if (!issueId) return;
              const issue = findIssueForAction(data, issueId);
              if (!issue || issue.lock_version === undefined || issue.lock_version === null) {
                throw new Error(data.labels.update_failed);
              }

              try {
                await actions.updateIssueMutation.mutateAsync({
                  issueId,
                  patch: payload,
                  lockVersion: issue.lock_version,
                });
                dialogs.setModal(null);
              } catch (caught: unknown) {
                throw new Error(
                  payloadMessage(caught) ||
                  payloadFieldError(caught) ||
                  resolveMutationError(caught, data.labels, data.labels.update_failed),
                );
              }
              return;
            }

            try {
              const subtasks = payload.subtasks as Array<{ clientId: string; subject: string; trackerId: number }> | undefined;
              const result = await actions.createIssueMutation.mutateAsync(payload);
              const createdIssue = result.issue;

              if (createdIssue && subtasks && subtasks.length > 0) {
                setNotice(
                  (labels?.created_with_subtasks ?? '')
                    .replace('%{id}', String(createdIssue.id))
                    .replace('%{count}', String(subtasks.length)),
                );
              } else {
                setNotice(labels?.created ?? null);
              }

              if (createdIssue?.id) {
                dialogs.setModal(null);
                dialogs.openIssue({
                  url: `/issues/${createdIssue.id}`,
                  issueId: createdIssue.id,
                  issueTitle: buildIssueTitle(data, createdIssue.id, createdIssue),
                  projectId: createdIssue.project?.id,
                });
              } else {
                dialogs.setModal(null);
              }
            } catch (caught: unknown) {
              throw new Error(payloadMessage(caught) || payloadFieldError(caught) || data.labels.create_failed);
            }
          }}
          onDeleted={async (issueId) => {
            actions.requestDelete(issueId);
          }}
        />
      ) : null}

      {dialogs.iframeEditContext ? (
        <IframeEditDialog
          url={dialogs.iframeEditContext.url}
          issueId={dialogs.iframeEditContext.issueId}
          issueTitle={dialogs.iframeEditContext.issueTitle}
          projectId={dialogs.iframeEditContext.projectId}
          labels={dialogs.iframeEditContext.labels}
          baseUrl={dialogs.iframeEditContext.baseUrl}
          queryKey={dialogs.iframeEditContext.boardQueryKey}
          projectIds={dialogs.iframeEditContext.projectIds}
          scopeStatusIds={dialogs.iframeEditContext.scopeStatusIds}
          dependencyStatusIds={dialogs.iframeEditContext.dependencyStatusIds}
          boardEntityLimit={dialogs.iframeEditContext.boardEntityLimit}
          onClose={() => {
            dialogs.setIframeEditContext(null);
          }}
          onSuccess={(message) => {
            setNotice(message);
          }}
          onNativeWriteComplete={() => {
            invalidateBoardSnapshot(queryClient, dialogs.iframeEditContext!.boardQueryKey);
          }}
        />
      ) : null}

      {dialogs.iframeCreateContext ? (
        <IframeEditDialog
          url={dialogs.iframeCreateContext.url}
          issueId={0}
          mode="create"
          labels={dialogs.iframeCreateContext.labels}
          baseUrl={dialogs.iframeCreateContext.baseUrl}
          queryKey={dialogs.iframeCreateContext.boardQueryKey}
          projectIds={dialogs.iframeCreateContext.projectIds}
          scopeStatusIds={dialogs.iframeCreateContext.scopeStatusIds}
          dependencyStatusIds={dialogs.iframeCreateContext.dependencyStatusIds}
          boardEntityLimit={dialogs.iframeCreateContext.boardEntityLimit}
          onClose={() => {
            dialogs.setIframeCreateContext(null);
          }}
          onSuccess={(message) => {
            setNotice(message);
          }}
          onNativeWriteComplete={() => {
            invalidateBoardSnapshot(queryClient, dialogs.iframeCreateContext!.boardQueryKey);
          }}
        />
      ) : null}

      {dialogs.iframeTimeEntryOperation && data ? (
        <IframeEditDialog
          timeEntryOperation={dialogs.iframeTimeEntryOperation}
          mode="time_entry"
          labels={data.labels}
          baseUrl={baseUrl}
          queryKey={boardQueryKey}
          projectIds={data.meta.project_ids ?? []}
          scopeStatusIds={effectiveScopeStatusIds(data)}
          dependencyStatusIds={effectiveDependencyStatusIds(data)}
          onClose={() => dialogs.setIframeTimeEntryOperation(null)}
          onSuccess={(message) => {
            setNotice(message);
            dialogs.setIframeTimeEntryOperation(null);
          }}
        />
      ) : null}

      {workTimeEntry && data ? (
        <IframeEditDialog
          timeEntryOperation={workTimeEntry}
          mode="time_entry"
          labels={data.labels}
          baseUrl={baseUrl}
          queryKey={boardQueryKey}
          onClose={() => { void workTimer.lifecycle.close(workTimeEntry.recording); setWorkTimeEntry(null); }}
          onSuccess={(message) => { setNotice(message); setWorkTimeEntry(null); }}
          onTimeEntrySubmitting={() => workTimer.lifecycle.submitting(workTimeEntry.recording)}
          onTimeEntryValidationError={() => workTimer.lifecycle.validationError(workTimeEntry.recording)}
          onTimeEntryUnknown={() => workTimer.lifecycle.unknown(workTimeEntry.recording)}
          onTimeEntrySuccess={() => workTimer.lifecycle.complete(workTimeEntry.recording)}
        />
      ) : null}

      {dialogs.priorityPopup && data ? (
        <PriorityPopup
          x={dialogs.priorityPopup.x}
          y={dialogs.priorityPopup.y}
          value={String(dialogs.priorityPopup.currentId)}
          options={(data.lists.priorities ?? []).map((priority) => ({ id: String(priority.id), name: priority.name }))}
          onClose={() => dialogs.setPriorityPopup(null)}
          onChange={async (newId) => {
            const nextPriorityId = Number(newId);
            const popup = dialogs.priorityPopup;
            dialogs.setPriorityPopup(null);

            if (Number.isNaN(nextPriorityId)) {
              setError(data.labels.invalid_priority_id);
              return;
            }
            if (!popup || nextPriorityId === popup.currentId) return;

            try {
              await actions.updateIssueMutation.mutateAsync({
                issueId: popup.issueId,
                patch: { priority_id: nextPriorityId },
                lockVersion: findIssueForAction(data, popup.issueId)?.lock_version ?? null,
              });
            } catch (caught: unknown) {
              setError(resolveMutationError(caught, data.labels, data.labels.update_failed));
            }
          }}
        />
      ) : null}

      {dialogs.helpOpen && data ? (
        <HelpDialog
          labels={data.labels}
          onClose={() => dialogs.setHelpOpen(false)}
        />
      ) : null}

      {dialogs.datePopup && data ? (
        <DatePopup
          key={`${dialogs.datePopup.issueId}-${dialogs.datePopup.x}-${dialogs.datePopup.y}`}
          x={dialogs.datePopup.x}
          y={dialogs.datePopup.y}
          value={dialogs.datePopup.currentDate}
          onClose={() => dialogs.setDatePopup(null)}
          onCommit={async (newDate) => {
            const popup = dialogs.datePopup;
            if (!popup || newDate === popup.currentDate) return;

            try {
              await actions.updateIssueMutation.mutateAsync({
                issueId: popup.issueId,
                patch: { due_date: newDate },
                lockVersion: findIssueForAction(data, popup.issueId)?.lock_version ?? null,
              });
            } catch (caught: unknown) {
              setError(caught instanceof Error ? caught.message : data.labels.date_update_failed);
            } finally {
              dialogs.setDatePopup(null);
            }
          }}
        />
      ) : null}

      {dialogs.progressPopup && data ? (
        <ProgressPopup
          x={dialogs.progressPopup.x}
          y={dialogs.progressPopup.y}
          value={dialogs.progressPopup.currentDoneRatio}
          onClose={() => dialogs.setProgressPopup(null)}
          onChange={async (newDoneRatio) => {
            const popup = dialogs.progressPopup;
            dialogs.setProgressPopup(null);
            if (!popup || newDoneRatio === popup.currentDoneRatio) return;

            try {
              await actions.updateIssueMutation.mutateAsync({
                issueId: popup.issueId,
                patch: { done_ratio: newDoneRatio },
                lockVersion: findIssueForAction(data, popup.issueId)?.lock_version ?? null,
              });
            } catch (caught: unknown) {
              setError(caught instanceof Error ? caught.message : data.labels.progress_update_failed);
            }
          }}
        />
      ) : null}
    </div>
  );
}
