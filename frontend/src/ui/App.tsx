import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BoardApiResponse, BoardData, Issue } from './types';
import { getJson, isHttpError } from './http';
import { CanvasBoard, type CanvasBoardHandle } from './board/CanvasBoard';
import { buildBoardState } from './board/state';
import { applyBoardDataFilters, buildVisibleIssues } from './boardFilters';
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

type Props = { dataUrl: string; initialCurrentUserId: number };

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

export function App({ dataUrl, initialCurrentUserId }: Props) {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const boardRef = useRef<CanvasBoardHandle>(null);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const dismissError = useCallback(() => setError(null), []);

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
    labels: {
      fetching_data: 'Fetching board data…',
      display_settings: 'Display settings',
      maximum_board_entity_count: 'Maximum display count',
      maximum_board_entity_count_help: 'Issues loaded in one complete board snapshot.',
      maximum_board_entity_count_invalid: 'Enter a positive integer.',
      save: 'Save',
      reset: 'Reset',
    },
  }), [agingDangerDays, agingExcludeClosed, agingWarnDays, baseUrl, maximumBoardEntityCount]);
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
        ? ` サーバーの安全上限は${boardError.server_entity_limit.toLocaleString()}件です。`
        : '';
      setError(`対象のIssueが最大表示件数の${limit.toLocaleString()}件を超えています。フィルタを絞るか、最大表示件数を変更してください。${serverSuffix}`);
    } else if (boardError?.code === 'BOARD_RESPONSE_TOO_LARGE') {
      setError(`ボードのレスポンスが安全上限（${(boardError.maximum_response_bytes ?? 0).toLocaleString()} bytes）を超えています。`);
    } else {
      setError(data?.labels.load_failed ?? 'Board data could not be loaded.');
    }
  }, [boardQuery.data, boardQuery.error, data?.labels.load_failed, maximumBoardEntityCount]);

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
  const dialogs = useKanbanDialogs(baseUrl, data, effectiveLaneType);
  const actions = useKanbanActions({
    baseUrl,
    boardQueryKey,
    data,
    refresh,
    timeEntryOnClose,
    setNotice,
    setError,
    setIframeTimeEntryUrl: dialogs.setIframeTimeEntryUrl,
  });

  const filteredData = useMemo(
    () => applyBoardDataFilters(displayData, showSubtasks, filters.statusIds),
    [displayData, filters.statusIds, showSubtasks],
  );
  const issues = useMemo(
    () => buildVisibleIssues(filteredData, filters, hiddenStatusIds, actions.pendingDeleteIssue),
    [actions.pendingDeleteIssue, filteredData, filters, hiddenStatusIds],
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
      issues,
      sortKey,
      priorityRank,
      filters.assigneeIds,
      filters.priority,
      filters.priorityFilterEnabled,
    );
  }, [filteredData, issues, priorityRank, sortKey, filters.assigneeIds, filters.priority, filters.priorityFilterEnabled]);

  const canMove = issues.some((issue) => issue.permissions?.can_move);
  const selectedProjectIds = useMemo(
    () => (filters.projectIds.length > 0 ? filters.projectIds : data?.meta.project_id ? [data.meta.project_id] : []),
    [data?.meta.project_id, filters.projectIds],
  );
  const defaultCreateProjectId = useMemo(
    () => resolveDefaultCreateProjectId(selectedProjectIds, creatableProjectIds, data?.meta.project_id),
    [creatableProjectIds, data?.meta.project_id, selectedProjectIds],
  );
  const canCreate = defaultCreateProjectId !== null;

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
          serverEntityLimit={data?.meta.server_entity_limit}
          canCreate={canCreate}
          onCreate={() => {
            if (defaultCreateProjectId === null) return;
            const defaultStatus = toolbarData.columns.find((column) => !column.is_closed)?.id ?? toolbarData.columns[0]?.id ?? 1;
            dialogs.openCreate({ statusId: defaultStatus, projectId: defaultCreateProjectId });
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
                actions.moveIssue(command.issueId, command.statusId, command.assignedToId, command.priorityId);
              }
            }}
            onCreate={(ctx) => {
              dialogs.openCreate({
                ...ctx,
                projectId: ctx.projectId ?? defaultCreateProjectId ?? undefined,
              });
            }}
            onEdit={dialogs.openEdit}
            onView={dialogs.openView}
            onDelete={actions.requestDelete}
            onEditClick={dialogs.openIssueUrl}
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
                dialogs.setIframeEditContext({
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

      {dialogs.iframeEditContext && data ? (
        <IframeEditDialog
          url={dialogs.iframeEditContext.url}
          issueId={dialogs.iframeEditContext.issueId}
          issueTitle={dialogs.iframeEditContext.issueTitle}
          projectId={dialogs.iframeEditContext.projectId}
          labels={data.labels}
          baseUrl={baseUrl}
          queryKey={boardQueryKey}
          projectIds={data.meta.project_ids ?? []}
          scopeStatusIds={effectiveScopeStatusIds(data)}
          dependencyStatusIds={effectiveDependencyStatusIds(data)}
          boardEntityLimit={data.meta.requested_entity_limit ?? data.meta.effective_entity_limit}
          onClose={() => {
            dialogs.setIframeEditContext(null);
          }}
          onSuccess={(message) => {
            setNotice(message);
          }}
          onNativeWriteComplete={() => {
            invalidateBoardSnapshot(queryClient, boardQueryKey);
          }}
        />
      ) : null}

      {dialogs.iframeCreateUrl && data ? (
        <IframeEditDialog
          url={dialogs.iframeCreateUrl}
          issueId={0}
          mode="create"
          labels={data.labels}
          baseUrl={baseUrl}
          queryKey={boardQueryKey}
          projectIds={data.meta.project_ids ?? []}
          scopeStatusIds={effectiveScopeStatusIds(data)}
          dependencyStatusIds={effectiveDependencyStatusIds(data)}
          boardEntityLimit={data.meta.requested_entity_limit ?? data.meta.effective_entity_limit}
          onClose={() => {
            dialogs.setIframeCreateUrl(null);
          }}
          onSuccess={(message) => {
            setNotice(message);
          }}
          onNativeWriteComplete={() => {
            invalidateBoardSnapshot(queryClient, boardQueryKey);
          }}
        />
      ) : null}

      {dialogs.iframeTimeEntryUrl && data ? (
        <IframeEditDialog
          url={dialogs.iframeTimeEntryUrl}
          issueId={0}
          mode="time_entry"
          labels={data.labels}
          baseUrl={baseUrl}
          queryKey={boardQueryKey}
          projectIds={data.meta.project_ids ?? []}
          scopeStatusIds={effectiveScopeStatusIds(data)}
          dependencyStatusIds={effectiveDependencyStatusIds(data)}
          onClose={() => dialogs.setIframeTimeEntryUrl(null)}
          onSuccess={(message) => {
            setNotice(message);
            dialogs.setIframeTimeEntryUrl(null);
          }}
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
              setError('Invalid priority ID');
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
              setError(caught instanceof Error ? caught.message : 'Date update failed');
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
              setError(caught instanceof Error ? caught.message : 'Progress update failed');
            }
          }}
        />
      ) : null}
    </div>
  );
}
