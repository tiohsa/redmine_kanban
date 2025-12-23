import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BoardData, Issue } from './types';
import { getJson, postJson } from './http';
import { CanvasBoard } from './board/CanvasBoard';
import { buildBoardState } from './board/state';
import { type SortKey } from './board/sort';
import { replaceIssueInBoard, updateIssueInBoard, useIssueMutation } from './useIssueMutation';

type Props = { dataUrl: string };

type Filters = {
  assignee: 'all' | 'me' | 'unassigned' | string;
  q: string;
  due: 'all' | 'overdue' | 'thisweek' | '3days' | '7days' | 'none';
  priority: string[]; // Multiple selection
  projectIds: number[]; // Multiple selection
  statusIds: number[]; // Multiple selection
};

type ModalContext = { statusId: number; laneId?: string | number; issueId?: number };

type FitMode = 'none' | 'width';

type IssueMutationResult = { issue: Issue; warning?: string };

type MovePayload = {
  issueId: number;
  statusId: number;
  assignedToId: number | null;
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
          priority: Array.isArray(parsed.priority) ? parsed.priority : [],
          projectIds: Array.isArray(parsed.projectIds) ? parsed.projectIds.map(Number) : [],
          statusIds: Array.isArray(parsed.statusIds) ? parsed.statusIds.map(Number) : []
        };
      }
    } catch {
      // ignore
    }
    return { assignee: 'all', q: '', due: 'all', priority: [], projectIds: [], statusIds: [] };
  });
  const [modal, setModal] = useState<ModalContext | null>(null);
  const [pendingDeleteIssue, setPendingDeleteIssue] = useState<Issue | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [iframeEditUrl, setIframeEditUrl] = useState<string | null>(null);
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

  const queryClient = useQueryClient();
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
  const loading = boardQuery.isFetching;

  useEffect(() => {
    if (boardQuery.error) {
      setError(data?.labels.load_failed ?? '読み込みに失敗しました');
    }
  }, [boardQuery.error, data?.labels.load_failed]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: boardQueryKey });
  }, [queryClient, boardQueryKey]);

  const setIssueBusy = useCallback((issueId: number, busy: boolean) => {
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
      localStorage.setItem('rk_filters', JSON.stringify(filters));
    } catch {
      // ignore
    }
  }, [filters]);

  // Filter data based on showSubtasks and statusIds
  const filteredData = useMemo(() => {
    if (!data) return null;
    let res = data;
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
  }, [data, showSubtasks, filters.statusIds]);

  const issues = useMemo(() => {
    let filtered = filterIssues(filteredData?.issues ?? [], filteredData, filters);
    if (pendingDeleteIssue) {
      filtered = filtered.filter((i) => i.id !== pendingDeleteIssue.id);
    }
    return filtered;
  }, [filteredData, filters, pendingDeleteIssue]);
  const priorityRank = useMemo(() => {
    const m = new Map<number, number>();
    for (const [idx, p] of (data?.lists.priorities ?? []).entries()) m.set(p.id, idx);
    return m;
  }, [data]);
  const boardState = useMemo(() => {
    if (!filteredData) return null;
    return buildBoardState(filteredData, issues, sortKey, priorityRank);
  }, [filteredData, issues, sortKey, priorityRank]);

  const openCreate = (ctx: ModalContext) => setModal(ctx);
  const openEdit = (issueId: number) => {
    const issue = data?.issues.find((i) => i.id === issueId);
    if (!issue) return;
    setModal({ statusId: issue.status_id, issueId });
  };

  const moveIssueMutation = useIssueMutation<MovePayload, IssueMutationResult>({
    queryKey: boardQueryKey,
    mutationFn: async (payload) => {
      const res = await postJson<{ ok: boolean; issue: Issue; warning?: string }>(
        `${baseUrl}/issues/${payload.issueId}/move`,
        {
          issue: {
            status_id: payload.statusId,
            assigned_to_id: payload.assignedToId,
            lock_version: payload.lockVersion,
          },
        },
        'PATCH'
      );
      return { issue: res.issue, warning: res.warning };
    },
    applyOptimistic: (prev, payload) =>
      updateIssueInBoard(prev, payload.issueId, (issue) => ({
        ...issue,
        status_id: payload.statusId,
        assigned_to_id: payload.assignedToId,
        assigned_to_name: resolveAssigneeName(prev, payload.assignedToId),
      })),
    applyServer: (prev, result) => replaceIssueInBoard(prev, result.issue),
    onError: (err) => {
      setError(resolveMutationError(err, data?.labels, data?.labels.move_failed));
    },
    onSuccess: (result) => {
      if (result.warning) setNotice(result.warning);
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
    applyServer: (prev, result) => replaceIssueInBoard(prev, result.issue),
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

  const moveIssue = (issueId: number, statusId: number, assignedToId: number | null) => {
    if (!data) return;
    if (busyIssueIds.has(issueId)) return;
    const issue = data.issues.find((it) => it.id === issueId);
    if (!issue) return;
    if (issue.lock_version === undefined || issue.lock_version === null) {
      setError(data.labels.update_failed ?? '更新に失敗しました');
      return;
    }

    setNotice(null);
    moveIssueMutation.mutate({
      issueId,
      statusId,
      assignedToId,
      lockVersion: issue.lock_version,
    });
  };

  const toggleSubtask = (subtaskId: number, currentClosed: boolean) => {
    if (!data) return;
    if (busyIssueIds.has(subtaskId)) return;
    const subtaskInfo = findSubtask(data, subtaskId);
    if (!subtaskInfo) return;
    const targetStatusId = resolveSubtaskStatus(data, currentClosed);
    if (!targetStatusId) {
      setError('サブタスクの更新に失敗しました');
      return;
    }

    if (subtaskInfo.lockVersion === null) {
      setError('サブタスクの更新に失敗しました');
      return;
    }

    setNotice(null);
    moveIssueMutation.mutate({
      issueId: subtaskId,
      statusId: targetStatusId,
      assignedToId: subtaskInfo.assignedToId,
      lockVersion: subtaskInfo.lockVersion,
    });
  };

  const canMove = !!data?.meta.can_move;
  const canCreate = !!data?.meta.can_create;

  const requestDelete = (issueId: number) => {
    const issue = data?.issues.find((i) => i.id === issueId);
    if (!issue) return;

    setPendingDeleteIssue(issue);
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
        setError(res.message || '復元に失敗しました');
      }
    } catch (e: any) {
      setError('復元中にエラーが発生しました');
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
      setError(p?.message || (data ? data.labels.delete_failed : '削除に失敗しました'));
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
                  <span>{`#${pendingDeleteIssue.id} を削除しました（Undoで再作成）`}</span>
                  <button
                    type="button"
                    className="rk-btn rk-btn-primary"
                    style={{ height: '24px', fontSize: '11px', padding: '0 8px' }}
                    onClick={handleUndo}
                    disabled={isRestoring}
                  >
                    {isRestoring ? '復元中...' : '元に戻す'}
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
        />
      ) : (
        <div className="rk-empty">データを取得しています...</div>
      )}

      <div className="rk-board">
        {filteredData && boardState ? (
          <CanvasBoard
            data={filteredData}
            state={boardState}
            canMove={canMove}
            canCreate={canCreate}
            labels={filteredData.labels}
            fitMode={fitMode}
            busyIssueIds={busyIssueIds}
            onCommand={(command) => {
              if (command.type === 'move_issue') {
                moveIssue(command.issueId, command.statusId, command.assignedToId);
              }
            }}
            onCreate={openCreate}
            onCardOpen={openEdit}
            onDelete={requestDelete}
            onEditClick={setIframeEditUrl}
            onSubtaskToggle={toggleSubtask}
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
              const issue = issueId ? data.issues.find((it) => it.id === issueId) : null;
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
                await createIssueMutation.mutateAsync(payload);
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

      {iframeEditUrl && data ? (
        <IframeEditDialog url={iframeEditUrl} labels={data.labels} onClose={() => { setIframeEditUrl(null); refresh(); }} />
      ) : null}
    </div>
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
  if (status === 409 || status === 422) {
    return labels?.conflict ?? '他ユーザにより更新されました';
  }
  const payloadMessage = (error as any)?.payload?.message as string | undefined;
  return payloadMessage || fallback || labels?.update_failed || '更新に失敗しました';
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

type SubtaskInfo = {
  lockVersion: number | null;
  assignedToId: number | null;
};

function findSubtask(data: BoardData, subtaskId: number): SubtaskInfo | null {
  const issue = data.issues.find((it) => it.id === subtaskId);
  if (issue) {
    return {
      lockVersion: issue.lock_version ?? null,
      assignedToId: issue.assigned_to_id ?? null,
    };
  }

  for (const parent of data.issues) {
    const subtask = parent.subtasks?.find((it) => it.id === subtaskId);
    if (subtask) {
      return {
        lockVersion: subtask.lock_version ?? null,
        assignedToId: null,
      };
    }
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

    if (filters.priority.length > 0) {
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
}: {
  label: string;
  icon: string;
  options: { id: T; name: string }[];
  value: T;
  onChange: (id: T) => void;
  onReset?: () => void;
  width?: string;
  closeOnSelect?: boolean;
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
                リセット
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
}: {
  label: string;
  icon: string;
  options: { id: string; name: string }[];
  value: string[];
  onChange: (ids: string[]) => void;
  onReset?: () => void;
  width?: string;
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

  const selectedCount = value.length;

  return (
    <div className="rk-dropdown-container">
      <div
        ref={triggerRef}
        className={`rk-dropdown-trigger ${open ? 'rk-active' : ''}`}
        onClick={() => setOpen(!open)}
        title={value.length > 0 ? value.map(v => options.find(o => o.id === v)?.name).join(', ') : label}
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
                リセット
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
                autoFocus
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
              />
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
    { id: 'none', name: labels.not_set },
  ];

  const priorityOptions = [
    { id: 'all', name: labels.all },
    ...(data.lists.priorities ?? []).map(p => ({ id: String(p.id), name: p.name }))
  ];

  return (
    <div className="rk-toolbar">
      <div className="rk-toolbar-group">
        <SearchDropdown
          label={labels.filter ?? 'フィルタ'}
          title={labels.filter_task ?? 'タスクの絞り込み'}
          placeholder={labels.filter_subject ?? '題名で絞り込み...'}
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
        />
      </div>

      <div className="rk-toolbar-separator" />

      <div className="rk-toolbar-group">
        <MultiSelectDropdown
          label={labels.project ?? 'プロジェクト'}
          icon="folder"
          options={(data.lists.projects ?? []).map((p) => ({
            id: String(p.id),
            name: '\xA0'.repeat(p.level * 2) + p.name,
          }))}
          value={filters.projectIds.map(String)}
          onChange={(val) => {
            onChange({ ...filters, projectIds: val.map(Number) });
          }}
          onReset={() => {
            onChange({ ...filters, projectIds: [] });
          }}
          width="280px"
        />
      </div>

      <div className="rk-toolbar-separator" />

      <div className="rk-toolbar-group">
        <MultiSelectDropdown
          label={labels.status ?? 'ステータス'}
          icon="fact_check"
          options={data.columns.map((c) => ({ id: String(c.id), name: c.name }))}
          value={filters.statusIds.map(String)}
          onChange={(val) => {
            onChange({ ...filters, statusIds: val.map(Number) });
          }}
          onReset={() => {
            onChange({ ...filters, statusIds: [] });
          }}
          width="200px"
        />
      </div>

      <div className="rk-toolbar-separator" />

      <div className="rk-toolbar-group">
        <MultiSelectDropdown
          label={labels.issue_priority}
          icon="priority_high"
          options={priorityOptions}
          value={filters.priority}
          onChange={(val) => onChange({ ...filters, priority: val })}
          onReset={() => onChange({ ...filters, priority: [] })}
          width="160px"
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
        />
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
          label={data.labels.updated ?? '更新'}
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
          title={showSubtasks ? '子チケットを非表示' : '子チケットを表示'}
        >
          <span className="rk-icon">{showSubtasks ? 'check_box' : 'check_box_outline_blank'}</span>
        </button>

        <button type="button" className="rk-btn" onClick={onToggleFullWindow} title={fullWindow ? labels.normal_view : labels.fullscreen_view}>
          <span className="rk-icon">{fullWindow ? 'fullscreen_exit' : 'fullscreen'}</span>
        </button>

        <button type="button" className="rk-btn" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} title="Top">
          <span className="rk-icon">vertical_align_top</span>
        </button>
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
      await onSaved({
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
      }, isEdit);
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

        <div className="rk-form">
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
                <option value="">（{labels.not_set}）</option>
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
              <div className="rk-desc-preview-title">{labels.no_result}（URLをクリックできます）</div>
              <div className="rk-desc-preview-body">{linkifyText(description)}</div>
            </div>
          ) : null}

          {err ? <div className="rk-error">{err}</div> : null}
        </div>

        <div className="rk-modal-actions">
          {canDelete ? (
            <button
              type="button"
              className="rk-btn rk-btn-danger"
              onClick={remove}
              disabled={saving}
              style={{ marginRight: 'auto' }}
            >
              削除
            </button>
          ) : null}
          <button type="button" className="rk-btn" onClick={onClose} disabled={saving}>
            キャンセル
          </button>
          <button type="button" className="rk-btn rk-btn-primary" onClick={submit} disabled={saving}>
            {saving ? '保存中...' : (isEdit ? '保存' : '作成')}
          </button>
        </div>
      </div>
    </div>
  );
}

function IframeEditDialog({ url, labels, onClose }: { url: string; labels: Record<string, string>; onClose: () => void }) {
  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="rk-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={labels.issue_priority}
      onClick={onClose}
    >
      <div className="rk-iframe-dialog" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="rk-iframe-dialog-close"
          onClick={onClose}
          aria-label={labels.close}
        >
          ×
        </button>
        <iframe className="rk-iframe-dialog-frame" src={url} />
      </div>
    </div>
  );
}
