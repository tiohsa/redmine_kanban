import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BoardData, Issue, Lane } from './types';
import { getJson, postJson } from './http';
import { CanvasBoard, type CanvasBoardHandle } from './board/CanvasBoard';
import { buildBoardState } from './board/state';
import { type SortKey } from './board/sort';
import { replaceIssueInBoard, updateIssueInBoard, useIssueMutation } from './useIssueMutation';
import { getCleanDialogStyles } from './board/iframeStyles';
import { IframeEditDialog } from './IframeEditDialog';

type Props = { dataUrl: string };

type Filters = {
  assignee: 'all' | 'me' | 'unassigned' | string;
  q: string;
  due: 'all' | 'overdue' | 'thisweek' | '3days' | '7days' | '1day' | 'custom' | 'none';
  dueDays?: number;
  priority: string[]; // Multiple selection
  priorityFilterEnabled: boolean;
  projectIds: number[]; // Multiple selection
  statusIds: number[]; // Multiple selection
};

type ModalContext = { statusId: number; laneId?: string | number; issueId?: number };

type FitMode = 'none' | 'width';

type IssueMutationResult = { issue: Issue; warning?: string };

type MovePayload = {
  issueId: number;
  statusId: number;
  assignedToId?: number | null;
  priorityId?: number | null;
  lockVersion: number | null;
};

type UpdatePayload = {
  issueId: number;
  patch: Record<string, unknown>;
  lockVersion: number | null;
};

export function App({ dataUrl }: Props) {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(() => {
    try {
      const v = localStorage.getItem('rk_filters');
      if (v) {
        const parsed = JSON.parse(v);
        return {
          assignee: parsed.assignee || 'all',
          q: parsed.q || '',
          due: parsed.due || 'all',
          dueDays: parsed.dueDays || 7,
          priority: Array.isArray(parsed.priority) ? parsed.priority : [],
          priorityFilterEnabled:
            typeof parsed.priorityFilterEnabled === 'boolean'
              ? parsed.priorityFilterEnabled
              : Array.isArray(parsed.priority) && parsed.priority.length > 0,
          projectIds: Array.isArray(parsed.projectIds) ? parsed.projectIds.map(Number) : [],
          statusIds: Array.isArray(parsed.statusIds) ? parsed.statusIds.map(Number) : []
        };
      }
    } catch {
      // ignore
    }
    return { assignee: 'all', q: '', due: 'all', priority: [], priorityFilterEnabled: false, projectIds: [], statusIds: [] };
  });
  const [modal, setModal] = useState<ModalContext | null>(null);

  const [pendingDeleteIssue, setPendingDeleteIssue] = useState<Issue | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [iframeEditContext, setIframeEditContext] = useState<{ url: string; issueId: number } | null>(null);
  const [iframeCreateUrl, setIframeCreateUrl] = useState<string | null>(null);
  const [iframeTimeEntryUrl, setIframeTimeEntryUrl] = useState<string | null>(null);
  const [priorityPopup, setPriorityPopup] = useState<{ issueId: number; currentId: number; x: number; y: number } | null>(null);
  const [datePopup, setDatePopup] = useState<{ issueId: number; currentDate: string | null; x: number; y: number } | null>(null);
  const [fullWindow, setFullWindow] = useState(() => {
    try {
      return localStorage.getItem('rk_fullwindow') === '1';
    } catch {
      return false;
    }
  });
  const [fitMode, setFitMode] = useState<FitMode>(() => {
    try {
      const v = localStorage.getItem('rk_fit_mode');
      if (v === 'none' || v === 'width') return v;
      // Legacy compatibility
      if (localStorage.getItem('rk_fit_to_screen') === '1') return 'width';
    } catch {
      // ignore
    }
    return 'none';
  });
  const [showSubtasks, setShowSubtasks] = useState(() => {
    try {
      return localStorage.getItem('rk_show_subtasks') !== '0'; // Default true
    } catch {
      return true;
    }
  });
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    try {
      const v = localStorage.getItem('rk_sortkey');
      if (
        v === 'updated_desc' ||
        v === 'updated_asc' ||
        v === 'due_asc' ||
        v === 'due_desc' ||
        v === 'priority_desc' ||
        v === 'priority_asc'
      ) {
        return v;
      }
    } catch {
      // ignore
    }
    return 'updated_desc';
  });
  const [busyIssueIds, setBusyIssueIds] = useState<Set<number>>(new Set());
  const busyIssueIdsRef = useRef<Set<number>>(new Set());
  const [hiddenStatusIds, setHiddenStatusIds] = useState<Set<number>>(() => {
    try {
      const v = localStorage.getItem('rk_hidden_status_ids');
      if (v) return new Set(JSON.parse(v).map(Number));
    } catch { }
    return new Set();
  });
  const [fontSize, setFontSize] = useState<number>(() => {
    try {
      const v = localStorage.getItem('rk_font_size');
      if (v) return parseInt(v, 10);
    } catch { }
    return 13;
  });
  const [timeEntryOnClose, setTimeEntryOnClose] = useState(() => {
    try {
      return localStorage.getItem('rk_time_entry_on_close') === '1';
    } catch {
      return false;
    }
  });
  const [priorityLaneEnabled, setPriorityLaneEnabled] = useState(() => {
    try {
      return localStorage.getItem('rk_priority_lane_enabled') === '1';
    } catch {
      return false;
    }
  });

  const queryClient = useQueryClient();
  const boardRef = useRef<CanvasBoardHandle>(null);
  const baseUrl = useMemo(() => dataUrl.replace(/\/data$/, ''), [dataUrl]);

  const projectIdsKey = useMemo(
    () => filters.projectIds.slice().sort((a, b) => a - b).join(','),
    [filters.projectIds]
  );
  const boardQueryKey = useMemo(
    () => ['kanban', 'board', baseUrl, projectIdsKey] as const,
    [baseUrl, projectIdsKey]
  );

  const boardQuery = useQuery({
    queryKey: boardQueryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      filters.projectIds.forEach((id) => params.append('project_ids[]', String(id)));
      const qs = params.toString();
      const url = `${baseUrl}/data${qs ? `?${qs}` : ''}`;
      return getJson<BoardData>(url);
    },
    placeholderData: (prev) => prev,
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
  }, [queryClient, boardQueryKey]);

  const setIssueBusy = useCallback((issueId: number, busy: boolean) => {
    const nextRef = new Set(busyIssueIdsRef.current);
    if (busy) {
      nextRef.add(issueId);
    } else {
      nextRef.delete(issueId);
    }
    busyIssueIdsRef.current = nextRef;

    setBusyIssueIds((prev) => {
      const next = new Set(prev);
      if (busy) {
        next.add(issueId);
      } else {
        next.delete(issueId);
      }
      return next;
    });
  }, []);

  const isIssueBusy = useCallback((issueId: number) => {
    return busyIssueIdsRef.current.has(issueId);
  }, []);

  React.useEffect(() => {
    const className = 'rk-kanban-fullwindow';
    if (fullWindow) {
      document.body.classList.add(className);
    } else {
      document.body.classList.remove(className);
    }

    try {
      localStorage.setItem('rk_fullwindow', fullWindow ? '1' : '0');
    } catch {
      // ignore
    }

    return () => {
      document.body.classList.remove(className);
    };
  }, [fullWindow]);

  React.useEffect(() => {
    try {
      localStorage.setItem('rk_fit_mode', fitMode);
    } catch {
      // ignore
    }
  }, [fitMode]);

  React.useEffect(() => {
    try {
      localStorage.setItem('rk_sortkey', sortKey);
    } catch {
      // ignore
    }
  }, [sortKey]);

  React.useEffect(() => {
    try {
      localStorage.setItem('rk_hidden_status_ids', JSON.stringify(Array.from(hiddenStatusIds)));
    } catch { }
  }, [hiddenStatusIds]);

  React.useEffect(() => {
    try {
      localStorage.setItem('rk_font_size', String(fontSize));
    } catch { }
  }, [fontSize]);

  React.useEffect(() => {
    try {
      localStorage.setItem('rk_filters', JSON.stringify(filters));
    } catch {
      // ignore
    }
  }, [filters]);

  useEffect(() => {
    try {
      localStorage.setItem('rk_time_entry_on_close', timeEntryOnClose ? '1' : '0');
    } catch {
      // ignore
    }
  }, [timeEntryOnClose]);

  useEffect(() => {
    try {
      localStorage.setItem('rk_priority_lane_enabled', priorityLaneEnabled ? '1' : '0');
    } catch {
      // ignore
    }
  }, [priorityLaneEnabled]);

  const displayData = useMemo(() => {
    if (!data) return null;
    return buildDisplayData(data, priorityLaneEnabled);
  }, [data, priorityLaneEnabled]);

  const effectiveLaneType = displayData?.meta.lane_type;

  // Filter data based on showSubtasks and statusIds
  const filteredData = useMemo(() => {
    if (!displayData) return null;
    let res = displayData;
    if (!showSubtasks) {
      res = {
        ...res,
        issues: res.issues.filter(issue => !issue.parent_id)
      };
    }
    if (filters.statusIds.length > 0) {
      res = {
        ...res,
        columns: res.columns.filter(c => filters.statusIds.includes(c.id))
      };
    }
    return res;
  }, [displayData, showSubtasks, filters.statusIds]);

  const issues = useMemo(() => {
    let filtered = filterIssues(filteredData?.issues ?? [], filteredData, filters);
    // Filter out issues in hidden status lanes
    filtered = filtered.filter(it => !hiddenStatusIds.has(it.status_id));

    if (pendingDeleteIssue) {
      filtered = filtered.filter((i) => i.id !== pendingDeleteIssue.id);
    }
    return filtered;
  }, [filteredData, filters, pendingDeleteIssue, hiddenStatusIds]);
  const priorityRank = useMemo(() => {
    const m = new Map<number, number>();
    for (const [idx, p] of (data?.lists.priorities ?? []).entries()) m.set(p.id, idx);
    return m;
  }, [data]);
  const boardState = useMemo(() => {
    if (!filteredData) return null;
    return buildBoardState(filteredData, issues, sortKey, priorityRank);
  }, [filteredData, issues, sortKey, priorityRank]);

  const openCreate = (ctx: ModalContext) => {
    // Generate Redmine new issue URL with query params
    // baseUrl is like /projects/ecookbook/kanban, we need /projects/ecookbook/issues/new
    const projectUrl = baseUrl.replace(/\/kanban$/, '');
    const params = new URLSearchParams();
    if (data?.meta.project_id) {
      params.append('project_id', String(data.meta.project_id));
    }
    if (ctx.statusId) {
      params.append('issue[status_id]', String(ctx.statusId));
    }
    // Handle assignee from laneId if applicable
    if (ctx.laneId && effectiveLaneType === 'assignee' && ctx.laneId !== 'unassigned' && ctx.laneId !== 'none') {
      params.append('issue[assigned_to_id]', String(ctx.laneId));
    }
    if (ctx.laneId !== undefined && effectiveLaneType === 'priority') {
      if (ctx.laneId === 'no_priority') {
        params.append('issue[priority_id]', '');
      } else if (ctx.laneId !== 'none') {
        params.append('issue[priority_id]', String(ctx.laneId));
      }
    }

    setIframeCreateUrl(`${projectUrl}/issues/new?${params.toString()}`);
  };
  const openEdit = (issueId: number) => {
    const issue = data?.issues.find((i) => i.id === issueId);
    if (!issue) return;
    setIframeEditContext({ url: issue.urls.issue_edit, issueId });
  };

  const openView = (issueId: number) => {
    const issue = data?.issues.find((i) => i.id === issueId);
    if (!issue) return;
    setIframeEditContext({ url: issue.urls.issue, issueId });
  };


  const moveIssueMutation = useIssueMutation<MovePayload, IssueMutationResult>({
    queryKey: boardQueryKey,
    mutationFn: async (payload) => {
      const issuePayload: Record<string, number | null> = {
        status_id: payload.statusId,
        lock_version: payload.lockVersion,
      };
      if (payload.assignedToId !== undefined) {
        issuePayload.assigned_to_id = payload.assignedToId;
      }
      if (payload.priorityId !== undefined) {
        issuePayload.priority_id = payload.priorityId;
      }

      const res = await postJson<{ ok: boolean; issue: Issue; warning?: string }>(
        `${baseUrl}/issues/${payload.issueId}/move`,
        { issue: issuePayload },
        'PATCH'
      );
      return { issue: res.issue, warning: res.warning };
    },
    applyOptimistic: (prev, payload) =>
      updateIssueInBoard(prev, payload.issueId, (issue) => {
        const nextAssignedToId = payload.assignedToId === undefined ? issue.assigned_to_id : payload.assignedToId;
        const next = {
          ...issue,
          status_id: payload.statusId,
          assigned_to_id: nextAssignedToId,
          assigned_to_name: resolveAssigneeName(prev, nextAssignedToId),
        };
        if (payload.priorityId !== undefined) {
          next.priority_id = payload.priorityId;
          next.priority_name = resolvePriorityName(prev, payload.priorityId ?? null);
        }
        return next;
      }),
    applyServer: (prev, result, payload) =>
      updateIssueInBoard(prev, payload.issueId, (issue) => {
        const nextAssignedToId = payload.assignedToId === undefined ? issue.assigned_to_id : payload.assignedToId;
        return {
          ...result.issue,
          status_id: payload.statusId,
          assigned_to_id: nextAssignedToId,
          assigned_to_name: resolveAssigneeName(prev, nextAssignedToId),
          priority_id:
            payload.priorityId === undefined ? issue.priority_id : payload.priorityId,
          priority_name:
            payload.priorityId === undefined
              ? issue.priority_name ?? null
              : resolvePriorityName(prev, payload.priorityId ?? null),
        };
      }),
    onError: (err) => {
      setError(resolveMutationError(err, data?.labels, data?.labels.move_failed));
    },
    onSuccess: (result) => {
      if (result.warning) {
        setNotice(result.warning);
      }
      if (
        timeEntryOnClose &&
        data?.columns.find((c) => c.id === result.issue.status_id)?.is_closed
      ) {
        if (result.issue.can_log_time) {
          setIframeTimeEntryUrl(`/issues/${result.issue.id}/time_entries/new`);
        } else {
          setNotice(data?.labels.time_entry_permission_required ?? 'You do not have permission to log time for this issue');
        }
      }
    },
    onMutateIssue: (issueId) => setIssueBusy(issueId, true),
    onSettledIssue: (issueId) => setIssueBusy(issueId, false),
  });

  const updateIssueMutation = useIssueMutation<UpdatePayload, IssueMutationResult>({
    queryKey: boardQueryKey,
    mutationFn: async (payload) => {
      const res = await postJson<{ ok: boolean; issue: Issue; warning?: string }>(
        `${baseUrl}/issues/${payload.issueId}`,
        { issue: { ...payload.patch, lock_version: payload.lockVersion } },
        'PATCH'
      );
      return { issue: res.issue, warning: res.warning };
    },
    applyOptimistic: (prev, payload) =>
      updateIssueInBoard(prev, payload.issueId, (issue) => {
        const patch = payload.patch as Partial<Issue>;
        const next = { ...issue, ...patch };
        if ('assigned_to_id' in patch) {
          next.assigned_to_name = resolveAssigneeName(
            prev,
            patch.assigned_to_id ?? null
          );
        }
        if ('priority_id' in patch) {
          next.priority_name = resolvePriorityName(prev, patch.priority_id ?? null);
        }
        return next;
      }),
    applyServer: (prev, result, payload) =>
      updateIssueInBoard(prev, payload.issueId, (issue) => {
        const patch = payload.patch as Partial<Issue>;
        const next = { ...result.issue, ...patch };
        if ('assigned_to_id' in patch) {
          next.assigned_to_name = resolveAssigneeName(
            prev,
            patch.assigned_to_id ?? null
          );
        }
        if ('priority_id' in patch) {
          next.priority_name = resolvePriorityName(prev, patch.priority_id ?? null);
        }
        return next;
      }),
    onSuccess: (result) => {
      if (result.warning) setNotice(result.warning);
    },
    onMutateIssue: (issueId) => setIssueBusy(issueId, true),
    onSettledIssue: (issueId) => setIssueBusy(issueId, false),
  });

  const createIssueMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      return postJson<{ ok: boolean; issue?: Issue }>(`${baseUrl}/issues`, payload, 'POST');
    },
    onSettled: () => {
      void refresh();
    },
  });

  const moveIssue = (
    issueId: number,
    statusId: number,
    assignedToId?: number | null,
    priorityId?: number | null
  ) => {
    if (!data) return;
    if (isIssueBusy(issueId)) return;
    const issue = data.issues.find((it) => it.id === issueId);
    if (!issue) return;
    if (issue.lock_version === undefined || issue.lock_version === null) {
      setError(data.labels.update_failed);
      return;
    }

    setNotice(null);
    setIssueBusy(issueId, true);
    moveIssueMutation.mutate({
      issueId,
      statusId,
      assignedToId,
      priorityId,
      lockVersion: issue.lock_version,
    });
  };

  const toggleSubtask = (subtaskId: number, currentClosed: boolean) => {
    if (!data) return;
    if (isIssueBusy(subtaskId)) return;
    const subtaskInfo = findSubtask(data, subtaskId);
    if (!subtaskInfo) return;
    const targetStatusId = resolveSubtaskStatus(data, currentClosed);
    if (!targetStatusId) {
      setError(labels?.subtask_update_failed ?? null);
      return;
    }

    if (subtaskInfo.lockVersion === null) {
      setError(labels?.subtask_update_failed ?? null);
      return;
    }

    setNotice(null);
    setIssueBusy(subtaskId, true);
    moveIssueMutation.mutate({
      issueId: subtaskId,
      statusId: targetStatusId,
      assignedToId: subtaskInfo.assignedToId,
      lockVersion: subtaskInfo.lockVersion,
    });
  };

  const canMove = !!data?.meta.can_move;
  const canCreate = !!data?.meta.can_create;

  const requestDelete = (issueId: number, source: 'card' | 'subtask' = 'card') => {
    const issue = data?.issues.find((i) => i.id === issueId);
    if (!issue) return;

    if (source === 'card') {
      setPendingDeleteIssue(issue);
    } else {
      setPendingDeleteIssue(null);
    }
    setNotice(null);

    void deleteIssue(issueId);
  };

  const handleUndo = async () => {
    if (!pendingDeleteIssue || isRestoring) return;
    setIsRestoring(true);

    try {
      const res = await postJson<{ ok: boolean; issue?: Issue; message?: string }>(
        `${baseUrl}/issues`,
        {
          subject: pendingDeleteIssue.subject,
          description: pendingDeleteIssue.description,
          status_id: pendingDeleteIssue.status_id,
          assigned_to_id: pendingDeleteIssue.assigned_to_id,
          tracker_id: pendingDeleteIssue.tracker_id,
          priority_id: pendingDeleteIssue.priority_id,
          start_date: pendingDeleteIssue.start_date,
          due_date: pendingDeleteIssue.due_date,
        },
        'POST'
      );

      if (res.ok) {
        setNotice(null);
        await refresh();
        setPendingDeleteIssue(null);
      } else {
        setError(res.message || labels?.restore_failed || null);
      }
    } catch (e: any) {
      setError(labels?.restore_error ?? null);
    } finally {
      setIsRestoring(false);
    }
  };

  const deleteIssue = async (issueId: number) => {
    try {
      await postJson(`${baseUrl}/issues/${issueId}`, {}, 'DELETE');
      await refresh();
    } catch (e: any) {
      const p = e?.payload as any;
      setError(p?.message || (data ? data.labels.delete_failed : ''));
      setPendingDeleteIssue(null);
      await refresh();
    }
  };



  return (
    <div className={`rk-root${fullWindow ? ' rk-root-fullwindow' : ''}`}>


      <div className="rk-popup-host" aria-live="polite" aria-relevant="additions text">
        {loading ? (
          <div className="rk-popup rk-popup-info" role="dialog" aria-label={data?.labels.loading}>
            <div className="rk-popup-head">
              <div className="rk-popup-title">{data?.labels.loading}</div>
            </div>
            <div className="rk-popup-body">{data?.labels.fetching_data}</div>
          </div>
        ) : null}

        {notice || pendingDeleteIssue ? (
          <div className={`rk-popup ${pendingDeleteIssue ? 'rk-popup-info' : 'rk-popup-warn'}`} role="dialog">
            <div className="rk-popup-head">
              <div className="rk-popup-title">
                {pendingDeleteIssue ? data?.labels.notice : data?.labels.notice}
              </div>
              <button
                type="button"
                className="rk-icon-btn rk-popup-close"
                aria-label={data?.labels.close}
                onClick={() => {
                  if (pendingDeleteIssue) {
                    void deleteIssue(pendingDeleteIssue.id);
                  } else {
                    setNotice(null);
                  }
                }}
              >
                ×
              </button>
            </div>
            <div className="rk-popup-body">
              {pendingDeleteIssue ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <span>
                    {(labels?.deleted_with_undo ?? '')
                      .replace('%{id}', String(pendingDeleteIssue.id))}
                  </span>
                  <button
                    type="button"
                    className="rk-btn rk-btn-primary"
                    style={{ height: '24px', fontSize: '11px', padding: '0 8px' }}
                    onClick={handleUndo}
                    disabled={isRestoring}
                  >
                    {isRestoring ? labels?.restoring : labels?.undo}
                  </button>
                </div>
              ) : (
                notice
              )}
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="rk-popup rk-popup-error" role="dialog" aria-label={data?.labels.error} aria-live="assertive">
            <div className="rk-popup-head">
              <div className="rk-popup-title">{data?.labels.error}</div>
              <button type="button" className="rk-icon-btn rk-popup-close" aria-label={data?.labels.close} onClick={() => setError(null)}>
                ×
              </button>
            </div>
            <div className="rk-popup-body">{error}</div>
          </div>
        ) : null}
      </div>

      {data ? (
        <Toolbar
          data={data}
          filters={filters}
          onChange={setFilters}
          sortKey={sortKey}
          onChangeSort={setSortKey}
          fullWindow={fullWindow}
          onToggleFullWindow={() => setFullWindow((v) => !v)}
          onAnalyze={() => setModal({ statusId: 0, issueId: -1 })}
          fitMode={fitMode}
          onToggleFitMode={() => {
            setFitMode((prev) => (prev === 'none' ? 'width' : 'none'));
          }}
          showSubtasks={showSubtasks}
          onToggleShowSubtasks={() => {
            const next = !showSubtasks;
            setShowSubtasks(next);
            try {
              localStorage.setItem('rk_show_subtasks', next ? '1' : '0');
            } catch { }
          }}
          fontSize={fontSize}
          onChangeFontSize={setFontSize}
          canCreate={canCreate}
          onCreate={() => {
            const defaultStatus = data.columns.find(c => !c.is_closed)?.id ?? data.columns[0]?.id ?? 1;
            openCreate({ statusId: defaultStatus });
          }}
          onScrollToTop={() => boardRef.current?.scrollToTop()}
          timeEntryOnClose={timeEntryOnClose}
          onToggleTimeEntryOnClose={() => setTimeEntryOnClose(v => !v)}
          priorityLaneEnabled={priorityLaneEnabled}
          onTogglePriorityLane={() => setPriorityLaneEnabled((v) => !v)}
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
            busyIssueIds={busyIssueIds}
            fontSize={fontSize}
            onCommand={(command) => {
              if (command.type === 'move_issue') {
                moveIssue(command.issueId, command.statusId, command.assignedToId, command.priorityId);
              }
            }}
            onCreate={openCreate}
            onEdit={openEdit}
            onView={openView}
            onDelete={requestDelete}
            onEditClick={(urlPath: string) => {
              // Extract issue ID
              const match = urlPath.match(/\/issues\/(\d+)/);
              if (match) {
                const issueId = parseInt(match[1], 10);
                // Respect the URL provided. If it has /edit, it edits. If not, it views.
                // Previously it forced /edit. We remove that forcing for general clicks.
                // However, verification needed: does `onEditClick` get called with /edit?
                // Subtask info provides `issue.urls.issue` (show). So it will View.
                setIframeEditContext({ url: urlPath, issueId });
              }
            }}
            onPriorityClick={(issueId, currentPriorityId, x, y) => {
              setPriorityPopup({ issueId, currentId: currentPriorityId, x, y });
            }}
            onDateClick={(issueId, currentDate, x, y) => {
              setDatePopup({ issueId, currentDate, x, y });
            }}
            onSubtaskToggle={toggleSubtask}

            hiddenStatusIds={hiddenStatusIds}
            onToggleStatusVisibility={(id: number) => {
              setHiddenStatusIds((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              });
            }}
          />
        ) : null}
      </div>

      {data && modal ? (
        <IssueModal
          data={data}
          ctx={modal}
          onClose={() => setModal(null)}
          onSaved={async (payload, isEdit) => {
            setNotice(null);
            if (isEdit) {
              const issueId = modal.issueId;
              if (!issueId) return;
              const issue = data.issues.find((it) => it.id === issueId);
              if (!issue) return;
              if (issue.lock_version === undefined || issue.lock_version === null) {
                throw new Error(data.labels.update_failed);
              }
              try {
                await updateIssueMutation.mutateAsync({
                  issueId,
                  patch: payload,
                  lockVersion: issue.lock_version,
                });
                setModal(null);
              } catch (e: any) {
                const p = e?.payload as any;
                throw new Error(
                  p?.message ||
                  fieldError(p?.field_errors) ||
                  resolveMutationError(e, data.labels, data.labels.update_failed)
                );
              }
            } else {
              try {
                const subtasks = payload.subtasks_subjects as string[] | undefined;
                const parentPayload = { ...payload };
                delete parentPayload.subtasks_subjects;

                const res = await createIssueMutation.mutateAsync(parentPayload);
                const createdIssue = res.issue;

                if (createdIssue && subtasks && subtasks.length > 0) {
                  const createdProjectId = createdIssue.project?.id;
                  for (const subj of subtasks) {
                    await createIssueMutation.mutateAsync({
                      ...parentPayload,
                      subject: subj,
                      parent_issue_id: createdIssue.id,
                      project_id: createdProjectId ?? parentPayload.project_id,
                    });
                  }
                  setNotice(
                    (labels?.created_with_subtasks ?? '')
                      .replace('%{id}', String(createdIssue.id))
                      .replace('%{count}', String(subtasks.length))
                  );
                } else {
                  setNotice(labels?.created ?? null);
                }

                setModal(null);
              } catch (e: any) {
                const p = e?.payload as any;
                throw new Error(
                  p?.message ||
                  fieldError(p?.field_errors) ||
                  data.labels.create_failed
                );
              }
            }
          }}
          onDeleted={async (issueId) => {
            requestDelete(issueId);
          }}
        />
      ) : null}



      {iframeEditContext && data ? (
        <IframeEditDialog
          url={iframeEditContext.url}
          issueId={iframeEditContext.issueId}
          labels={data.labels}
          baseUrl={baseUrl}
          queryKey={boardQueryKey}
          onClose={() => { setIframeEditContext(null); refresh(); }}
          onSuccess={(msg) => {
            setNotice(msg);
            setIframeEditContext(null);
            refresh();
          }}
        />
      ) : null}

      {iframeCreateUrl && data ? (
        <IframeEditDialog
          url={iframeCreateUrl}
          issueId={0}
          mode="create"
          labels={data.labels}
          baseUrl={baseUrl}
          queryKey={boardQueryKey}
          onClose={() => { setIframeCreateUrl(null); refresh(); }}
          onSuccess={(msg) => {
            setNotice(msg);
            setIframeCreateUrl(null);
            refresh();
          }}
        />
      ) : null}

      {iframeTimeEntryUrl && data ? (
        <IframeEditDialog
          url={iframeTimeEntryUrl}
          issueId={0}
          mode="time_entry"
          labels={data.labels}
          baseUrl={baseUrl}
          queryKey={boardQueryKey}
          onClose={() => { setIframeTimeEntryUrl(null); }}
          onSuccess={(msg) => {
            setNotice(msg);
            setIframeTimeEntryUrl(null);
            refresh();
          }}
        />
      ) : null}

      {priorityPopup && data ? (
        <PriorityPopup
          x={priorityPopup.x}
          y={priorityPopup.y}
          value={String(priorityPopup.currentId)}
          options={(data.lists.priorities ?? []).map(p => ({ id: String(p.id), name: p.name }))}
          onClose={() => setPriorityPopup(null)}
          onChange={async (newId) => {
            const pid = Number(newId);
            setPriorityPopup(null);

            if (Number.isNaN(pid)) {
              setError("Invalid priority ID");
              return;
            }
            if (pid === priorityPopup.currentId) return;

            try {
              await updateIssueMutation.mutateAsync({
                issueId: priorityPopup.issueId,
                patch: { priority_id: pid },
                lockVersion: data.issues.find(i => i.id === priorityPopup.issueId)?.lock_version ?? null
              });
            } catch (e: any) {
              console.error("Priority update failed", e);
              setError(e.message || "Priority update failed");
            }
          }}
        />
      ) : null}

      {datePopup && data ? (
        <DatePopup
          key={`${datePopup.issueId}-${datePopup.x}-${datePopup.y}`}
          x={datePopup.x}
          y={datePopup.y}
          value={datePopup.currentDate}
          onClose={() => setDatePopup(null)}
          onCommit={async (newDate) => {
            if (newDate !== datePopup.currentDate) {
              try {
                await updateIssueMutation.mutateAsync({
                  issueId: datePopup.issueId,
                  patch: { due_date: newDate },
                  lockVersion: data.issues.find(i => i.id === datePopup.issueId)?.lock_version ?? null
                });
              } catch (e: any) {
                console.error("Date update failed", e);
                setError(e.message || "Date update failed");
              }
            }
          }}
        />
      ) : null}
    </div>
  );
}

function PriorityPopup({
  x,
  y,
  value,
  options,
  onClose,
  onChange,
}: {
  x: number;
  y: number;
  value: string;
  options: { id: string; name: string }[];
  onClose: () => void;
  onChange: (val: string) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  // Adjust position to stay in viewport might be needed, but for now simple positioning
  const style: React.CSSProperties = {
    position: 'fixed',
    left: x,
    top: y,
    zIndex: 1000,
    background: 'white',
    borderRadius: '6px',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
    border: '1px solid #e2e8f0',
    minWidth: '160px',
    padding: '4px 0',
  };

  return (
    <div ref={menuRef} style={style}>
      {options.map((option) => {
        const checked = option.id === value;
        return (
          <div
            key={option.id}
            className={`rk-dropdown-item ${checked ? 'selected' : ''}`}
            onClick={() => onChange(option.id)}
          >
            <div className="rk-dropdown-checkbox" />
            <span>{option.name}</span>
          </div>
        );
      })}
    </div>
  );
}

function DatePopup({
  x,
  y,
  value,
  onClose,
  onCommit,
}: {
  x: number;
  y: number;
  value: string | null;
  onClose: () => void;
  onCommit: (val: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingValue, setPendingValue] = useState<string | null>(value);
  const [hasChange, setHasChange] = useState(false);

  useEffect(() => {
    // Auto-open picker if supported
    // Small delay to ensure layout is stable for positioning
    const timer = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
      if (inputRef.current && typeof inputRef.current.showPicker === 'function') {
        try {
          inputRef.current.showPicker();
        } catch (e) {
          // ignore
        }
      }
    }, 10);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Invisible input positioned at click location to anchor the picker
  const style: React.CSSProperties = {
    position: 'fixed',
    left: x,
    top: y,
    opacity: 0,
    width: '1px',
    height: '1px',
    border: 'none',
    padding: 0,
    margin: 0,
    zIndex: 2000, // Ensure it's on top so browser sees it as visible/interactive
  };

  return (
    <input
      ref={inputRef}
      type="date"
      defaultValue={value || ''}
      style={style}
      onBlur={() => {
        if (hasChange) {
          onCommit(pendingValue ?? null);
        }
        setTimeout(onClose, 0);
      }}
      onChange={(e) => {
        setPendingValue(e.target.value || null);
        setHasChange(true);
      }}
    // If the user cancels the picker, blur should fire and close the popup.
    />
  );
}

function ConfirmDialog({
  title,
  message,
  confirmText,
  confirmKind,
  confirmDisabled,
  labels,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmText: string;
  confirmKind: 'danger' | 'primary';
  confirmDisabled?: boolean;
  labels: Record<string, string>;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const confirmClass = confirmKind === 'danger' ? 'rk-btn rk-btn-danger' : 'rk-btn rk-btn-primary';

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmDisabled) {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, confirmDisabled]);

  return (
    <div className="rk-modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="rk-modal rk-modal-sm">
        <div className="rk-modal-head">
          <h3>{title}</h3>
        </div>
        <div className="rk-confirm-body">{message}</div>
        <div className="rk-modal-actions">
          <button type="button" className="rk-btn" onClick={onCancel} disabled={!!confirmDisabled}>
            {labels.cancel}
          </button>
          <button type="button" className={confirmClass} onClick={onConfirm} disabled={!!confirmDisabled}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

function fieldError(fieldErrors: any): string | null {
  if (!fieldErrors) return null;
  if (fieldErrors.subject?.length) return fieldErrors.subject[0];
  return null;
}

function resolveMutationError(
  error: unknown,
  labels: Record<string, string> | undefined,
  fallback?: string
): string {
  const status = (error as any)?.status as number | undefined;
  const payloadMessage = (error as any)?.payload?.message as string | undefined;

  // 409 Conflict is specifically for optimistic locking failures
  if (status === 409) {
    return labels?.conflict ?? '';
  }

  // For 422 and other errors, prefer the server's message
  return payloadMessage || fallback || labels?.update_failed || '';
}

function resolveAssigneeName(data: BoardData, assignedToId: number | null): string | null {
  if (assignedToId === null) return null;
  const assignee = data.lists.assignees.find((a) => a.id === assignedToId);
  return assignee?.name ?? null;
}

function resolvePriorityName(data: BoardData, priorityId: number | null): string | null {
  if (priorityId === null) return null;
  const priority = data.lists.priorities.find((p) => p.id === priorityId);
  return priority?.name ?? null;
}

function buildDisplayData(data: BoardData, priorityLaneEnabled: boolean): BoardData {
  if (!priorityLaneEnabled) return data;

  const prioritiesHighToLow = [...(data.lists.priorities ?? [])].reverse();
  const priorityLanes: Lane[] = [
    ...prioritiesHighToLow.map((priority) => ({
      id: priority.id,
      name: priority.name,
      priority_id: priority.id,
      assigned_to_id: null,
    })),
    {
      id: 'no_priority',
      name: data.labels.not_set,
      priority_id: null,
      assigned_to_id: null,
    },
  ];

  return {
    ...data,
    meta: {
      ...data.meta,
      lane_type: 'priority',
    },
    lanes: priorityLanes,
  };
}

type SubtaskInfo = {
  lockVersion: number | null;
  assignedToId?: number | null;
};

function findSubtask(data: BoardData, subtaskId: number): SubtaskInfo | null {
  const findInTree = (subtasks: Issue['subtasks']): SubtaskInfo | null => {
    for (const subtask of subtasks ?? []) {
      if (subtask.id === subtaskId) {
        return {
          lockVersion: subtask.lock_version ?? null,
          assignedToId: undefined,
        };
      }
      const nested = findInTree(subtask.subtasks);
      if (nested) return nested;
    }
    return null;
  };

  const issue = data.issues.find((it) => it.id === subtaskId);
  if (issue) {
    return {
      lockVersion: issue.lock_version ?? null,
      assignedToId: issue.assigned_to_id ?? null,
    };
  }

  for (const parent of data.issues) {
    const nested = findInTree(parent.subtasks);
    if (nested) return nested;
  }

  return null;
}

function resolveSubtaskStatus(data: BoardData, currentClosed: boolean): number | null {
  if (currentClosed) {
    return data.columns.find((c) => !c.is_closed)?.id ?? null;
  }
  return data.columns.find((c) => c.is_closed)?.id ?? null;
}

function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfWeek(date: Date): Date {
  const s = startOfWeek(date);
  const e = new Date(s);
  e.setDate(e.getDate() + 7);
  e.setMilliseconds(e.getMilliseconds() - 1);
  return e;
}

function filterIssues(issues: Issue[], data: BoardData | null, filters: Filters): Issue[] {
  const q = filters.q.trim().toLowerCase();
  const now = new Date();
  const now0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = startOfWeek(now);
  const end = endOfWeek(now);

  return issues.filter((it) => {
    if (q && !it.subject.toLowerCase().includes(q)) return false;

    if (filters.assignee !== 'all') {
      if (filters.assignee === 'me') {
        if (String(it.assigned_to_id) !== String(data?.meta.current_user_id)) return false;
      } else if (filters.assignee === 'unassigned') {
        if (it.assigned_to_id !== null) return false;
      } else {
        if (String(it.assigned_to_id) !== String(filters.assignee)) return false;
      }
    }

    if (filters.priorityFilterEnabled) {
      if (filters.priority.length === 0) return false;
      if (!filters.priority.includes(String(it.priority_id))) return false;
    }

    if (filters.due !== 'all') {
      if (!it.due_date) return filters.due === 'none';
      if (filters.due === 'none') return false;

      const due = parseISODate(it.due_date);
      if (!due) return false;

      if (filters.due === 'overdue') return due < now0;
      if (filters.due === 'thisweek') return due >= start && due <= end;

      if (filters.due === '3days') {
        const limit = new Date(now0);
        limit.setDate(now0.getDate() + 3);
        return due >= now0 && due < limit;
      }

      if (filters.due === '7days') {
        const limit = new Date(now0);
        limit.setDate(now0.getDate() + 7);
        return due >= now0 && due < limit;
      }

      if (filters.due === '1day') {
        const limit = new Date(now0);
        limit.setDate(now0.getDate() + 1);
        return due >= now0 && due < limit;
      }

      if (filters.due === 'custom') {
        const days = filters.dueDays ?? 7;
        const limit = new Date(now0);
        limit.setDate(now0.getDate() + days);
        return due >= now0 && due < limit;
      }
    }

    return true;
  });
}

function parseISODate(dateString: string): Date | null {
  const parts = dateString.split('-');
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map((x) => Number(x));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

// Custom Dropdown Component
function Dropdown<T extends string>({
  label,
  icon,
  options,
  value,
  onChange,
  onReset,
  width = '240px',
  closeOnSelect = true,
  labels,
}: {
  label: string;
  icon: string;
  options: { id: T; name: string }[];
  value: T;
  onChange: (id: T) => void;
  onReset?: () => void;
  width?: string;
  closeOnSelect?: boolean;
  labels: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  // Close when clicking outside
  React.useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        menuRef.current &&
        !menuRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const selectedName = options.find((o) => o.id === value)?.name ?? value;

  return (
    <div className="rk-dropdown-container">
      <div
        ref={triggerRef}
        className={`rk-dropdown-trigger ${open ? 'rk-active' : ''}`}
        onClick={() => setOpen(!open)}
        title={selectedName}
      >
        <span className="rk-icon">{icon}</span>
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }}>
          {label}
        </span>
      </div>

      {open && (
        <div ref={menuRef} className="rk-dropdown-menu" style={{ width }}>
          <div className="rk-dropdown-title">{label}</div>
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {options.map((option) => {
              const checked = option.id === value;
              return (
                <div
                  key={option.id}
                  className={`rk-dropdown-item ${checked ? 'selected' : ''}`}
                  onClick={() => {
                    onChange(option.id);
                    if (closeOnSelect) setOpen(false);
                  }}
                >
                  <div className="rk-dropdown-checkbox" />
                  <span>{option.name}</span>
                </div>
              );
            })}
          </div>
          {onReset && (
            <div className="rk-dropdown-footer">
              <button
                type="button"
                className="rk-dropdown-link"
                onClick={() => {
                  onReset();
                  setOpen(false);
                }}
              >
                {labels.reset}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Multi-select Dropdown Component
function MultiSelectDropdown({
  label,
  icon,
  options,
  value,
  onChange,
  onReset,
  width = '240px',
  labels,
  includeAllOption = false,
  allLabel,
}: {
  label: string;
  icon: string;
  options: { id: string; name: string }[];
  value: string[];
  onChange: (ids: string[]) => void;
  onReset?: () => void;
  width?: string;
  labels: Record<string, string>;
  includeAllOption?: boolean;
  allLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        menuRef.current &&
        !menuRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const optionIds = useMemo(() => options.map((option) => option.id), [options]);
  const optionIdSet = useMemo(() => new Set(optionIds), [optionIds]);
  const allSelected = optionIds.length > 0 && optionIds.every((id) => value.includes(id));
  const selectedCount = value.filter((id) => optionIdSet.has(id)).length;
  const resolvedAllLabel = allLabel ?? labels.all ?? 'All';
  const title =
    allSelected ? resolvedAllLabel : value.length > 0
      ? value.map(v => options.find(o => o.id === v)?.name).join(', ')
      : label;

  return (
    <div className="rk-dropdown-container">
      <div
        ref={triggerRef}
        className={`rk-dropdown-trigger ${open ? 'rk-active' : ''}`}
        onClick={() => setOpen(!open)}
        title={title}
      >
        <span className="rk-icon">{icon}</span>
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }}>
          {label}{selectedCount > 0 ? ` (${selectedCount})` : ''}
        </span>
      </div>

      {open && (
        <div ref={menuRef} className="rk-dropdown-menu" style={{ width }}>
          <div className="rk-dropdown-title">{label}</div>
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {includeAllOption && (
              <div
                key="__all__"
                className={`rk-dropdown-item ${allSelected ? 'selected' : ''}`}
                onClick={() => {
                  onChange(allSelected ? [] : optionIds);
                }}
              >
                <div className="rk-dropdown-checkbox" />
                <span>{resolvedAllLabel}</span>
              </div>
            )}
            {options.map((option) => {
              const checked = value.includes(option.id);
              return (
                <div
                  key={option.id}
                  className={`rk-dropdown-item ${checked ? 'selected' : ''}`}
                  onClick={() => {
                    if (checked) {
                      onChange(value.filter((v) => v !== option.id));
                    } else {
                      onChange([...value, option.id]);
                    }
                  }}
                >
                  <div className="rk-dropdown-checkbox" />
                  <span>{option.name}</span>
                </div>
              );
            })}
          </div>
          {onReset && (
            <div className="rk-dropdown-footer">
              <button
                type="button"
                className="rk-dropdown-link"
                onClick={() => {
                  onReset();
                  setOpen(false);
                }}
              >
                {labels.reset}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SearchDropdown({
  label,
  title,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  title: string;
  placeholder: string;
  value: string;
  onChange: (val: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Handle keyboard shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Trigger on Ctrl+F or Cmd+F
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        // Don't trigger if inside an input or textarea
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
          return;
        }

        e.preventDefault();
        setOpen(true);
        // The input will be focused via autoFocus when it renders
      }

      // Clear and close on Escape when open
      if (e.key === 'Escape' && open) {
        onChange('');
        setOpen(false);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onChange]);

  // Close when clicking outside
  React.useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        menuRef.current &&
        !menuRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className="rk-dropdown-container">
      <div
        ref={triggerRef}
        className={`rk-dropdown-trigger ${open ? 'rk-active' : ''}`}
        onClick={() => setOpen(!open)}
        title={label}
      >
        <span className="rk-icon">filter_list</span>
        <span>{label}</span>
      </div>

      {open && (
        <div ref={menuRef} className="rk-dropdown-menu" style={{ width: '300px' }}>
          <div className="rk-dropdown-title">{title}</div>
          <div style={{ padding: '12px' }}>
            <div className="rk-search-box">
              <span className="rk-icon">search</span>
              <input
                ref={inputRef}
                autoFocus
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
              />
              {value ? (
                <button
                  type="button"
                  className="rk-search-clear"
                  aria-label={label}
                  onClick={() => {
                    onChange('');
                    inputRef.current?.focus();
                  }}
                >
                  <span className="rk-icon">close</span>
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Toolbar({
  data,
  filters,
  onChange,
  sortKey,
  onChangeSort,
  fullWindow,
  onToggleFullWindow,
  onAnalyze,
  fitMode,
  onToggleFitMode,
  showSubtasks,
  onToggleShowSubtasks,
  fontSize,
  onChangeFontSize,
  canCreate,
  onCreate,
  onScrollToTop,
  timeEntryOnClose,
  onToggleTimeEntryOnClose,
  priorityLaneEnabled,
  onTogglePriorityLane,
}: {
  data: BoardData;
  filters: Filters;
  onChange: (f: Filters) => void;
  sortKey: SortKey;
  onChangeSort: (k: SortKey) => void;
  fullWindow: boolean;
  onToggleFullWindow: () => void;
  onAnalyze: () => void;
  fitMode: FitMode;
  onToggleFitMode: () => void;
  showSubtasks: boolean;
  onToggleShowSubtasks: () => void;
  fontSize: number;
  onChangeFontSize: (size: number) => void;
  canCreate: boolean;
  onCreate: () => void;
  onScrollToTop: () => void;
  timeEntryOnClose: boolean;
  onToggleTimeEntryOnClose: () => void;
  priorityLaneEnabled: boolean;
  onTogglePriorityLane: () => void;
}) {
  const assignees = data.lists.assignees ?? [];
  const labels = data.labels;
  const assigneeOptions = [
    { id: 'all', name: labels.all },
    { id: 'me', name: labels.me },
    { id: 'unassigned', name: labels.unassigned },
    ...assignees.filter((a) => a.id !== null).map((a) => ({ id: String(a.id), name: a.name })),
  ];

  const dueOptions = [
    { id: 'all', name: labels.all },
    { id: 'overdue', name: labels.overdue },
    { id: 'thisweek', name: labels.this_week },
    { id: '3days', name: labels.within_3_days },
    { id: '7days', name: labels.within_1_week },
    { id: '1day', name: labels.within_1_day ?? '1日以内' },
    { id: 'custom', name: labels.within_specified_days ?? '指定した日以内' },
    { id: 'none', name: labels.not_set },
  ];

  const priorityOptions = (data.lists.priorities ?? []).map(p => ({ id: String(p.id), name: p.name }));
  const priorityValue = filters.priorityFilterEnabled ? filters.priority : priorityOptions.map((option) => option.id);

  return (
    <div className="rk-toolbar">
      {canCreate && (
        <>
          <div className="rk-toolbar-group">
            <div
              className="rk-dropdown-trigger"
              onClick={onCreate}
              title={labels.create ?? 'Create'}
              role="button"
            >
              <span className="rk-icon">add</span>
            </div>
          </div>
          <div className="rk-toolbar-separator" />
        </>
      )}
      <div className="rk-toolbar-group">
        <SearchDropdown
          label={labels.filter}
          title={labels.filter_task}
          placeholder={labels.filter_subject}
          value={filters.q}
          onChange={(val) => onChange({ ...filters, q: val })}
        />
      </div>

      <div className="rk-toolbar-separator" />

      <div className="rk-toolbar-group">
        <Dropdown
          label={labels.assignee}
          icon="person"
          options={assigneeOptions}
          value={filters.assignee}
          onChange={(val) => onChange({ ...filters, assignee: val })}
          onReset={() => onChange({ ...filters, assignee: 'all' })}
          closeOnSelect={false}
          labels={labels}
        />
      </div>

      <div className="rk-toolbar-separator" />

      <div className="rk-toolbar-group">
        <MultiSelectDropdown
          label={labels.project}
          icon="folder"
          options={(data.lists.projects ?? []).map((p) => ({
            id: String(p.id),
            name: '\xA0'.repeat(p.level * 2) + p.name,
          }))}
          value={filters.projectIds.map(String)}
          onChange={(val) => {
            onChange({ ...filters, projectIds: val.map(Number) });
          }}
          width="280px"
          labels={labels}
          includeAllOption
          allLabel={labels.all}
        />
      </div>

      <div className="rk-toolbar-separator" />

      <div className="rk-toolbar-group">
        <MultiSelectDropdown
          label={labels.status}
          icon="fact_check"
          options={data.columns.map((c) => ({ id: String(c.id), name: c.name }))}
          value={filters.statusIds.map(String)}
          onChange={(val) => {
            onChange({ ...filters, statusIds: val.map(Number) });
          }}
          width="200px"
          labels={labels}
          includeAllOption
          allLabel={labels.all}
        />
      </div>

      <div className="rk-toolbar-separator" />

      <div className="rk-toolbar-group">
        <MultiSelectDropdown
          label={labels.issue_priority}
          icon="priority_high"
          options={priorityOptions}
          value={priorityValue}
          onChange={(val) => {
            const enabled = val.length !== priorityOptions.length;
            onChange({ ...filters, priority: enabled ? val : [], priorityFilterEnabled: enabled });
          }}
          width="160px"
          labels={labels}
          includeAllOption
          allLabel={labels.all}
        />

        <Dropdown
          label={labels.due}
          icon="calendar_month"
          options={dueOptions}
          value={filters.due}
          onChange={(val) => onChange({ ...filters, due: val as any })}
          onReset={() => onChange({ ...filters, due: 'all' })}
          width="180px"
          closeOnSelect={false}
          labels={labels}
        />

        {filters.due === 'custom' && (
          <input
            type="number"
            min="1"
            className="rk-input"
            style={{ width: '60px', marginLeft: '6px', height: '32px', padding: '0 8px' }}
            value={filters.dueDays ?? 7}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (!Number.isNaN(val) && val > 0) {
                onChange({ ...filters, dueDays: val });
              }
            }}
          />
        )}
      </div>

      <div className="rk-toolbar-separator" />

      <div className="rk-toolbar-group rk-sort">
        <SortButton
          active={sortKey.startsWith('due_')}
          direction={sortKey === 'due_asc' ? 'asc' : sortKey === 'due_desc' ? 'desc' : null}
          label={labels.issue_due_date}
          onClick={() => {
            if (sortKey === 'due_asc') onChangeSort('due_desc');
            else onChangeSort('due_asc');
          }}
        />
        <SortButton
          active={sortKey.startsWith('priority_')}
          direction={sortKey === 'priority_asc' ? 'asc' : sortKey === 'priority_desc' ? 'desc' : null}
          label={labels.issue_priority}
          onClick={() => {
            if (sortKey === 'priority_desc') onChangeSort('priority_asc');
            else onChangeSort('priority_desc');
          }}
        />
        <SortButton
          active={sortKey.startsWith('updated_')}
          direction={sortKey === 'updated_asc' ? 'asc' : sortKey === 'updated_desc' ? 'desc' : null}
          label={data.labels.updated}
          onClick={() => {
            if (sortKey === 'updated_desc') onChangeSort('updated_asc');
            else onChangeSort('updated_asc');
          }}
        />
      </div>

      <div className="rk-toolbar-spacer" />

      <div className="rk-toolbar-group">
        <button
          type="button"
          className={`rk-btn ${priorityLaneEnabled ? 'rk-btn-toggle-active' : ''}`}
          onClick={onTogglePriorityLane}
          title={priorityLaneEnabled ? labels.hide_priority_lanes : labels.show_priority_lanes}
        >
          <span className="rk-icon">view_stream</span>
        </button>

        <button
          type="button"
          className={`rk-btn ${timeEntryOnClose ? 'rk-btn-toggle-active' : ''}`}
          onClick={onToggleTimeEntryOnClose}
          title={timeEntryOnClose ? (labels.disable_time_entry_on_close ?? 'Disable time entry on close') : (labels.enable_time_entry_on_close ?? 'Enable time entry on close')}
        >
          <span className="rk-icon">schedule</span>
        </button>

        <button
          type="button"
          className={`rk-btn ${fitMode !== 'none' ? 'rk-btn-toggle-active' : ''}`}
          onClick={onToggleFitMode}
          title={
            fitMode === 'none' ? labels.fit_none :
              fitMode === 'width' ? labels.fit_width :
                labels.fit_all
          }
        >
          <span className="rk-icon">
            {fitMode === 'none' ? 'zoom_in' : 'fit_screen'}
          </span>
        </button>

        <button
          type="button"
          className={`rk-btn ${showSubtasks ? 'rk-btn-toggle-active' : ''}`}
          onClick={onToggleShowSubtasks}
          title={showSubtasks ? labels?.hide_subtasks : labels?.show_subtasks}
        >
          <span className="rk-icon">{showSubtasks ? 'check_box' : 'check_box_outline_blank'}</span>
        </button>

        <button type="button" className="rk-btn" onClick={onToggleFullWindow} title={fullWindow ? labels.normal_view : labels.fullscreen_view}>
          <span className="rk-icon">{fullWindow ? 'fullscreen_exit' : 'fullscreen'}</span>
        </button>

        <button type="button" className="rk-btn" onClick={onScrollToTop} title="Top">
          <span className="rk-icon">vertical_align_top</span>
        </button>

        <Dropdown
          label={`${fontSize}px`}
          icon="format_size"
          options={[
            { id: '10', name: '10px' },
            { id: '12', name: '12px' },
            { id: '14', name: '14px' },
            { id: '16', name: '16px' },
            { id: '18', name: '18px' },
            { id: '20', name: '20px' },
            { id: '22', name: '22px' },
            { id: '24', name: '24px' },
            { id: '26', name: '26px' },
            { id: '28', name: '28px' },
            { id: '30', name: '30px' },
          ]}
          value={String(fontSize)}
          onChange={(val) => onChangeFontSize(Number(val))}
          width="100px"
          closeOnSelect={false}
          labels={labels}
        />
      </div>
    </div >
  );
}

function SortButton({
  active,
  direction,
  label,
  onClick,
}: {
  active: boolean;
  direction: 'asc' | 'desc' | null;
  label: string;
  onClick: () => void;
}) {
  const arrow = direction === 'asc' ? 'arrow_upward' : direction === 'desc' ? 'arrow_downward' : 'sort';
  return (
    <button type="button" className={`rk-btn ${active ? 'rk-btn-toggle-active' : ''}`} onClick={onClick}>
      <span className="rk-icon" style={{ fontSize: '18px' }}>{arrow}</span>
      {label}
    </button>
  );
}

function linkifyText(text: string): React.ReactNode[] {
  const re = /https?:\/\/[^\s<>()]+/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const raw = m[0];
    if (start > lastIndex) nodes.push(text.slice(lastIndex, start));

    let url = raw;
    while (/[),.;:!?]$/.test(url)) url = url.slice(0, -1);
    const trailing = raw.slice(url.length);

    nodes.push(
      <a key={`${start}:${url}`} href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </a>
    );
    if (trailing) nodes.push(trailing);

    lastIndex = start + raw.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function IssueModal({
  data,
  ctx,
  onClose,
  onSaved,
  onDeleted,
}: {
  data: BoardData;
  ctx: ModalContext;
  onClose: () => void;
  onSaved: (payload: Record<string, unknown>, isEdit: boolean) => Promise<void>;
  onDeleted: (issueId: number) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const labels = data.labels;

  const issue = ctx.issueId ? data.issues.find((i) => i.id === ctx.issueId) : null;
  const isEdit = !!issue;
  const canDelete = isEdit && data.meta.can_delete;

  const [subtasksSubjects, setSubtasksSubjects] = useState(''); // Renamed from 'subjects'

  const defaultTracker = data.lists.trackers?.[0]?.id ?? '';
  const defaultAssignee = (() => {
    if (isEdit) return issue?.assigned_to_id ? String(issue.assigned_to_id) : '';
    if (data.meta.lane_type !== 'assignee') return '';
    if (!ctx.laneId) return '';
    if (ctx.laneId === 'unassigned' || ctx.laneId === 'none') return '';
    return String(ctx.laneId);
  })();

  const [subject, setSubject] = useState(issue?.subject ?? '');
  const [projectId, setProjectId] = useState(issue?.project?.id ? String(issue.project.id) : String(data.meta.project_id));
  const [trackerId, setTrackerId] = useState(issue?.tracker_id ? String(issue.tracker_id) : String(defaultTracker));
  const [assigneeId, setAssigneeId] = useState(issue?.assigned_to_id ? String(issue.assigned_to_id) : defaultAssignee);
  const [dueDate, setDueDate] = useState(issue?.due_date ?? '');
  const [startDate, setStartDate] = useState(issue?.start_date ?? '');
  const [priorityId, setPriorityId] = useState(issue?.priority_id ? String(issue.priority_id) : '');
  const [doneRatio, setDoneRatio] = useState(issue?.done_ratio ?? 0);
  const [description, setDescription] = useState(issue?.description ?? '');
  const hasDescriptionPreview = description.trim().length > 0 && /https?:\/\//.test(description);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, saving]);

  const submit = async () => {
    setErr(null);
    const trackerIdNum = Number(trackerId);
    if (!Number.isFinite(trackerIdNum) || trackerIdNum <= 0) {
      setErr(labels.select_tracker);
      return;
    }

    const assigneeIdNum = assigneeId === '' ? null : Number(assigneeId);
    if (assigneeIdNum !== null && (!Number.isFinite(assigneeIdNum) || assigneeIdNum <= 0)) {
      setErr(labels.invalid_assignee);
      return;
    }

    const priorityIdNum = priorityId === '' ? null : Number(priorityId);
    if (priorityIdNum !== null && (!Number.isFinite(priorityIdNum) || priorityIdNum <= 0)) {
      setErr(labels.invalid_priority);
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        subject,
        tracker_id: trackerIdNum,
        assigned_to_id: assigneeIdNum,
        start_date: startDate.trim() ? startDate : null,
        due_date: dueDate.trim() ? dueDate : null,
        priority_id: priorityIdNum,
        done_ratio: doneRatio,
        description,
        status_id: ctx.statusId,
        project_id: projectId,
      };

      if (!isEdit && subtasksSubjects.trim().length > 0) {
        const lines = subtasksSubjects.split('\n').map(s => s.trim()).filter(s => s.length > 0);
        if (lines.length > 0) {
          payload.subtasks_subjects = lines;
        }
      }

      await onSaved(payload, isEdit);
    } catch (e: any) {
      setErr(e?.message ?? (isEdit ? labels.update_failed : labels.create_failed));
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (!issue) return;
    setErr(null);
    void onDeleted(issue.id);
  };

  return (
    <div className="rk-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="rk-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rk-modal-head">
        </div>

        <form className="rk-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}> {/* Changed to form and added onSubmit */}
          <label className="rk-field">
            <span className="rk-label">{labels.issue_subject}</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} autoFocus />
          </label>

          <label className="rk-field">
            <span className="rk-label">{labels.project}</span>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={isEdit}>
              {data.lists.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {'\u00A0'.repeat(p.level * 2)}{p.name}
                </option>
              ))}
            </select>
          </label>

          <div className="rk-row2">
            <label className="rk-field">
              <span className="rk-label">{labels.issue_tracker}</span>
              <select value={trackerId} onChange={(e) => setTrackerId(e.target.value)}>
                {data.lists.trackers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="rk-field">
              <span className="rk-label">{labels.issue_assignee}</span>
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                <option value="">{labels.not_set}</option>
                {data.lists.assignees.map((a) => (
                  <option key={String(a.id)} value={a.id ?? ''}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="rk-row2">
            <label className="rk-field">
              <span className="rk-label">{labels.issue_done_ratio}</span>
              <select value={doneRatio} onChange={(e) => setDoneRatio(Number(e.target.value))}>
                {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((r) => (
                  <option key={r} value={r}>
                    {r}%
                  </option>
                ))}
              </select>
            </label>

            <label className="rk-field">
              <span className="rk-label">{labels.issue_priority}</span>
              <select value={priorityId} onChange={(e) => setPriorityId(e.target.value)}>
                <option value="">{labels.not_set}</option>
                {data.lists.priorities.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="rk-row2">
            <label className="rk-field">
              <span className="rk-label">{labels.issue_start_date}</span>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>

            <label className="rk-field">
              <span className="rk-label">{labels.issue_due_date}</span>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </label>
          </div>

          <label className="rk-field">
            <span className="rk-label">{labels.issue_description}</span>
            <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>

          {hasDescriptionPreview ? (
            <div className="rk-desc-preview" aria-label={labels.issue_description}>
              <div className="rk-desc-preview-title">{labels.url_clickable}</div>
              <div className="rk-desc-preview-body">{linkifyText(description)}</div>
            </div>
          ) : null}

          {!isEdit && (
            <label className="rk-field" style={{ marginTop: '16px', borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
              <span className="rk-label">{labels?.bulk_subtask_title}</span>
              <textarea
                className="rk-textarea"
                rows={3}
                value={subtasksSubjects}
                onChange={(e) => setSubtasksSubjects(e.target.value)}
                placeholder={labels?.bulk_subtask_help}
              />
            </label>
          )}

          {err ? <div className="rk-error">{err}</div> : null}
        </form> {/* Closed form tag */}

        <div className="rk-modal-actions">
          {isEdit && ctx.issueId && (
            <button
              type="button"
              className="rk-btn rk-btn-danger"
              style={{ marginRight: 'auto' }}
              onClick={() => {
                if (confirm((data.labels.delete_confirm_message).replace('%{id}', String(ctx.issueId)))) {
                  onDeleted(ctx.issueId!);
                  onClose();
                }
              }}
            >
              {labels.delete}
            </button>
          )}
          <button type="button" className="rk-btn" onClick={onClose} disabled={saving}>
            {labels.cancel}
          </button>
          <button type="submit" className="rk-btn" disabled={saving}>
            {saving ? labels.saving : (isEdit ? labels.save : labels.create)}
          </button>
        </div>
      </div>
    </div>
  );
}
