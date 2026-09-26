import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { BoardData, Issue } from './types';
import { CanvasBoard, type CanvasBoardHandle } from './board/CanvasBoard';
import { resolveCreateStatusId, resolvePreferredTrackerId } from './boardFilters';
import { effectiveDependencyStatusIds, effectiveScopeStatusIds } from './boardQuery';
import { IframeEditDialog } from './IframeEditDialog';
import { KanbanIssueModal } from './KanbanIssueModal';
import { KanbanPopupHost } from './KanbanPopupHost';
import { DatePopup, PriorityPopup, ProgressPopup } from './KanbanPopups';
import { KanbanToolbar } from './KanbanToolbar';
import { HelpDialog } from './HelpDialog';
import { buildIssueTitle, findIssueInBoard } from '../model/board/selectors';
import { payloadFieldError, payloadMessage, resolveMutationError } from '../infrastructure/api/errors';
import { useKanbanActions } from './useKanbanActions';
import { invalidateBoardSnapshot } from './useIssueMutation';
import { useKanbanDialogs } from './useKanbanDialogs';
import { useKanbanPreferences } from './useKanbanPreferences';
import { useWorkTimer } from './workTimer/useWorkTimer';
import { GlobalTimer, OtherNoticeModal, TimerStartModal } from './workTimer/WorkTimer';
import { createTimeEntryOperation, type TimeEntryOperation } from './iframe/timeEntryOperation';
import { resolveDefaultCreateProjectId, useBoardFilterNormalization } from './useBoardFilterNormalization';
import { useBoardPresentation } from './useBoardPresentation';
import { savedViewsKey } from '../infrastructure/storage/savedViewsRepository';
import { validateViewReferences } from '../model/view/validation';
import { SavedViewsPopover } from './toolbar/SavedViewsPopover';
import { useBoardSnapshot } from './useBoardSnapshot';

type Props = { dataUrl: string; initialCurrentUserId: number; initialLabels?: Record<string, string> };

export function findIssueForAction(data: BoardData, issueId: number): Issue | null {
  return findIssueInBoard(data, issueId);
}

export { normalizeAssigneeIds, normalizeProjectIds, normalizeTrackerIds, resolveDefaultCreateProjectId } from './useBoardFilterNormalization';

export function canCreateInBoard(projectId: number | null, statusId: number | undefined): boolean {
  return projectId !== null && statusId !== undefined;
}

export function App({ dataUrl, initialCurrentUserId, initialLabels = {} }: Props) {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const boardRef = useRef<CanvasBoardHandle>(null);
  const datePopupOpeningId = useRef(0);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const dismissError = useCallback(() => setError(null), []);
  const [workTimeEntry, setWorkTimeEntry] = useState<Extract<TimeEntryOperation, { origin: 'work_timer' }> | null>(null);

  const {
    viewSettings,
    applyViewSettings,
    projectScope,
    filters,
    setFilters,
    fullWindow,
    setFullWindow,
    fitMode,
    setFitMode,
    cardDisplayMode,
    setCardDisplayMode,
    showSubtasks,
    setShowSubtasks,
    sortConfig,
    setSortConfig,
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
  const snapshot = useBoardSnapshot({
    baseUrl,
    projectIds: filters.projectIds,
    statusIds: filters.statusIds,
    hiddenStatusIds,
    maximumBoardEntityCount,
    preferencesReady,
    initialLabels,
    currentUserId: initialCurrentUserId,
    viewableProjectsEnabled,
  });
  const { boardQueryKey, data, loading, refresh, toolbarData } = snapshot;
  const timerInstanceKey = useMemo(() => {
    const pathname = new URL(dataUrl, window.location.origin).pathname;
    const projectIndex = pathname.indexOf('/projects/');
    return `${window.location.origin}${projectIndex >= 0 ? pathname.slice(0, projectIndex) : ''}`;
  }, [dataUrl]);
  const timerScope = useMemo(() => ({ instanceKey: timerInstanceKey, userId: data?.meta.current_user_id ?? initialCurrentUserId }), [data?.meta.current_user_id, initialCurrentUserId, timerInstanceKey]);
  const workTimer = useWorkTimer({ scope: timerScope, labels: data?.labels ?? initialLabels, onError: setError });

  const labels = data?.labels;
  const { creatableProjectIds } = useBoardFilterNormalization({
    data,
    filters,
    viewableProjectsEnabled,
  });

  const effectiveLaneType = laneType;
  const effectiveShowSubtasks = cardDisplayMode === 'single_line' ? false : showSubtasks;
  const dialogs = useKanbanDialogs(baseUrl, data, effectiveLaneType, boardQueryKey);
  const setDatePopup = dialogs.setDatePopup;
  const repositionDatePopup = useCallback(() => {
    setDatePopup((previous) => {
      if (!previous || previous.offscreen) return previous;
      const position = boardRef.current?.dateAnchorPosition(previous.boardPoint);
      if (!position) return { ...previous, offscreen: true };
      if (position.x === previous.x && position.y === previous.y) return previous;
      return { ...previous, ...position };
    });
  }, [setDatePopup]);

  useEffect(() => {
    window.addEventListener('scroll', repositionDatePopup, true);
    window.addEventListener('resize', repositionDatePopup);
    return () => {
      window.removeEventListener('scroll', repositionDatePopup, true);
      window.removeEventListener('resize', repositionDatePopup);
    };
  }, [repositionDatePopup]);
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

  const { boardState, filteredData, presentation, primaryFilteredData } = useBoardPresentation({
    data,
    laneType,
    agingWarnDays,
    agingDangerDays,
    agingExcludeClosed,
    showSubtasks: effectiveShowSubtasks,
    filters,
    hiddenStatusIds,
    pendingDeleteIssue: actions.pendingDeleteIssue,
    sortConfig,
  });

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
  const viewValidation = validateViewReferences(viewSettings, snapshot.metadata, data, toolbarData.labels);
  const metadata = snapshot.metadata;
  const unavailableHiddenStatusIds = metadata
    ? [...hiddenStatusIds].filter((id) => !metadata.statuses.some((status) => status.id === id))
    : [];
  const [confirmHiddenStatusRemoval, setConfirmHiddenStatusRemoval] = useState<string | null>(null);
  const viewsStorageKey = savedViewsKey(dataUrl, initialCurrentUserId);
  const canCreate = canCreateInBoard(defaultCreateProjectId, createStatusId);

  return (
    <div className={`rk-root${fullWindow ? ' rk-root-fullwindow' : ''}`}>
      <KanbanPopupHost
        data={toolbarData}
        loading={loading}
        notice={notice}
        error={error ?? snapshot.loadError}
        pendingDeleteIssue={actions.pendingDeleteIssue}
        isRestoring={actions.isRestoring}
        onCloseNotice={dismissNotice}
        onCloseError={() => { dismissError(); snapshot.dismissLoadError(); }}
        onDismissDeleteNotice={actions.dismissDeleteNotice}
        onUndoDelete={() => { void actions.handleUndo(); }}
      />

      {toolbarData ? (
        <KanbanToolbar
          data={toolbarData}
          savedViews={preferencesReady ? <SavedViewsPopover key={viewsStorageKey} storageKey={viewsStorageKey} current={viewSettings} onApply={applyViewSettings} validation={viewValidation} labels={toolbarData.labels} /> : null}
          filters={filters}
          onChange={setFilters}
          sortConfig={sortConfig}
          onChangeSort={setSortConfig}
          fullWindow={fullWindow}
          onToggleFullWindow={() => setFullWindow((value) => !value)}
          fitMode={fitMode}
          onToggleFitMode={() => setFitMode((value) => (value === 'none' ? 'width' : 'none'))}
          cardDisplayMode={cardDisplayMode}
          onChangeCardDisplayMode={setCardDisplayMode}
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

      {viewValidation.unavailable.length ? <div className="rk-recovery" role="alert">
        {toolbarData.labels.saved_views_unavailable} {viewValidation.unavailable.join('; ')}
        {unavailableHiddenStatusIds.length ? <div>
          <button type="button" className="rk-btn" onClick={() => setConfirmHiddenStatusRemoval(unavailableHiddenStatusIds.join(','))}>{toolbarData.labels.hidden_statuses_remove_unavailable}</button>
          {confirmHiddenStatusRemoval === unavailableHiddenStatusIds.join(',') ? <div role="group" aria-label={toolbarData.labels.hidden_statuses_remove_unavailable}>
            <p>{toolbarData.labels.hidden_statuses_remove_confirm.replace('%{ids}', unavailableHiddenStatusIds.join(', '))}</p>
            <button type="button" className="rk-btn" onClick={() => {
              setHiddenStatusIds((previous) => new Set([...previous].filter((id) => !unavailableHiddenStatusIds.includes(id))));
              setConfirmHiddenStatusRemoval(null);
            }}>{toolbarData.labels.hidden_statuses_remove_action}</button>
            <button type="button" className="rk-btn" onClick={() => setConfirmHiddenStatusRemoval(null)}>{toolbarData.labels.cancel}</button>
          </div> : null}
        </div> : null}
      </div> : null}
      {!data && snapshot.boardQuery.isError ? (
        <div className="rk-recovery" role="region" aria-label={toolbarData.labels.board_recovery}>
          <p>{toolbarData.labels.board_recovery_help}</p>
          <button type="button" className="rk-btn" onClick={() => { void refresh(); }}>{toolbarData.labels.retry}</button>
        </div>
      ) : null}
      {snapshot.metadataQuery.isError ? (
        <div className="rk-recovery" role="alert">
          {toolbarData.labels.board_metadata_failed}
          <button type="button" className="rk-btn" onClick={() => { void snapshot.metadataQuery.refetch(); }}>{toolbarData.labels.retry}</button>
        </div>
      ) : null}
      <div className="rk-board">
        {filteredData && boardState ? (
          <CanvasBoard
            ref={boardRef}
            onViewportChange={repositionDatePopup}
            data={filteredData}
            state={boardState}
            canMove={canMove}
            canCreate={canCreate}
            labels={filteredData.labels}
            fitMode={fitMode}
            cardDisplayMode={cardDisplayMode}
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
            onPriorityClick={(issueId, currentPriorityId, x, y, source) => {
              dialogs.setPriorityPopup({ issueId, currentId: currentPriorityId, x, y, restoreFocusTo: source ?? document.querySelector<HTMLElement>('.rk-canvas') });
            }}
            onDateClick={(issueId, currentDate, x, y, boardPoint) => {
              dialogs.setDatePopup({ issueId, currentDate, x, y, boardPoint, openingId: ++datePopupOpeningId.current });
            }}
            onProgressClick={(issueId, currentDoneRatio, x, y, source) => {
              dialogs.setProgressPopup({ issueId, currentDoneRatio, x, y, restoreFocusTo: source ?? document.querySelector<HTMLElement>('.rk-canvas') });
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

      <GlobalTimer labels={toolbarData.labels} session={workTimer.session} remoteOwner={workTimer.remoteOwner} openPendingRequest={workTimer.pendingManageRequest} onRecover={(expected) => { void workTimer.recover(expected); }} onRetrySynchronization={(expected) => { void workTimer.retrySynchronization(expected); }} onExtend={(minutes) => { void workTimer.extendTimer(minutes); }} onResume={(minutes) => { void workTimer.extendTimer(minutes); }} onDiscard={() => { void workTimer.discard(); }} onStop={() => { void workTimer.stopTimer().then((context) => { if (context) setWorkTimeEntry(createTimeEntryOperation(timerInstanceKey, Number(context.issueId), context)); }); }} onRecord={() => { void workTimer.record().then((context) => { if (context) setWorkTimeEntry(createTimeEntryOperation(timerInstanceKey, Number(context.issueId), context)); }); }} onResolveUnknown={(resolution, expected) => { void workTimer.lifecycle.resolve(expected, resolution); }} />
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
          onClose={(options) => { if (!options?.timeEntryConfirmed) void workTimer.lifecycle.close(workTimeEntry.recording); setWorkTimeEntry(null); }}
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
          restoreFocusTo={dialogs.priorityPopup.restoreFocusTo}
          ariaLabel={data.labels.issue_priority}
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
          key={dialogs.datePopup.openingId}
          x={dialogs.datePopup.x}
          y={dialogs.datePopup.y}
          offscreen={dialogs.datePopup.offscreen}
          value={dialogs.datePopup.currentDate}
          labels={data.labels}
          restoreFocusTo={document.querySelector<HTMLElement>('.rk-canvas')}
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
            }
          }}
        />
      ) : null}

      {dialogs.progressPopup && data ? (
        <ProgressPopup
          x={dialogs.progressPopup.x}
          y={dialogs.progressPopup.y}
          value={dialogs.progressPopup.currentDoneRatio}
          restoreFocusTo={dialogs.progressPopup.restoreFocusTo}
          ariaLabel={data.labels.issue_done_ratio}
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
