import React, { useCallback, useMemo, useState } from 'react';
import type { BoardData, Column, Issue, Lane } from './types';
import { getJson, postJson } from './http';

type Props = { dataUrl: string };

type Filters = {
  assignee: 'all' | 'me' | 'unassigned' | string;
  q: string;
  due: 'all' | 'overdue' | 'thisweek' | 'none';
  blockedOnly: boolean;
};

type CreateContext = { statusId: number; laneId?: string | number };

export function App({ dataUrl }: Props) {
  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({ assignee: 'all', q: '', due: 'all', blockedOnly: false });
  const [drag, setDrag] = useState<{ issueId: number } | null>(null);
  const [create, setCreate] = useState<CreateContext | null>(null);

  const baseUrl = useMemo(() => dataUrl.replace(/\/data$/, ''), [dataUrl]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await getJson<BoardData>(dataUrl);
      setData(json);
    } catch (e) {
      setError('読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [dataUrl]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const columns = data?.columns ?? [];
  const lanes = data?.lanes ?? [];
  const issues = useMemo(() => filterIssues(data?.issues ?? [], data, filters), [data, filters]);

  const statusInfo = useMemo(() => {
    const m = new Map<number, Column>();
    for (const c of columns) m.set(c.id, c);
    return m;
  }, [columns]);

  const openCreate = (ctx: CreateContext) => setCreate(ctx);

  const moveIssue = async (issueId: number, statusId: number, assignedToId: number | null) => {
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

  return (
    <div className="rk-root">
      <div className="rk-header">
        <h2 className="rk-title">かんばん</h2>
        <div className="rk-status">
          {loading ? <span className="rk-pill">読み込み中</span> : null}
          {notice ? <span className="rk-pill rk-pill-warn">{notice}</span> : null}
          {error ? <span className="rk-pill rk-pill-error">{error}</span> : null}
        </div>
      </div>

      {data ? (
        <Toolbar data={data} filters={filters} onChange={setFilters} />
      ) : (
        <div className="rk-empty">データ取得中...</div>
      )}

      <div className="rk-board">
        {data ? (
          <Board
            data={data}
            columns={columns}
            lanes={lanes}
            issues={issues}
            statusInfo={statusInfo}
            canMove={canMove}
            canCreate={canCreate}
            drag={drag}
            setDrag={setDrag}
            onDrop={(p) => moveIssue(p.issueId, p.statusId, p.assignedToId)}
            onCreate={openCreate}
          />
        ) : null}
      </div>

      {data && create ? (
        <CreateModal
          data={data}
          ctx={create}
          onClose={() => setCreate(null)}
          onCreated={async (payload) => {
            try {
              setNotice(null);
              await postJson(`${baseUrl}/issues`, payload, 'POST');
              setCreate(null);
              await refresh();
            } catch (e: any) {
              const p = e?.payload as any;
              throw new Error(p?.message || fieldError(p?.field_errors) || '作成に失敗しました');
            }
          }}
        />
      ) : null}
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
    if (filters.blockedOnly && !it.blocked) return false;
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
}: {
  data: BoardData;
  filters: Filters;
  onChange: (f: Filters) => void;
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

      <label className="rk-check">
        <input
          type="checkbox"
          checked={filters.blockedOnly}
          onChange={(e) => onChange({ ...filters, blockedOnly: e.target.checked })}
        />
        Blockedのみ
      </label>
    </div>
  );
}

function Board({
  data,
  columns,
  lanes,
  issues,
  statusInfo,
  canMove,
  canCreate,
  drag,
  setDrag,
  onDrop,
  onCreate,
}: {
  data: BoardData;
  columns: Column[];
  lanes: Lane[];
  issues: Issue[];
  statusInfo: Map<number, Column>;
  canMove: boolean;
  canCreate: boolean;
  drag: { issueId: number } | null;
  setDrag: (d: { issueId: number } | null) => void;
  onDrop: (p: { issueId: number; statusId: number; assignedToId: number | null }) => void;
  onCreate: (ctx: CreateContext) => void;
}) {
  const laneType = data.meta.lane_type;

  return (
    <div className="rk-board-inner">
      <div className="rk-grid rk-header-row">
        {columns.map((c) => (
          <ColumnHeader key={c.id} column={c} canCreate={canCreate} onCreate={() => onCreate({ statusId: c.id })} />
        ))}
      </div>

      {laneType === 'none' ? (
        <div className="rk-grid">
          {columns.map((c) => (
            <Cell
              key={c.id}
              data={data}
              statusId={c.id}
              lane={null}
              issues={issuesForCell(issues, null, c.id)}
              statusInfo={statusInfo}
              canMove={canMove}
              canCreate={canCreate}
              drag={drag}
              setDrag={setDrag}
              onDrop={onDrop}
              onCreate={onCreate}
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
                    issues={issuesForCell(issues, lane, c.id)}
                    statusInfo={statusInfo}
                    canMove={canMove}
                    canCreate={canCreate}
                    drag={drag}
                    setDrag={setDrag}
                    onDrop={onDrop}
                    onCreate={onCreate}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ColumnHeader({ column, canCreate, onCreate }: { column: Column; canCreate: boolean; onCreate: () => void }) {
  const limit = column.wip_limit ?? null;
  const count = column.count ?? 0;
  const over = limit && count > limit;
  return (
    <div className="rk-col-header">
      <div className="rk-col-title">{column.name}</div>
      <div className="rk-col-actions">
        <div className={`rk-wip ${over ? 'rk-wip-over' : ''}`}>{limit ? `${count} / ${limit}` : String(count)}</div>
        {canCreate ? (
          <button type="button" className="rk-btn rk-btn-ghost" onClick={onCreate} aria-label="この列に追加">
            ＋
          </button>
        ) : null}
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

function Cell({
  data,
  statusId,
  lane,
  issues,
  statusInfo,
  canMove,
  canCreate,
  drag,
  setDrag,
  onDrop,
  onCreate,
}: {
  data: BoardData;
  statusId: number;
  lane: Lane | null;
  issues: Issue[];
  statusInfo: Map<number, Column>;
  canMove: boolean;
  canCreate: boolean;
  drag: { issueId: number } | null;
  setDrag: (d: { issueId: number } | null) => void;
  onDrop: (p: { issueId: number; statusId: number; assignedToId: number | null }) => void;
  onCreate: (ctx: CreateContext) => void;
}) {
  const laneId = lane ? lane.id : 'none';

  const onDropHere = () => {
    if (!drag) return;
    const assignedToId =
      data.meta.lane_type === 'assignee' && lane
        ? lane.id === 'unassigned'
          ? null
          : (lane.assigned_to_id ?? null)
        : null;
    onDrop({ issueId: drag.issueId, statusId, assignedToId });
    setDrag(null);
  };

  return (
    <div
      className="rk-cell"
      onDragOver={(e) => (canMove ? e.preventDefault() : undefined)}
      onDrop={(e) => {
        e.preventDefault();
        if (!canMove) return;
        onDropHere();
      }}
    >
      {canCreate ? (
        <button type="button" className="rk-btn rk-btn-dashed" onClick={() => onCreate({ statusId, laneId })}>
          ＋ 追加
        </button>
      ) : null}

      {issues.map((it) => (
        <Card key={it.id} issue={it} data={data} statusInfo={statusInfo} canMove={canMove} onDrag={setDrag} />
      ))}
    </div>
  );
}

function Card({
  issue,
  data,
  statusInfo,
  canMove,
  onDrag,
}: {
  issue: Issue;
  data: BoardData;
  statusInfo: Map<number, Column>;
  canMove: boolean;
  onDrag: (d: { issueId: number } | null) => void;
}) {
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
      className={`rk-card ${issue.blocked ? 'rk-blocked' : ''}`}
      draggable={canMove}
      onDragStart={() => onDrag({ issueId: issue.id })}
      onDragEnd={() => onDrag(null)}
    >
      <div className="rk-card-title">
        <a href={issue.urls.issue} target="_blank" rel="noopener noreferrer">
          #{issue.id}
        </a>{' '}
        {issue.subject}
      </div>
      <div className="rk-card-meta">
        <span className="rk-badge">{issue.assigned_to_name || '未割当'}</span>
        <span className={`rk-badge ${overdue ? 'rk-overdue' : ''}`}>{issue.due_date || '未設定'}</span>
        {issue.priority_name ? <span className="rk-badge">{issue.priority_name}</span> : null}
        <span className={`rk-badge ${agingClass}`}>{`${agingDays}d`}</span>
        {issue.blocked ? <span className="rk-badge">{`Blocked${issue.blocked_reason ? ` ${issue.blocked_reason}` : ''}`}</span> : null}
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

function CreateModal({
  data,
  ctx,
  onClose,
  onCreated,
}: {
  data: BoardData;
  ctx: CreateContext;
  onClose: () => void;
  onCreated: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const defaultTracker = data.lists.trackers?.[0]?.id ?? '';
  const defaultAssignee = (() => {
    if (data.meta.lane_type !== 'assignee') return '';
    if (!ctx.laneId) return '';
    if (ctx.laneId === 'unassigned' || ctx.laneId === 'none') return '';
    return String(ctx.laneId);
  })();

  const [subject, setSubject] = useState('');
  const [trackerId, setTrackerId] = useState(String(defaultTracker));
  const [assigneeId, setAssigneeId] = useState(defaultAssignee);
  const [dueDate, setDueDate] = useState('');
  const [priorityId, setPriorityId] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [blockedReason, setBlockedReason] = useState('');
  const [description, setDescription] = useState('');

  const submit = async () => {
    setSaving(true);
    setErr(null);
    try {
      await onCreated({
        subject,
        tracker_id: trackerId,
        assigned_to_id: assigneeId,
        due_date: dueDate,
        priority_id: priorityId,
        blocked: blocked ? '1' : '0',
        blocked_reason: blockedReason,
        description,
        status_id: ctx.statusId,
      });
    } catch (e: any) {
      setErr(e?.message ?? '作成に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rk-modal-backdrop" role="dialog" aria-modal="true">
      <div className="rk-modal">
        <div className="rk-modal-head">
          <h3>タスク追加</h3>
          <button type="button" className="rk-btn rk-btn-ghost" onClick={onClose} aria-label="閉じる">
            ×
          </button>
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
              <span className="rk-label">期日</span>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
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
            <label className="rk-check">
              <input type="checkbox" checked={blocked} onChange={(e) => setBlocked(e.target.checked)} />
              Blocked
            </label>
            <label className="rk-field">
              <span className="rk-label">理由</span>
              <input value={blockedReason} onChange={(e) => setBlockedReason(e.target.value)} disabled={!blocked} />
            </label>
          </div>

          <label className="rk-field">
            <span className="rk-label">説明</span>
            <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>

          {err ? <div className="rk-error">{err}</div> : null}
        </div>

        <div className="rk-modal-actions">
          <button type="button" className="rk-btn" onClick={onClose} disabled={saving}>
            キャンセル
          </button>
          <button type="button" className="rk-btn rk-btn-primary" onClick={submit} disabled={saving}>
            {saving ? '作成中...' : '作成'}
          </button>
        </div>
      </div>
    </div>
  );
}

