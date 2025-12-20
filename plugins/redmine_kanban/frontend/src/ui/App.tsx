import React, { useCallback, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { DndContext, PointerSensor, useDroppable, useDraggable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { BoardData, Column, Issue, Lane } from './types';
import { getJson, postJson } from './http';
import { CanvasBoard } from './components/CanvasBoard';

type Props = { dataUrl: string };

type Filters = {
  assignee: 'all' | 'me' | 'unassigned' | string;
  q: string;
  due: 'all' | 'overdue' | 'thisweek' | 'none';
};

type ModalContext = { statusId: number; laneId?: string | number; issueId?: number };

type SortKey =
  | 'updated_desc'
  | 'updated_asc'
  | 'due_asc'
  | 'due_desc'
  | 'priority_desc'
  | 'priority_asc';

function AiAnalysisModal({
  onClose,
  result,
  loading,
}: {
  onClose: () => void;
  result: string | null;
  loading: boolean;
}) {
  return (
    <div className="rk-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="rk-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rk-modal-head">
          <h3>AI分析レポート</h3>
          <button type="button" className="rk-btn rk-btn-ghost" onClick={onClose} aria-label="閉じる">
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
              <p style={{ marginTop: '16px', color: 'var(--rk-text-secondary)' }}>分析中...</p>
              <style>{`
                @keyframes rk-spin {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
                }
              `}</style>
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
            閉じる
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
  const [filters, setFilters] = useState<Filters>({ assignee: 'all', q: '', due: 'all' });
  const [modal, setModal] = useState<ModalContext | null>(null);
  const [confirmDeleteIssueId, setConfirmDeleteIssueId] = useState<number | null>(null);
  const [deletingIssueId, setDeletingIssueId] = useState<number | null>(null);
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
      setError('読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  const handleAnalyze = async () => {
    if (!data) return;
    setAnalysisOpen(true);
    if (analysisResult) return; // cache previous result or clear it elsewhere

    setAnalyzing(true);
    setAnalysisResult(null);
    try {
      // Filter current view issues
      const currentIssues = filterIssues(data.issues, data, filters);
      const res = await postJson<{ result?: string; error?: string }>(`${baseUrl}/analyze`, { issues: currentIssues });
      if (res.error) {
        setAnalysisResult(`エラーが発生しました: ${res.error}`);
      } else {
        setAnalysisResult(res.result ?? '結果が空でした');
      }
    } catch (e: any) {
      setAnalysisResult(`通信エラー: ${e.message}`);
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
      localStorage.setItem('rk_sortkey', sortKey);
    } catch {
      // ignore
    }
  }, [sortKey]);

  const columns = data?.columns ?? [];
  const lanes = data?.lanes ?? [];
  const issues = useMemo(() => filterIssues(data?.issues ?? [], data, filters), [data, filters]);
  const priorityRank = useMemo(() => {
    const m = new Map<number, number>();
    for (const [idx, p] of (data?.lists.priorities ?? []).entries()) m.set(p.id, idx);
    return m;
  }, [data]);

  const statusInfo = useMemo(() => {
    const m = new Map<number, Column>();
    for (const c of columns) m.set(c.id, c);
    return m;
  }, [columns]);

  const openCreate = (ctx: ModalContext) => setModal(ctx);
  const openEdit = (issueId: number) => {
    const issue = data?.issues.find((i) => i.id === issueId);
    if (!issue) return;
    setModal({ statusId: issue.status_id, issueId });
  };

  const moveIssue = async (issueId: number, statusId: number, assignedToId: number | null) => {
    // Optimistic update: immediately update local state
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
      setNotice(payload?.message ?? '移動に失敗しました');
      await refresh(); // ロールバック目的
    }
  };

  const canMove = !!data?.meta.can_move;
  const canCreate = !!data?.meta.can_create;

  const requestDelete = (issueId: number) => {
    setConfirmDeleteIssueId(issueId);
  };

  const deleteIssue = async (issueId: number) => {
    setDeletingIssueId(issueId);
    try {
      setNotice(null);
      await postJson(`${baseUrl}/issues/${issueId}`, {}, 'DELETE');
      setModal(null);
      await refresh();
    } catch (e: any) {
      const p = e?.payload as any;
      setError(p?.message || '削除に失敗しました');
    } finally {
      setDeletingIssueId(null);
    }
  };

  return (
    <div className={`rk-root${fullWindow ? ' rk-root-fullwindow' : ''}`}>


      <div className="rk-popup-host" aria-live="polite" aria-relevant="additions text">
        {loading ? (
          <div className="rk-popup rk-popup-info" role="dialog" aria-label="読み込み中">
            <div className="rk-popup-head">
              <div className="rk-popup-title">読み込み中</div>
            </div>
            <div className="rk-popup-body">データを取得しています...</div>
          </div>
        ) : null}

        {notice ? (
          <div className="rk-popup rk-popup-warn" role="dialog" aria-label="通知">
            <div className="rk-popup-head">
              <div className="rk-popup-title">通知</div>
              <button type="button" className="rk-icon-btn rk-popup-close" aria-label="閉じる" onClick={() => setNotice(null)}>
                ×
              </button>
            </div>
            <div className="rk-popup-body">{notice}</div>
          </div>
        ) : null}

        {error ? (
          <div className="rk-popup rk-popup-error" role="dialog" aria-label="エラー" aria-live="assertive">
            <div className="rk-popup-head">
              <div className="rk-popup-title">エラー</div>
              <button type="button" className="rk-icon-btn rk-popup-close" aria-label="閉じる" onClick={() => setError(null)}>
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
        />
      ) : (
        <div className="rk-empty">データ取得中...</div>
      )}

      <div className="rk-board" style={{ height: 'calc(100vh - 100px)', overflow: 'hidden' }}>
        {data ? (
           // Switch to CanvasBoard
           <CanvasBoard initialData={data} baseUrl={baseUrl} />
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
              throw new Error(p?.message || fieldError(p?.field_errors) || (isEdit ? '更新に失敗しました' : '作成に失敗しました'));
            }
          }}
          onDeleted={async (issueId) => {
            requestDelete(issueId);
          }}
        />
      ) : null}

      {iframeEditUrl ? (
        <IframeEditDialog url={iframeEditUrl} onClose={() => { setIframeEditUrl(null); refresh(); }} />
      ) : null}

      {confirmDeleteIssueId !== null ? (
        <ConfirmDialog
          title="削除確認"
          message={`タスク #${confirmDeleteIssueId} を削除します。よろしいですか？`}
          confirmText={deletingIssueId === confirmDeleteIssueId ? '削除中...' : '削除'}
          confirmKind="danger"
          confirmDisabled={deletingIssueId !== null}
          onCancel={() => setConfirmDeleteIssueId(null)}
          onConfirm={async () => {
            const id = confirmDeleteIssueId;
            await deleteIssue(id);
            setConfirmDeleteIssueId(null);
          }}
        />
      ) : null}

      {analysisOpen ? (
        <div className="rk-modal-backdrop" role="dialog" aria-modal="true" aria-label="AI分析" onClick={() => !analyzing && setAnalysisOpen(false)}>
          <div className="rk-modal" onClick={(e) => e.stopPropagation()}>
            <div className="rk-modal-head">
              <h3>⚡ AI分析</h3>
            </div>

            <div className="rk-form">
              {analyzing ? (
                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--rk-text-secondary)' }}>
                  <div style={{ fontSize: '1.2rem', marginBottom: '16px' }}>🤖</div>
                  <div>AIがタスクを分析しています...</div>
                  <div style={{ marginTop: '8px', fontSize: '0.8rem' }}>これには数秒から数十秒かかる場合があります</div>
                </div>
              ) : analysisResult ? (
                <div style={{ lineHeight: 1.6, fontSize: '0.95rem', userSelect: 'text' }}>
                  <ReactMarkdown>{analysisResult}</ReactMarkdown>
                </div>
              ) : (
                <div style={{ padding: '20px', textAlign: 'center' }}>結果がありません</div>
              )}
            </div>

            <div className="rk-modal-actions">
              <button type="button" className="rk-btn" onClick={() => setAnalysisOpen(false)} disabled={analyzing}>
                閉じる
              </button>
            </div>
          </div>
        </div>
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
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmText: string;
  confirmKind: 'danger' | 'primary';
  confirmDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const confirmClass = confirmKind === 'danger' ? 'rk-btn rk-btn-danger' : 'rk-btn rk-btn-primary';
  return (
    <div className="rk-modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="rk-modal rk-modal-sm">
        <div className="rk-modal-head">
          <h3>{title}</h3>
          <button type="button" className="rk-btn rk-btn-ghost" onClick={onCancel} aria-label="閉じる">
            ×
          </button>
        </div>
        <div className="rk-confirm-body">{message}</div>
        <div className="rk-modal-actions">
          <button type="button" className="rk-btn" onClick={onCancel} disabled={!!confirmDisabled}>
            キャンセル
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

function filterIssues(issues: Issue[], data: BoardData | null, filters: Filters): Issue[] {
  const q = filters.q.trim().toLowerCase();
  const now = new Date();
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

    if (filters.due !== 'all') {
      if (!it.due_date) return filters.due === 'none';
      if (filters.due === 'none') return false;

      const due = parseISODate(it.due_date);
      if (!due) return false;
      const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      if (filters.due === 'overdue') return due < today0;
      if (filters.due === 'thisweek') return due >= start && due <= end;
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

function Toolbar({
  data,
  filters,
  onChange,
  sortKey,
  onChangeSort,
  fullWindow,
  onToggleFullWindow,
  onAnalyze,
}: {
  data: BoardData;
  filters: Filters;
  onChange: (f: Filters) => void;
  sortKey: SortKey;
  onChangeSort: (k: SortKey) => void;
  fullWindow: boolean;
  onToggleFullWindow: () => void;
  onAnalyze: () => void;
}) {
  const assignees = data.lists.assignees ?? [];
  const options = [
    { id: 'all', name: '全員' },
    { id: 'me', name: '自分' },
    { id: 'unassigned', name: '未割当' },
    ...assignees.filter((a) => a.id !== null).map((a) => ({ id: String(a.id), name: a.name })),
  ];

  return (
    <div className="rk-toolbar">
      <label className="rk-field">
        <span className="rk-label">担当</span>
        <select value={filters.assignee} onChange={(e) => onChange({ ...filters, assignee: e.target.value as any })}>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>

      <label className="rk-field rk-grow">
        <span className="rk-label">検索</span>
        <input value={filters.q} onChange={(e) => onChange({ ...filters, q: e.target.value })} placeholder="件名" />
      </label>

      <label className="rk-field">
        <span className="rk-label">期限</span>
        <select value={filters.due} onChange={(e) => onChange({ ...filters, due: e.target.value as any })}>
          <option value="all">すべて</option>
          <option value="overdue">期限切れ</option>
          <option value="thisweek">今週</option>
          <option value="none">未設定</option>
        </select>
      </label>



      <div className="rk-sort">
        <span className="rk-label">並び替え</span>
        <SortButton
          active={sortKey.startsWith('due_')}
          direction={sortKey === 'due_asc' ? 'asc' : sortKey === 'due_desc' ? 'desc' : null}
          label="期日"
          onClick={() => {
            if (sortKey === 'due_asc') onChangeSort('due_desc');
            else onChangeSort('due_asc');
          }}
        />
        <SortButton
          active={sortKey.startsWith('priority_')}
          direction={sortKey === 'priority_asc' ? 'asc' : sortKey === 'priority_desc' ? 'desc' : null}
          label="優先度"
          onClick={() => {
            if (sortKey === 'priority_desc') onChangeSort('priority_asc');
            else onChangeSort('priority_desc');
          }}
        />
        <SortButton
          active={sortKey.startsWith('updated_')}
          direction={sortKey === 'updated_asc' ? 'asc' : sortKey === 'updated_desc' ? 'desc' : null}
          label="更新"
          onClick={() => {
            if (sortKey === 'updated_desc') onChangeSort('updated_asc');
            else onChangeSort('updated_desc');
          }}
        />
      </div>

      <div className="rk-toolbar-spacer" />

      <button type="button" className="rk-btn" onClick={onAnalyze} style={{ marginRight: '8px' }}>
        ✨ 分析
      </button>

      <button type="button" className="rk-btn" onClick={onToggleFullWindow}>
        {fullWindow ? '通常表示' : '全画面表示'}
      </button>
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
  const suffix = direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : '';
  return (
    <button type="button" className={`rk-btn rk-btn-sm ${active ? 'rk-btn-toggle-active' : ''}`} onClick={onClick}>
      {label}
      {suffix}
    </button>
  );
}

function Board({
  data,
  columns,
  lanes,
  issues,
  sortKey,
  priorityRank,
  statusInfo,
  canMove,
  canCreate,
  onDrop,
  onCreate,
  onTaskClick,
  onDelete,
  onEditClick,
}: {
  data: BoardData;
  columns: Column[];
  lanes: Lane[];
  issues: Issue[];
  sortKey: SortKey;
  priorityRank: Map<number, number>;
  statusInfo: Map<number, Column>;
  canMove: boolean;
  canCreate: boolean;
  onDrop: (p: { issueId: number; statusId: number; assignedToId: number | null }) => void;
  onCreate: (ctx: ModalContext) => void;
  onTaskClick: (issueId: number) => void;
  onDelete: (issueId: number) => void;
  onEditClick: (editUrl: string) => void;
}) {
  const laneType = data.meta.lane_type;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    if (!canMove) return;
    const activeId = String(event.active.id);
    const over = event.over;
    if (!over) return;
    if (!activeId.startsWith('issue:')) return;

    const issueId = Number(activeId.replace('issue:', ''));
    const target = over.data.current as { statusId: number; assignedToId: number | null } | undefined;
    if (!target) return;

    onDrop({ issueId, statusId: target.statusId, assignedToId: target.assignedToId });
  };

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="rk-board-inner">
        {laneType !== 'none' ? (
          <div className="rk-header-row rk-header-lane-layout">
            <div className="rk-col-header rk-header-lane-label">
              {laneType === 'assignee' ? '担当者' : ''}
            </div>
            <div className="rk-grid">
              {columns.map((c) => (
                <ColumnHeader key={c.id} column={c} />
              ))}
            </div>
          </div>
        ) : (
          <div className="rk-grid rk-header-row">
            {columns.map((c) => (
              <ColumnHeader key={c.id} column={c} />
            ))}
          </div>
        )}

        {laneType === 'none' ? (
          <div className="rk-grid">
            {columns.map((c) => (
              <Cell
                key={c.id}
                data={data}
                statusId={c.id}
                lane={null}
                issues={sortIssues(issuesForCell(issues, null, c.id), sortKey, priorityRank)}
                statusInfo={statusInfo}
                canMove={canMove}
                canCreate={canCreate}
                onDrop={onDrop}
                onCreate={onCreate}
                onCardClick={onTaskClick}
                onDelete={onDelete}
                onEditClick={onEditClick}
              />
            ))}
          </div>
        ) : (
          <div className="rk-lanes">
            {lanes.map((lane) => (
              <div key={String(lane.id)} className="rk-lane">
                <div className="rk-lane-label">{lane.name}</div>
                <div className="rk-grid">
                  {columns.map((c) => (
                    <Cell
                      key={c.id}
                      data={data}
                      statusId={c.id}
                      lane={lane}
                      issues={sortIssues(issuesForCell(issues, lane, c.id), sortKey, priorityRank)}
                      statusInfo={statusInfo}
                      canMove={canMove}
                      canCreate={canCreate}
                      onDrop={onDrop}
                      onCreate={onCreate}
                      onCardClick={onTaskClick}
                      onDelete={onDelete}
                      onEditClick={onEditClick}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </DndContext>
  );
}

function ColumnHeader({ column }: { column: Column }) {
  const limit = column.wip_limit ?? null;
  const count = column.count ?? 0;
  const over = limit && count > limit;
  return (
    <div className="rk-col-header">
      <div className="rk-col-title">{column.name}</div>
      <div className="rk-col-actions">
        <div className={`rk-wip ${over ? 'rk-wip-over' : ''}`}>{limit ? `${count} / ${limit}` : String(count)}</div>
      </div>
    </div>
  );
}

function issuesForCell(issues: Issue[], lane: Lane | null, statusId: number) {
  return issues.filter((it) => {
    if (it.status_id !== statusId) return false;
    if (!lane) return true;
    if (lane.id === 'unassigned') return it.assigned_to_id === null;
    return String(it.assigned_to_id) === String(lane.assigned_to_id);
  });
}

function sortIssues(issues: Issue[], sortKey: SortKey, priorityRank: Map<number, number>) {
  const arr = [...issues];
  const cmp = buildIssueComparator(sortKey, priorityRank);
  arr.sort(cmp);
  return arr;
}

function buildIssueComparator(sortKey: SortKey, priorityRank: Map<number, number>) {
  const dueTime = (it: Issue) => {
    const v = it.due_date;
    if (!v) return null;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  };

  const updatedTime = (it: Issue) => {
    const v = it.updated_on;
    if (!v) return null;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  };

  const priority = (it: Issue) => {
    const id = it.priority_id;
    if (!id) return null;
    const r = priorityRank.get(id);
    return typeof r === 'number' ? r : null;
  };

  const nullsLast = (a: number | null, b: number | null, dir: 'asc' | 'desc') => {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return dir === 'asc' ? a - b : b - a;
  };

  const tie = (a: Issue, b: Issue) => a.id - b.id;

  switch (sortKey) {
    case 'due_asc':
      return (a: Issue, b: Issue) => nullsLast(dueTime(a), dueTime(b), 'asc') || tie(a, b);
    case 'due_desc':
      return (a: Issue, b: Issue) => nullsLast(dueTime(a), dueTime(b), 'desc') || tie(a, b);
    case 'priority_asc':
      return (a: Issue, b: Issue) => nullsLast(priority(a), priority(b), 'asc') || tie(a, b);
    case 'priority_desc':
      return (a: Issue, b: Issue) => nullsLast(priority(a), priority(b), 'desc') || tie(a, b);
    case 'updated_asc':
      return (a: Issue, b: Issue) => nullsLast(updatedTime(a), updatedTime(b), 'asc') || tie(a, b);
    case 'updated_desc':
    default:
      return (a: Issue, b: Issue) => nullsLast(updatedTime(a), updatedTime(b), 'desc') || tie(a, b);
  }
}

function Cell({
  data,
  statusId,
  lane,
  issues,
  statusInfo,
  canMove,
  canCreate,
  onDrop,
  onCreate,
  onCardClick,
  onDelete,
  onEditClick,
}: {
  data: BoardData;
  statusId: number;
  lane: Lane | null;
  issues: Issue[];
  statusInfo: Map<number, Column>;
  canMove: boolean;
  canCreate: boolean;
  onDrop: (p: { issueId: number; statusId: number; assignedToId: number | null }) => void;
  onCreate: (ctx: ModalContext) => void;
  onCardClick: (issueId: number) => void;
  onDelete: (issueId: number) => void;
  onEditClick: (editUrl: string) => void;
}) {
  const laneId = lane ? lane.id : 'none';

  const assignedToId =
    data.meta.lane_type === 'assignee' && lane
      ? lane.id === 'unassigned'
        ? null
        : (lane.assigned_to_id ?? null)
      : null;

  const droppableId = `cell:${statusId}:${String(laneId)}`;
  const { isOver, setNodeRef } = useDroppable({
    id: droppableId,
    data: { statusId, assignedToId },
    disabled: !canMove,
  });

  return (
    <div ref={setNodeRef} className={`rk-cell ${isOver ? 'rk-cell-over' : ''}`}>
      {canCreate ? (
        <button type="button" className="rk-btn rk-btn-dashed" onClick={() => onCreate({ statusId, laneId })}>
          ＋ 追加
        </button>
      ) : null}

      {issues.map((it) => (
        <Card
          key={it.id}
          issue={it}
          data={data}
          statusInfo={statusInfo}
          canMove={canMove}
          onClick={() => onCardClick(it.id)}
          onDelete={() => onDelete(it.id)}
          onEditClick={() => onEditClick(it.urls.issue_edit)}
        />
      ))}
    </div>
  );
}

function Card({
  issue,
  data,
  statusInfo,
  canMove,
  onClick,
  onDelete,
  onEditClick,
}: {
  issue: Issue;
  data: BoardData;
  statusInfo: Map<number, Column>;
  canMove: boolean;
  onClick: () => void;
  onDelete: () => void;
  onEditClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `issue:${issue.id}`,
    disabled: !canMove,
  });
  const style: React.CSSProperties = {
    transform: transform ? CSS.Translate.toString(transform) : undefined,
    opacity: isDragging ? 0.6 : undefined,
    cursor: canMove ? (isDragging ? 'grabbing' : 'move') : undefined,
    transition: 'none',
  };

  const column = statusInfo.get(issue.status_id);
  const isClosed = !!column?.is_closed;
  const agingEnabled = !(data.meta.aging_exclude_closed && isClosed);
  const agingDays = issue.aging_days ?? 0;
  const agingClass = agingEnabled
    ? agingDays >= data.meta.aging_danger_days
      ? 'rk-aging-danger'
      : agingDays >= data.meta.aging_warn_days
        ? 'rk-aging-warn'
        : ''
    : '';

  const overdue = isOverdue(issue.due_date ?? null);

  return (
    <div
      className={`rk-card ${isDragging ? 'rk-card-dragging' : ''} ${data.meta.can_delete ? 'rk-card-has-delete' : ''
        }`}
      ref={setNodeRef}
      style={style}
      onClick={() => {
        if (!isDragging) onClick();
      }}
      {...attributes}
      {...listeners}
    >
      {data.meta.can_delete ? (
        <button
          type="button"
          className="rk-icon-btn rk-card-delete-btn"
          aria-label="削除"
          title="削除"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M9 3a1 1 0 0 0-1 1v1H5.5a1 1 0 1 0 0 2H6v13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7h.5a1 1 0 1 0 0-2H16V4a1 1 0 0 0-1-1H9Zm1 2h4v0H10v0Zm-2 2h8v13H8V7Zm2 3a1 1 0 0 0-1 1v6a1 1 0 1 0 2 0v-6a1 1 0 0 0-1-1Zm4 0a1 1 0 0 0-1 1v6a1 1 0 1 0 2 0v-6a1 1 0 0 0-1-1Z"
            />
          </svg>
        </button>
      ) : null}
      <div className="rk-card-title">
        <a
          href={issue.urls.issue_edit}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onEditClick();
          }}
        >
          #{issue.id}
        </a>{' '}
        <a
          href={issue.urls.issue}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClick();
          }}
        >
          {issue.subject}
        </a>
      </div>
      <div className="rk-card-meta">
        <span className="rk-badge">{issue.done_ratio}%</span>
        <span className={`rk-badge ${overdue ? 'rk-overdue' : ''}`}>{issue.due_date || '未設定'}</span>
        {issue.priority_name ? (
          <span
            className={`rk-badge ${(() => {
              const p = (issue.priority_name || '').toLowerCase();
              if (p === 'low') return 'rk-badge-priority-low';
              if (p === 'normal') return 'rk-badge-priority-normal';
              if (p === 'high') return 'rk-badge-priority-high';
              if (p === 'urgent') return 'rk-badge-priority-urgent';
              if (p === 'immediate') return 'rk-badge-priority-immediate';
              return '';
            })()}`}
          >
            {issue.priority_name}
          </span>
        ) : null}
        <span className={`rk-badge ${agingClass}`}>{`${agingDays}d`}</span>
      </div>
    </div>
  );
}

function isOverdue(due: string | null): boolean {
  if (!due) return false;
  const dt = parseISODate(due);
  if (!dt) return false;
  const now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return dt < today0;
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

  const submit = async () => {
    setErr(null);
    const trackerIdNum = Number(trackerId);
    if (!Number.isFinite(trackerIdNum) || trackerIdNum <= 0) {
      setErr('トラッカーを選択してください');
      return;
    }

    const assigneeIdNum = assigneeId === '' ? null : Number(assigneeId);
    if (assigneeIdNum !== null && (!Number.isFinite(assigneeIdNum) || assigneeIdNum <= 0)) {
      setErr('担当者の値が不正です');
      return;
    }

    const priorityIdNum = priorityId === '' ? null : Number(priorityId);
    if (priorityIdNum !== null && (!Number.isFinite(priorityIdNum) || priorityIdNum <= 0)) {
      setErr('優先度の値が不正です');
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
      setErr(e?.message ?? (isEdit ? '更新に失敗しました' : '作成に失敗しました'));
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
            <span className="rk-label">件名</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} autoFocus />
          </label>

          <div className="rk-row2">
            <label className="rk-field">
              <span className="rk-label">トラッカー</span>
              <select value={trackerId} onChange={(e) => setTrackerId(e.target.value)}>
                {data.lists.trackers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="rk-field">
              <span className="rk-label">担当者</span>
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
              <span className="rk-label">進捗率</span>
              <select value={doneRatio} onChange={(e) => setDoneRatio(Number(e.target.value))}>
                {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((r) => (
                  <option key={r} value={r}>
                    {r}%
                  </option>
                ))}
              </select>
            </label>

            <label className="rk-field">
              <span className="rk-label">優先度</span>
              <select value={priorityId} onChange={(e) => setPriorityId(e.target.value)}>
                <option value="">（未設定）</option>
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
              <span className="rk-label">開始日</span>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>

            <label className="rk-field">
              <span className="rk-label">期日</span>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </label>
          </div>



          <label className="rk-field">
            <span className="rk-label">説明</span>
            <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>

          {hasDescriptionPreview ? (
            <div className="rk-desc-preview" aria-label="説明プレビュー">
              <div className="rk-desc-preview-title">プレビュー（URLをクリックできます）</div>
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

function IframeEditDialog({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      className="rk-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="チケット編集"
      onClick={onClose}
    >
      <div className="rk-iframe-dialog" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="rk-iframe-dialog-close"
          onClick={onClose}
          aria-label="閉じる"
        >
          ×
        </button>
        <iframe className="rk-iframe-dialog-frame" src={url} />
      </div>
    </div>
  );
}

