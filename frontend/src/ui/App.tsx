import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BoardData, Issue } from './types';
import { getJson } from './http';
import { CanvasBoard, type CanvasBoardHandle } from './board/CanvasBoard';
import { buildBoardState } from './board/state';
import { applyBoardDataFilters, buildVisibleIssues } from './boardFilters';
import { buildBoardDataUrl, buildBoardQueryKey } from './boardQuery';
import { IframeEditDialog } from './IframeEditDialog';
import { KanbanIssueModal } from './KanbanIssueModal';
import { KanbanPopupHost } from './KanbanPopupHost';
import { DatePopup, PriorityPopup } from './KanbanPopups';
import { KanbanToolbar } from './KanbanToolbar';
import { HelpDialog } from './HelpDialog';
import { buildDisplayData, payloadFieldError, payloadMessage, resolveMutationError } from './kanbanShared';
import { useKanbanActions } from './useKanbanActions';
import { useKanbanDialogs } from './useKanbanDialogs';
import { useKanbanPreferences } from './useKanbanPreferences';

type Props = { dataUrl: string };

export function normalizeProjectIds(projectIds: number[], allowedProjectIds: Set<number>): number[] {
  return projectIds.filter((projectId) => allowedProjectIds.has(projectId));
}

export function normalizeAssigneeIds(assigneeIds: string[], allowedAssigneeIds: Set<string>): string[] {
  return assigneeIds.filter((assigneeId) => assigneeId === 'unassigned' || allowedAssigneeIds.has(assigneeId));
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

export function App({ dataUrl }: Props) {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const boardRef = useRef<CanvasBoardHandle>(null);

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
    priorityLaneEnabled,
    setPriorityLaneEnabled,
    viewableProjectsEnabled,
    setViewableProjectsEnabled,
  } = useKanbanPreferences(dataUrl);

  const baseUrl = useMemo(() => projectScope, [projectScope]);
  const boardQueryKey = useMemo(
    () => buildBoardQueryKey(baseUrl, filters.projectIds, filters.statusIds, hiddenStatusIds),
    [baseUrl, filters.projectIds, filters.statusIds, hiddenStatusIds],
  );

  const boardQuery = useQuery({
    queryKey: boardQueryKey,
    queryFn: async () =>
      getJson<BoardData>(buildBoardDataUrl(baseUrl, filters.projectIds, filters.statusIds, hiddenStatusIds)),
    placeholderData: (previous) => previous,
  });

  const data = boardQuery.data ?? null;
  const loading = boardQuery.isLoading;
  const labels = data?.labels;

  useEffect(() => {
    if (boardQuery.error) {
      setError(data?.labels.load_failed ?? null);
    }
  }, [boardQuery.error, data?.labels.load_failed]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: boardQueryKey });
  }, [boardQueryKey, queryClient]);

  const displayData = useMemo(() => {
    if (!data) return null;
    return buildDisplayData(data, priorityLaneEnabled);
  }, [data, priorityLaneEnabled]);

  const projectOptions = useMemo(
    () => (viewableProjectsEnabled ? data?.lists.viewable_projects : data?.lists.projects) ?? [],
    [data, viewableProjectsEnabled],
  );
  const allowedProjectIds = useMemo(() => new Set(projectOptions.map((project) => project.id)), [projectOptions]);
  const allowedAssigneeIds = useMemo(
    () => new Set((data?.lists.assignees ?? []).filter((assignee) => assignee.id !== null).map((assignee) => String(assignee.id))),
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
        onCloseNotice={() => setNotice(null)}
        onCloseError={() => setError(null)}
        onFinalizeDelete={(issueId) => { void actions.deleteIssue(issueId); }}
        onUndoDelete={() => { void actions.handleUndo(); }}
      />

      {data ? (
        <KanbanToolbar
          data={data}
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
          canCreate={canCreate}
          onCreate={() => {
            if (defaultCreateProjectId === null) return;
            const defaultStatus = data.columns.find((column) => !column.is_closed)?.id ?? data.columns[0]?.id ?? 1;
            dialogs.openCreate({ statusId: defaultStatus, projectId: defaultCreateProjectId });
          }}
          onScrollToTop={() => boardRef.current?.scrollToTop()}
          timeEntryOnClose={timeEntryOnClose}
          onToggleTimeEntryOnClose={() => setTimeEntryOnClose((value) => !value)}
          priorityLaneEnabled={priorityLaneEnabled}
          onTogglePriorityLane={() => setPriorityLaneEnabled((value) => !value)}
          viewableProjectsEnabled={viewableProjectsEnabled}
          onToggleViewableProjects={() => setViewableProjectsEnabled((value) => !value)}
          onOpenHelp={() => dialogs.setHelpOpen(true)}
        />
      ) : (
        <div className="rk-empty">{labels?.fetching_data}</div>
      )}

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
              const issue = data.issues.find((item) => item.id === issueId);
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
              const subtasks = payload.subtasks_subjects as string[] | undefined;
              const parentPayload = { ...payload };
              delete parentPayload.subtasks_subjects;

              const result = await actions.createIssueMutation.mutateAsync(parentPayload);
              const createdIssue = result.issue;

              if (createdIssue && subtasks && subtasks.length > 0) {
                const createdProjectId = createdIssue.project?.id;
                for (const subject of subtasks) {
                  await actions.createIssueMutation.mutateAsync({
                    ...parentPayload,
                    subject,
                    parent_issue_id: createdIssue.id,
                    project_id: createdProjectId ?? parentPayload.project_id,
                  });
                }
                setNotice(
                  (labels?.created_with_subtasks ?? '')
                    .replace('%{id}', String(createdIssue.id))
                    .replace('%{count}', String(subtasks.length)),
                );
              } else {
                setNotice(labels?.created ?? null);
              }

              dialogs.setModal(null);
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
          labels={data.labels}
          baseUrl={baseUrl}
          queryKey={boardQueryKey}
          onClose={() => {
            dialogs.setIframeEditContext(null);
            void refresh();
          }}
          onSuccess={(message) => {
            setNotice(message);
            dialogs.setIframeEditContext(null);
            void refresh();
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
          onClose={() => {
            dialogs.setIframeCreateUrl(null);
            void refresh();
          }}
          onSuccess={(message) => {
            setNotice(message);
            dialogs.setIframeCreateUrl(null);
            void refresh();
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
          onClose={() => dialogs.setIframeTimeEntryUrl(null)}
          onSuccess={(message) => {
            setNotice(message);
            dialogs.setIframeTimeEntryUrl(null);
            void refresh();
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
                lockVersion: data.issues.find((issue) => issue.id === popup.issueId)?.lock_version ?? null,
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
                lockVersion: data.issues.find((issue) => issue.id === popup.issueId)?.lock_version ?? null,
              });
            } catch (caught: unknown) {
              setError(caught instanceof Error ? caught.message : 'Date update failed');
            } finally {
              dialogs.setDatePopup(null);
            }
          }}
        />
      ) : null}
    </div>
  );
}
