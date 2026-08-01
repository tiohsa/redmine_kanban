import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BoardData, Issue } from './types';
import { getJson } from './http';
import { CanvasBoard, type CanvasBoardHandle } from './board/CanvasBoard';
import { buildBoardState } from './board/state';
import { applyBoardDataFilters, buildVisibleIssues } from './boardFilters';
import { buildBoardDataUrl, buildBoardIssuesCursorUrl, buildBoardQueryKey, buildBoardTreeUrl } from './boardQuery';
import { IframeEditDialog } from './IframeEditDialog';
import { KanbanIssueModal } from './KanbanIssueModal';
import { KanbanPopupHost } from './KanbanPopupHost';
import { DatePopup, PriorityPopup, ProgressPopup } from './KanbanPopups';
import { KanbanToolbar } from './KanbanToolbar';
import { HelpDialog } from './HelpDialog';
import { buildDisplayData, payloadFieldError, payloadMessage, resolveMutationError } from './kanbanShared';
import { mergeIssueTrees } from './boardTree';
import { applyBoardResponse, createNormalizedBoardState, selectBoardData } from './boardState';
import { findIssueInBoard } from './kanbanShared';
import { useKanbanActions } from './useKanbanActions';
import { useKanbanDialogs } from './useKanbanDialogs';
import { useKanbanPreferences } from './useKanbanPreferences';

type Props = { dataUrl: string };

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

export function mergeIssuePage(
  current: BoardData,
  page: Pick<BoardData, 'meta' | 'issues'>,
  resolvedTreeParentIds: number[] = [],
  attachTreeParentIds: number[] = resolvedTreeParentIds,
  requestCursor?: string | null,
): BoardData {
  const currentState = createNormalizedBoardState(current);
  const normalizedIsTreePage = page.meta.pagination?.tree_parent_id !== undefined;
  const normalizedPagePagination = page.meta.pagination;
  const normalized = applyBoardResponse(currentState, {
    kind: normalizedIsTreePage ? 'tree_page' : 'root_page',
    issues: page.issues,
    parentId: normalizedPagePagination?.tree_parent_id,
    completeness: normalizedPagePagination?.has_more_issues ? 'partial' : 'complete',
    nextCursor: normalizedPagePagination?.next_cursor,
    hasMore: normalizedPagePagination?.has_more_issues,
    requestCursor: requestCursor ?? undefined,
    scopeFingerprint: page.meta.scope_fingerprint,
  });
  if (page.meta.scope_fingerprint || normalizedPagePagination?.next_cursor !== undefined) return selectBoardData(normalized);

  const issues = mergeIssueTrees(current.issues, page.issues, attachTreeParentIds);
  const currentPagination = current.meta.pagination;
  const pagePagination = page.meta.pagination;
  const totalIssueCount = pagePagination?.total_issue_count ?? currentPagination?.total_issue_count ?? issues.length;
  const nextOffset = Math.min(
    totalIssueCount,
    Math.max(
      currentPagination?.next_offset ?? currentPagination?.issue_count ?? 0,
      pagePagination?.next_offset ?? pagePagination?.issue_count ?? 0,
      issues.length,
    ),
  );
  const isTreePage = pagePagination?.tree_parent_id !== undefined;
  const pagination = isTreePage
    ? currentPagination
    : (
        pagePagination || currentPagination
          ? {
              ...(currentPagination ?? pagePagination!),
              ...(pagePagination ?? {}),
              offset: 0,
              issue_count: issues.length,
              total_issue_count: totalIssueCount,
              next_offset: nextOffset,
              has_more_issues: nextOffset < totalIssueCount,
            }
          : undefined
      );
  const tree = mergeTreeMetadata(current.meta.tree, page.meta.tree, issues, resolvedTreeParentIds);

  return {
    ...current,
    meta: {
      ...current.meta,
      ...(pagination ? { pagination } : {}),
      ...(tree ? { tree } : {}),
    },
    issues,
  };
}

function mergeTreeMetadata(
  currentTree: BoardData['meta']['tree'],
  pageTree: BoardData['meta']['tree'],
  issues: Issue[],
  resolvedTreeParentIds: number[] = [],
): BoardData['meta']['tree'] {
  if (!currentTree && !pageTree) return undefined;

  const ids: number[] = [];
  const pending = [...issues].reverse();
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    ids.push(node.id);
    pending.push(...[...(node.subtasks ?? [])].reverse() as unknown as Issue[]);
  }

  const truncatedParentIdSet = new Set([
    ...(currentTree?.truncated_parent_ids ?? []),
    ...(pageTree?.truncated_parent_ids ?? []),
  ]);
  for (const parentId of resolvedTreeParentIds) truncatedParentIdSet.delete(parentId);
  const truncatedParentIds = Array.from(truncatedParentIdSet).sort((left, right) => left - right);
  const legacyTruncation = Boolean(currentTree?.truncated && !(currentTree.truncated_parent_ids?.length) && resolvedTreeParentIds.length === 0);
  const truncated = truncatedParentIds.length > 0 || Boolean(pageTree?.truncated && !(pageTree.truncated_parent_ids?.length)) || legacyTruncation;
  const base = pageTree ?? currentTree!;

  return {
    ...base,
    root_issue_count: issues.length,
    unique_node_count: new Set(ids).size,
    serialized_node_count: ids.length,
    duplicate_node_count: Math.max(currentTree?.duplicate_node_count ?? 0, pageTree?.duplicate_node_count ?? 0),
    truncated,
    truncated_parent_ids: truncatedParentIds,
    loaded_node_count: Math.max(ids.length - issues.length, 0),
    ...(currentTree?.db_row_count !== undefined || pageTree?.db_row_count !== undefined
      ? { db_row_count: Math.max(currentTree?.db_row_count ?? 0, pageTree?.db_row_count ?? 0) }
      : {}),
  };
}

export function App({ dataUrl }: Props) {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMoreIssues, setLoadingMoreIssues] = useState(false);
  const [loadingMoreTree, setLoadingMoreTree] = useState(false);
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
    setCurrentUserId,
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

  useEffect(() => {
    if (data) setCurrentUserId(data.meta.current_user_id);
  }, [data, setCurrentUserId]);
  const loading = boardQuery.isLoading;
  const labels = data?.labels;
  const pagination = data?.meta.pagination;
  const canLoadMoreIssues = Boolean(pagination?.has_more_issues && pagination.next_cursor);
  const handleLoadMoreIssues = useCallback(() => {
    if (!pagination?.has_more_issues || !pagination.next_cursor) return;

    setLoadingMoreIssues(true);
    getJson<Pick<BoardData, 'ok' | 'meta' | 'issues'>>(
      buildBoardIssuesCursorUrl(baseUrl, filters.projectIds, filters.statusIds, hiddenStatusIds, pagination.issue_limit, pagination.next_cursor)
    )
      .then((page) => {
        queryClient.setQueryData<BoardData>(boardQueryKey, (current) => (
          current ? mergeIssuePage(current, page, [], [], pagination.next_cursor) : current
        ));
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : data?.labels.load_more_failed ?? null);
      })
      .finally(() => {
        setLoadingMoreIssues(false);
      });
  }, [baseUrl, boardQueryKey, data?.labels.load_more_failed, filters.projectIds, filters.statusIds, hiddenStatusIds, pagination, queryClient]);

  const handleLoadMoreTree = useCallback(() => {
    const parentId = data?.meta.tree?.truncated_parent_ids?.[0];
    if (!parentId || !pagination) return;

    const parentCursor = data.meta.tree?.parent_states?.[String(parentId)]?.next_cursor;
    setLoadingMoreTree(true);
    getJson<Pick<BoardData, 'ok' | 'meta' | 'issues'>>(
      parentCursor
        ? buildBoardIssuesCursorUrl(baseUrl, filters.projectIds, filters.statusIds, hiddenStatusIds, pagination.issue_limit, parentCursor, parentId)
        : buildBoardTreeUrl(baseUrl, filters.projectIds, filters.statusIds, hiddenStatusIds, pagination.issue_limit, parentId),
      )
      .then((page) => {
        const hasMore = Boolean(page.meta.pagination?.has_more_issues);
        const resolvedParentIds = hasMore ? [] : [parentId];
        queryClient.setQueryData<BoardData>(boardQueryKey, (current) => (
          current ? mergeIssuePage(current, page, resolvedParentIds, [parentId], parentCursor) : current
        ));
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : data?.labels.load_more_failed ?? null);
      })
      .finally(() => {
        setLoadingMoreTree(false);
      });
  }, [baseUrl, boardQueryKey, data, filters.projectIds, filters.statusIds, hiddenStatusIds, pagination, queryClient]);

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
    setError(data?.labels.load_failed ?? null);
  }, [boardQuery.data, boardQuery.error, data?.labels.load_failed]);

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
          pagination={pagination}
          onLoadMoreIssues={handleLoadMoreIssues}
          onLoadMoreTree={handleLoadMoreTree}
          onRefreshTree={() => { void refresh(); }}
          loadingMoreIssues={loadingMoreIssues}
          loadingMoreTree={loadingMoreTree}
          onCreate={() => {
            if (defaultCreateProjectId === null) return;
            const defaultStatus = data.columns.find((column) => !column.is_closed)?.id ?? data.columns[0]?.id ?? 1;
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
                  issueTitle: `#${createdIssue.id} ${createdIssue.subject ?? ''}`.trim(),
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
          onClose={() => {
            dialogs.setIframeEditContext(null);
          }}
          onSuccess={(message, issueId) => {
            setNotice(message);
            if (issueId) void actions.reconcileIssueIds([issueId]);
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
          onClose={() => {
            dialogs.setIframeCreateUrl(null);
          }}
          onSuccess={(message, issueId) => {
            setNotice(message);
            if (issueId) void actions.reconcileIssueIds([issueId]);
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
