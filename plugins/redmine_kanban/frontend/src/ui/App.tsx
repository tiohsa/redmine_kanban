import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { BoardData, Issue } from './types';
import { getJson, postJson } from './http';
import { CanvasBoard } from './board/CanvasBoard';
import { buildBoardState } from './board/state';
import { type SortKey } from './board/sort';

type Props = { dataUrl: string };

type Filters = {
  assignee: 'all' | 'me' | 'unassigned' | string;
  q: string;
  due: 'all' | 'overdue' | 'thisweek' | '3days' | '7days' | 'none';
  priority: string[]; // Multiple selection
};

type ModalContext = { statusId: number; laneId?: string | number; issueId?: number };

function AiAnalysisModal({
  onClose,
  result,
  loading,
  labels,
}: {
  onClose: () => void;
  result: string | null;
  loading: boolean;
  labels: Record<string, string>;
}) {
  return (
    <div className="rk-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="rk-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rk-modal-head">
          <h3>{labels.summary}</h3>
          <button type="button" className="rk-btn rk-btn-ghost" onClick={onClose} aria-label={labels.close}>
            ×
          </button>
        </div>
        <div className="rk-form">
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <div
                style={{
                  display: 'inline-block',
                  width: '40px',
                  height: '40px',
                  border: '4px solid #f3f3f3',
                  borderTop: '4px solid var(--rk-primary)',
                  borderRadius: '50%',
                  animation: 'rk-spin 1s linear infinite',
                }}
              />
              <p style={{ marginTop: '16px', color: 'var(--rk-text-secondary)' }}>{labels.analyzing}</p>
            </div>
          ) : (
            <div
              className="rk-analysis-result"
              style={{
                lineHeight: '1.6',
                color: 'var(--rk-text-primary)',
                fontSize: '0.95rem',
                maxHeight: '60vh',
                overflowY: 'auto',
                padding: '12px',
                background: '#f8fafc',
                borderRadius: '8px',
                border: '1px solid var(--rk-border)',
              }}
            >
              <ReactMarkdown>{result || ''}</ReactMarkdown>
            </div>
          )}
        </div>
        <div className="rk-modal-actions">
          <button type="button" className="rk-btn" onClick={onClose}>
            {labels.close}
          </button>
        </div>
      </div>
    </div>
  );
}

export function App({ dataUrl }: Props) {
  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(false);
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
          priority: Array.isArray(parsed.priority) ? parsed.priority : []
        };
      }
    } catch {
      // ignore
    }
    return { assignee: 'all', q: '', due: 'all', priority: [] };
  });
  const [modal, setModal] = useState<ModalContext | null>(null);
  const [pendingDeleteIssue, setPendingDeleteIssue] = useState<Issue | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [iframeEditUrl, setIframeEditUrl] = useState<string | null>(null);
  const [fullWindow, setFullWindow] = useState(() => {
    try {
      return localStorage.getItem('rk_fullwindow') === '1';
    } catch {
      return false;
    }
  });
  const [fitToScreen, setFitToScreen] = useState(() => {
    try {
      return localStorage.getItem('rk_fit_to_screen') === '1';
    } catch {
      return false;
    }
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

  const baseUrl = useMemo(() => dataUrl.replace(/\/data$/, ''), [dataUrl]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await getJson<BoardData>(`${baseUrl}/data`);
      setData(json);
    } catch (e) {
      setError(data?.labels.load_failed ?? '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  const handleAnalyze = async () => {
    if (!data) return;
    setAnalysisOpen(true);
    if (analysisResult) return;

    setAnalyzing(true);
    setAnalysisResult(null);
    try {
      const currentIssues = filterIssues(data.issues, data, filters);
      const res = await postJson<{ result?: string; error?: string }>(`${baseUrl}/analyze`, { issues: currentIssues });
      if (res.error) {
        setAnalysisResult(`${data.labels.error}: ${res.error}`);
      } else {
        setAnalysisResult(res.result ?? data.labels.no_result);
      }
    } catch (e: any) {
      setAnalysisResult(`${data.labels.error}: ${e.message}`);
    } finally {
      setAnalyzing(false);
    }
  };

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

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
      localStorage.setItem('rk_fit_to_screen', fitToScreen ? '1' : '0');
    } catch {
      // ignore
    }
  }, [fitToScreen]);

  React.useEffect(() => {
    try {
      localStorage.setItem('rk_sortkey', sortKey);
    } catch {
      // ignore
    }
  }, [sortKey]);

  // Filter data based on showSubtasks
  const filteredData = useMemo(() => {
    if (!data) return null;
    if (showSubtasks) return data;

    // Filter out issues that have a parent_id (subtasks)
    return {
      ...data,
      issues: data.issues.filter(issue => !issue.parent_id)
    };
  }, [data, showSubtasks]);

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

  const moveIssue = async (issueId: number, statusId: number, assignedToId: number | null) => {
    if (data) {
      setData({
        ...data,
        issues: data.issues.map((issue) =>
          issue.id === issueId
            ? { ...issue, status_id: statusId, assigned_to_id: assignedToId }
            : issue
        ),
      });
    }

    try {
      setNotice(null);
      const res = await postJson<{ ok: boolean; message?: string; warning?: string }>(
        `${baseUrl}/issues/${issueId}/move`,
        { status_id: statusId, assigned_to_id: assignedToId },
        'PATCH'
      );
      if (res.warning) setNotice(res.warning);
      await refresh();
    } catch (e: any) {
      const payload = e?.payload as any;
      setNotice(payload?.message ?? (data ? data.labels.move_failed : '移動に失敗しました'));
      await refresh();
    }
  };

  const toggleSubtask = async (subtaskId: number, currentClosed: boolean) => {
    if (!data) return;

    // Optimistic update
    setData((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        issues: prev.issues.map((issue) => {
          if (!issue.subtasks) return issue;
          const found = issue.subtasks.find((s) => s.id === subtaskId);
          if (!found) return issue;
          return {
            ...issue,
            subtasks: issue.subtasks.map((s) =>
              s.id === subtaskId ? { ...s, is_closed: !currentClosed } : s
            ),
          };
        }),
      };
    });

    try {
      // Find a closed status if we are closing, or open status if opening.
      // This logic is tricky because we don't know which status to pick.
      // We will look at available columns (which are statuses) to find one that matches.

      let targetStatusId: number | null = null;

      if (!currentClosed) {
        // We want to close it. Find a closed status.
        const closedCol = data.columns.find(c => c.is_closed);
        if (closedCol) targetStatusId = closedCol.id;
      } else {
        // We want to open it. Find an open status (first one preferably).
        const openCol = data.columns.find(c => !c.is_closed);
        if (openCol) targetStatusId = openCol.id;
      }

      if (!targetStatusId) {
        throw new Error("Cannot determine target status for toggle");
      }

      await postJson(
        `${baseUrl}/issues/${subtaskId}/move`, // using move endpoint which handles status change
        { status_id: targetStatusId },
        'PATCH'
      );
      // We don't need to refresh if optimistic update is correct, but safer to refresh or let it be.
      // But subtask status change might affect parent's done_ratio if calculated.
      // Let's refresh silently or debounce.
      await refresh();

    } catch (e: any) {
      console.error(e);
      setError('サブタスクの更新に失敗しました');
      await refresh(); // Revert
    }
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
        setPendingDeleteIssue(null);
        await refresh();
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
          onAnalyze={handleAnalyze}
          fitToScreen={fitToScreen}
          onToggleFitToScreen={() => setFitToScreen(!fitToScreen)}
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
            labels={data.labels}
            fitToScreen={fitToScreen}
            onCommand={(command) => {
              if (command.type === 'move_issue') {
                void moveIssue(command.issueId, command.statusId, command.assignedToId);
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
            try {
              setNotice(null);
              const method = isEdit ? 'PATCH' : 'POST';
              const url = isEdit ? `${baseUrl}/issues/${modal.issueId}` : `${baseUrl}/issues`;
              await postJson(url, payload, method);
              setModal(null);
              await refresh();
            } catch (e: any) {
              const p = e?.payload as any;
              throw new Error(p?.message || fieldError(p?.field_errors) || (isEdit ? data.labels.update_failed : data.labels.create_failed));
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


      {analysisOpen && data ? (
        <AiAnalysisModal
          onClose={() => setAnalysisOpen(false)}
          result={analysisResult}
          loading={analyzing}
          labels={data.labels}
        />
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
  fitToScreen,
  onToggleFitToScreen,
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
  fitToScreen: boolean;
  onToggleFitToScreen: () => void;
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
        <span className="rk-icon">sort</span>
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
            else onChangeSort('updated_desc');
          }}
        />
      </div>

      <div className="rk-toolbar-spacer" />

      <div className="rk-toolbar-group">
        <button type="button" className="rk-btn rk-btn-primary" onClick={onAnalyze} title={labels.analyze}>
          <span className="rk-icon">auto_awesome</span>
          {labels.analyze}
        </button>

        <button
          type="button"
          className="rk-btn"
          onClick={onToggleFitToScreen}
          title="Fit to Screen"
        >
          <span className="rk-icon">{fitToScreen ? 'zoom_in' : 'fit_screen'}</span>
          {fitToScreen ? '100%' : 'Fit'}
        </button>

        <button
          type="button"
          className={`rk-btn ${showSubtasks ? 'rk-btn-toggle-active' : ''}`}
          onClick={onToggleShowSubtasks}
          title={showSubtasks ? '子チケットを非表示' : '子チケットを表示'}
        >
          <span className="rk-icon">{showSubtasks ? 'check_box' : 'check_box_outline_blank'}</span>
          子チケット
        </button>

        <button type="button" className="rk-btn" onClick={onToggleFullWindow} title={fullWindow ? labels.normal_view : labels.fullscreen_view}>
          <span className="rk-icon">{fullWindow ? 'fullscreen_exit' : 'fullscreen'}</span>
        </button>

        <button type="button" className="rk-btn" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} title="Top">
          <span className="rk-icon">vertical_align_top</span>
        </button>
      </div>
    </div>
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
  const suffix = direction === 'asc' ? 'arrow_upward' : direction === 'desc' ? 'arrow_downward' : '';
  return (
    <button type="button" className={`rk-btn rk-btn-sm ${active ? 'rk-btn-toggle-active' : ''}`} onClick={onClick}>
      {label}
      {suffix && <span className="rk-icon" style={{ fontSize: '14px' }}>{suffix}</span>}
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
