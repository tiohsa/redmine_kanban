import React, { useEffect, useState } from 'react';
import type { BoardData } from './types';
import { IssueDialogHeader } from './IssueDialogHeader';
import { buildDefaultIssueCreateUrl, type ModalContext } from './issueDialog';
import { findIssueInBoard, linkifyText } from './kanbanShared';
import { BulkSubtaskEditor } from './BulkSubtaskEditor';
import type { SubtaskCreateInput } from './bulkSubtasks';
import { getJson } from './http';

type Props = {
  data: BoardData;
  baseUrl: string;
  ctx: ModalContext;
  onClose: () => void;
  onSaved: (payload: Record<string, unknown>, isEdit: boolean) => Promise<void>;
  onDeleted: (issueId: number) => Promise<void>;
};

export function KanbanIssueModal({ data, baseUrl, ctx, onClose, onSaved, onDeleted }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const issue = ctx.issueId ? findIssueInBoard(data, ctx.issueId) : null;
  const isEdit = !!issue;
  const labels = data.labels;
  const modalTitle = isEdit ? `${issue.subject} #${issue.id}` : labels.issue_create_dialog_title ?? 'Create issue';
  const defaultLinkUrl = isEdit
    ? issue?.urls.issue_edit
    : buildDefaultIssueCreateUrl(baseUrl, data.meta.project_id, data.meta.lane_type, ctx);
  const defaultTracker = data.lists.trackers?.[0]?.id ?? '';
  const defaultAssignee = (() => {
    if (isEdit) return issue?.assigned_to_id ? String(issue.assigned_to_id) : '';
    if (data.meta.lane_type !== 'assignee') return '';
    if (!ctx.laneId || ctx.laneId === 'unassigned' || ctx.laneId === 'none') return '';
    return String(ctx.laneId);
  })();

  const [subject, setSubject] = useState(issue?.subject ?? '');
  const [projectId, setProjectId] = useState(
    issue?.project?.id
      ? String(issue.project.id)
      : String(ctx.projectId ?? data.meta.project_id),
  );
  const [trackerId, setTrackerId] = useState(issue?.tracker_id ? String(issue.tracker_id) : String(defaultTracker));
  const [availableTrackers, setAvailableTrackers] = useState(data.lists.trackers);
  const [assigneeId, setAssigneeId] = useState(issue?.assigned_to_id ? String(issue.assigned_to_id) : defaultAssignee);
  const [dueDate, setDueDate] = useState(issue?.due_date ?? '');
  const [startDate, setStartDate] = useState(issue?.start_date ?? '');
  const [priorityId, setPriorityId] = useState(issue?.priority_id ? String(issue.priority_id) : '');
  const [doneRatio, setDoneRatio] = useState(issue?.done_ratio ?? 0);
  const [description, setDescription] = useState(issue?.description ?? '');
  const [subtasks, setSubtasks] = useState<SubtaskCreateInput[]>([]);
  const [subtaskError, setSubtaskError] = useState<string | null>(null);
  const hasDescriptionPreview = description.trim().length > 0 && /https?:\/\//.test(description);

  useEffect(() => {
    if (isEdit) return;
    let active = true;
    void getJson<{ trackers: { id: number; name: string }[] }>(`${baseUrl}/trackers?target_project_id=${encodeURIComponent(projectId)}`)
      .then((result) => {
        if (!active) return;
        setAvailableTrackers(result.trackers);
        setTrackerId((currentTrackerId) => (
          result.trackers.some((tracker) => tracker.id === Number(currentTrackerId))
            ? currentTrackerId
            : ''
        ));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [baseUrl, isEdit, projectId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, saving]);

  const submit = async () => {
    setError(null);
    const trackerIdNum = Number(trackerId);
    if (!Number.isFinite(trackerIdNum) || trackerIdNum <= 0) {
      setError(labels.select_tracker);
      return;
    }

    const assigneeIdNum = assigneeId === '' ? null : Number(assigneeId);
    if (assigneeIdNum !== null && (!Number.isFinite(assigneeIdNum) || assigneeIdNum <= 0)) {
      setError(labels.invalid_assignee);
      return;
    }

    const priorityIdNum = priorityId === '' ? null : Number(priorityId);
    if (priorityIdNum !== null && (!Number.isFinite(priorityIdNum) || priorityIdNum <= 0)) {
      setError(labels.invalid_priority);
      return;
    }
    if (subtaskError) {
      setError(subtaskError);
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

      if (!isEdit && subtasks.length > 0) payload.subtasks = subtasks;

      await onSaved(payload, isEdit);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : (isEdit ? labels.update_failed : labels.create_failed));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rk-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="rk-modal" onClick={(event) => event.stopPropagation()}>
        <IssueDialogHeader
          title={modalTitle}
          linkUrl={defaultLinkUrl}
          linkAriaLabel={labels.open_in_redmine ?? 'Open in Redmine'}
        />

        <form className="rk-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <label className="rk-field">
            <span className="rk-label">{labels.issue_subject}</span>
            <input value={subject} onChange={(event) => setSubject(event.target.value)} autoFocus />
          </label>

          <label className="rk-field">
            <span className="rk-label">{labels.project}</span>
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={isEdit}>
              {data.lists.creatable_projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {'\u00A0'.repeat(project.level * 2)}{project.name}
                </option>
              ))}
            </select>
          </label>

          <div className="rk-row2">
            <label className="rk-field">
              <span className="rk-label">{labels.issue_tracker}</span>
              <select value={trackerId} onChange={(event) => setTrackerId(event.target.value)}>
                {availableTrackers.map((tracker) => (
                  <option key={tracker.id} value={tracker.id}>{tracker.name}</option>
                ))}
              </select>
            </label>

            <label className="rk-field">
              <span className="rk-label">{labels.issue_assignee}</span>
              <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
                <option value="">{labels.not_set}</option>
                {data.lists.assignees.map((assignee) => (
                  <option key={String(assignee.id)} value={assignee.id ?? ''}>{assignee.name}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="rk-row2">
            <label className="rk-field">
              <span className="rk-label">{labels.issue_done_ratio}</span>
              <select value={doneRatio} onChange={(event) => setDoneRatio(Number(event.target.value))}>
                {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((ratio) => (
                  <option key={ratio} value={ratio}>{ratio}%</option>
                ))}
              </select>
            </label>

            <label className="rk-field">
              <span className="rk-label">{labels.issue_priority}</span>
              <select value={priorityId} onChange={(event) => setPriorityId(event.target.value)}>
                <option value="">{labels.not_set}</option>
                {data.lists.priorities.map((priority) => (
                  <option key={priority.id} value={priority.id}>{priority.name}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="rk-row2">
            <label className="rk-field">
              <span className="rk-label">{labels.issue_start_date}</span>
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </label>

            <label className="rk-field">
              <span className="rk-label">{labels.issue_due_date}</span>
              <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            </label>
          </div>

          <label className="rk-field">
            <span className="rk-label">{labels.issue_description}</span>
            <textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>

          {hasDescriptionPreview ? (
            <div className="rk-desc-preview" aria-label={labels.issue_description}>
              <div className="rk-desc-preview-title">{labels.url_clickable}</div>
              <div className="rk-desc-preview-body">{linkifyText(description)}</div>
            </div>
          ) : null}

          {!isEdit ? (
            <BulkSubtaskEditor
              labels={labels}
              trackers={availableTrackers}
              initialTrackerId={Number(trackerId) || null}
              onChange={setSubtasks}
              onValidationChange={setSubtaskError}
            />
          ) : null}

          {error ? <div className="rk-error">{error}</div> : null}

          <div className="rk-modal-actions">
            {isEdit && ctx.issueId ? (
              <button
                type="button"
                className="rk-btn rk-btn-danger"
                style={{ marginRight: 'auto' }}
                onClick={() => {
                  const issueId = ctx.issueId;
                  if (!issueId) return;
                  if (confirm(labels.delete_confirm_message.replace('%{id}', String(issueId)))) {
                    void onDeleted(issueId);
                    onClose();
                  }
                }}
              >
                {labels.delete}
              </button>
            ) : null}

            <button type="button" className="rk-btn" onClick={onClose} disabled={saving}>
              {labels.cancel}
            </button>
            <button type="submit" className="rk-btn" disabled={saving}>
              {saving ? labels.saving : isEdit ? labels.save : labels.create}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
