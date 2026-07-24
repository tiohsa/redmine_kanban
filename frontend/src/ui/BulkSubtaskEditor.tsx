import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  MAX_BULK_SUBTASKS,
  draftsFromText,
  draftsToCreateInputs,
  draftsToText,
  createDraftId,
  preserveDraftsForText,
  type SubtaskCreateInput,
  type SubtaskDraft,
} from './bulkSubtasks';

type Tracker = { id: number; name: string };

type Props = {
  labels: Record<string, string>;
  trackers: Tracker[];
  disabled?: boolean;
  showRowTrackerButton?: boolean;
  initialTrackerId?: number | null;
  className?: string;
  onChange?: (inputs: SubtaskCreateInput[]) => void;
  onValidationChange?: (message: string | null) => void;
};

export function BulkSubtaskEditor({ labels, trackers, disabled = false, showRowTrackerButton = true, initialTrackerId, className, onChange, onValidationChange }: Props) {
  const defaultTracker = trackers.some((tracker) => tracker.id === initialTrackerId)
    ? initialTrackerId ?? 0
    : trackers[0]?.id ?? 0;
  const [mode, setMode] = useState<'text' | 'table'>('text');
  const [text, setText] = useState('');
  const [defaultTrackerId, setDefaultTrackerId] = useState(defaultTracker);
  const [drafts, setDrafts] = useState<SubtaskDraft[]>([]);
  const [preservedDrafts, setPreservedDrafts] = useState<SubtaskDraft[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const firstSubjectRef = useRef<HTMLInputElement>(null);
  const lastEmittedRef = useRef<string>('');
  const defaultTrackerExplicitlyChangedRef = useRef(false);

  useEffect(() => {
    const validTrackerIds = new Set(trackers.map((tracker) => tracker.id));
    const fallbackTracker = trackers[0]?.id ?? 0;
    const parentTracker = initialTrackerId && validTrackerIds.has(initialTrackerId) ? initialTrackerId : fallbackTracker;
    setDefaultTrackerId((current) => {
      if (current === 0 || !validTrackerIds.has(current)) return parentTracker;
      return defaultTrackerExplicitlyChangedRef.current ? current : parentTracker;
    });
    if (fallbackTracker > 0) {
      setDrafts((current) => current.map((draft) => validTrackerIds.has(draft.trackerId)
        ? draft
        : { ...draft, trackerId: fallbackTracker }));
    }
  }, [initialTrackerId, trackers]);

  const inputs = useMemo(() => {
    if (mode === 'table') return draftsToCreateInputs(drafts);
    const converted = draftsFromText(text, defaultTrackerId, preservedDrafts).drafts;
    return draftsToCreateInputs(converted);
  }, [defaultTrackerId, drafts, mode, preservedDrafts, text]);

  useEffect(() => {
    const signature = inputs.map((input) => `${input.subject}\u0000${input.trackerId}`).join('\u0001');
    if (signature !== lastEmittedRef.current) {
      lastEmittedRef.current = signature;
      onChange?.(inputs);
    }
    const message = inputs.length > MAX_BULK_SUBTASKS
        ? (labels.bulk_subtask_limit ?? 'You can create up to 50 subtasks at once.')
        : inputs.some((input) => !trackers.some((tracker) => tracker.id === input.trackerId))
          ? (labels.bulk_subtask_invalid_tracker ?? 'Select a tracker available in this project.')
          : null;
    setError(message);
    onValidationChange?.(message);
  }, [drafts, inputs, labels, mode, onChange, onValidationChange, trackers]);

  const enterTable = () => {
    const converted = draftsFromText(text, defaultTrackerId, preservedDrafts);
    const tableDrafts = converted.drafts.length > 0
      ? converted.drafts
      : Array.from({ length: 3 }, () => ({ id: createDraftId(), subject: '', trackerId: defaultTrackerId }));
    setDrafts(tableDrafts);
    setNotice(converted.restoredCount > 0
      ? (labels.bulk_subtask_restored ?? `${converted.restoredCount} individual tracker settings restored.`).replace('%{count}', String(converted.restoredCount))
      : null);
    setMode('table');
    window.requestAnimationFrame(() => firstSubjectRef.current?.focus());
  };

  const leaveTable = () => {
    setPreservedDrafts(drafts.map((draft) => ({ ...draft })));
    setText(draftsToText(drafts));
    setMode('text');
    setNotice(labels.bulk_subtask_preserved ?? 'Individual tracker settings are being preserved.');
  };

  const selectMode = (nextMode: 'text' | 'table') => {
    if (nextMode === mode) return;
    if (nextMode === 'table') {
      enterTable();
    } else {
      leaveTable();
    }
  };

  const addRow = () => {
    const draft = { id: createDraftId(), subject: '', trackerId: defaultTrackerId };
    setDrafts((current) => [...current, draft]);
    window.requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-subtask-id="${draft.id}"]`)?.focus());
  };

  return (
    <section
      className={`rk-bulk-subtask-editor ${className ?? ''}`}
      aria-label={labels.bulk_subtask_title ?? 'Bulk subtask registration'}
    >
      <div className="rk-bulk-subtask-header">
        <div className="rk-bulk-subtask-mode-switch" role="group" aria-label={labels.bulk_subtask_mode ?? 'Input mode'}>
          <button
            type="button"
            className={`rk-bulk-subtask-mode${mode === 'table' ? ' is-active' : ''}`}
            aria-pressed={mode === 'table'}
            onClick={() => selectMode('table')}
            disabled={disabled}
          >
            <span className="rk-icon" aria-hidden="true">table_rows</span>
            {labels.bulk_subtask_table_mode ?? 'Table input'}
          </button>
          <button
            type="button"
            className={`rk-bulk-subtask-mode${mode === 'text' ? ' is-active' : ''}`}
            aria-pressed={mode === 'text'}
            onClick={() => selectMode('text')}
            disabled={disabled}
          >
            <span className="rk-icon" aria-hidden="true">format_align_left</span>
            {labels.bulk_subtask_text_mode ?? 'Bulk text input'}
          </button>
        </div>
      </div>
      {mode === 'text' ? (
        <label className="rk-field">
          <span className="rk-label">{labels.bulk_subtask_default_tracker ?? labels.issue_tracker ?? 'Tracker'}</span>
          <select aria-label={labels.bulk_subtask_default_tracker ?? 'Default tracker'} value={defaultTrackerId || ''} onChange={(event) => { defaultTrackerExplicitlyChangedRef.current = true; setDefaultTrackerId(Number(event.target.value)); }} disabled={disabled}>
            <option value="">{labels.select_tracker ?? 'Select tracker'}</option>
            {trackers.map((tracker) => <option key={tracker.id} value={tracker.id}>{tracker.name}</option>)}
          </select>
        </label>
      ) : null}

      {mode === 'text' ? (
        <>
          <textarea aria-label={labels.bulk_subtask_title} rows={3} value={text} onChange={(event) => { const nextText = event.target.value; setText(nextText); setPreservedDrafts((current) => preserveDraftsForText(nextText, current)); }} placeholder={labels.bulk_subtask_placeholder} disabled={disabled} />
          <div className="rk-bulk-subtask-count">{inputs.length} {labels.bulk_subtask_count ?? 'items detected'}</div>
          {preservedDrafts.length > 0 ? <div className="rk-bulk-subtask-notice">✓ {notice ?? labels.bulk_subtask_preserved}</div> : null}
          {showRowTrackerButton ? <button type="button" className="rk-btn rk-btn-sm" onClick={enterTable} disabled={disabled}>{labels.bulk_subtask_edit_rows ?? 'Set tracker per row'}</button> : null}
        </>
      ) : (
        <>
          <div className="rk-bulk-subtask-table-wrap">
            <table className="rk-bulk-subtask-table"><thead><tr><th>#</th><th>{labels.issue_subject ?? 'Subject'}</th><th>{labels.issue_tracker ?? 'Tracker'}</th><th /></tr></thead><tbody>
              {drafts.map((draft, index) => <tr key={draft.id}>
                <td>{index + 1}</td>
                <td><input ref={index === 0 ? firstSubjectRef : undefined} data-subtask-id={draft.id} aria-label={`${labels.issue_subject ?? 'Subject'} ${index + 1}`} value={draft.subject} onChange={(event) => setDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, subject: event.target.value } : item))} /></td>
                <td><select aria-label={`${labels.issue_tracker ?? 'Tracker'} ${index + 1}`} value={draft.trackerId || ''} onChange={(event) => setDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, trackerId: Number(event.target.value) } : item))}>{trackers.map((tracker) => <option key={tracker.id} value={tracker.id}>{tracker.name}</option>)}</select></td>
                <td><button type="button" className="rk-icon-btn" aria-label={`${labels.delete ?? 'Delete'} ${index + 1}`} onClick={() => setDrafts((current) => current.filter((item) => item.id !== draft.id))}>×</button></td>
              </tr>)}
            </tbody></table>
          </div>
          <button type="button" className="button rk-bulk-subtask-add-row" onClick={addRow}>{labels.bulk_subtask_add_row ?? '+ Add row'}</button>
        </>
      )}
      {notice && mode === 'table' ? <div className="rk-bulk-subtask-notice">{notice}</div> : null}
      {error ? <div className="rk-error" role="alert">{error}</div> : null}
    </section>
  );
}
