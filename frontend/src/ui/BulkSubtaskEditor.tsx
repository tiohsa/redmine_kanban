import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  MAX_BULK_SUBTASKS,
  draftsFromText,
  draftsToCreateInputs,
  draftsToText,
  type SubtaskCreateInput,
  type SubtaskDraft,
} from './bulkSubtasks';

type Tracker = { id: number; name: string };

type Props = {
  labels: Record<string, string>;
  trackers: Tracker[];
  disabled?: boolean;
  className?: string;
  onChange?: (inputs: SubtaskCreateInput[]) => void;
  onValidationChange?: (message: string | null) => void;
};

export function BulkSubtaskEditor({ labels, trackers, disabled = false, className, onChange, onValidationChange }: Props) {
  const defaultTracker = trackers[0]?.id ?? 0;
  const [mode, setMode] = useState<'text' | 'table'>('text');
  const [text, setText] = useState('');
  const [defaultTrackerId, setDefaultTrackerId] = useState(defaultTracker);
  const [drafts, setDrafts] = useState<SubtaskDraft[]>([]);
  const [preservedDrafts, setPreservedDrafts] = useState<SubtaskDraft[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const firstSubjectRef = useRef<HTMLInputElement>(null);
  const lastEmittedRef = useRef<string>('');

  useEffect(() => {
    if (defaultTrackerId === 0 && defaultTracker > 0) setDefaultTrackerId(defaultTracker);
  }, [defaultTracker, defaultTrackerId]);

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
    const hasEmptyDraft = mode === 'table' && drafts.some((draft) => !draft.subject.trim());
    const message = hasEmptyDraft
      ? (labels.bulk_subtask_empty_subject ?? 'Enter a subject or remove this row.')
      : inputs.length > MAX_BULK_SUBTASKS
        ? (labels.bulk_subtask_limit ?? 'You can create up to 50 subtasks at once.')
        : inputs.some((input) => !trackers.some((tracker) => tracker.id === input.trackerId))
          ? (labels.bulk_subtask_invalid_tracker ?? 'Select a tracker available in this project.')
          : null;
    setError(message);
    onValidationChange?.(message);
  }, [drafts, inputs, labels, mode, onChange, onValidationChange, trackers]);

  const enterTable = () => {
    const converted = draftsFromText(text, defaultTrackerId, preservedDrafts);
    setDrafts(converted.drafts);
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

  const applyToAll = (trackerId: number) => {
    const differs = drafts.some((draft) => draft.trackerId !== trackerId);
    if (differs && !window.confirm(labels.bulk_subtask_overwrite_confirm ?? 'Individual tracker settings will be overwritten. Continue?')) return;
    setDrafts((current) => current.map((draft) => ({ ...draft, trackerId })));
  };

  const addRow = () => {
    const draft = { id: `new-${Date.now()}-${drafts.length}`, subject: '', trackerId: defaultTrackerId };
    setDrafts((current) => [...current, draft]);
    window.requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-subtask-id="${draft.id}"]`)?.focus());
  };

  return (
    <section className={`rk-bulk-subtask-editor ${className ?? ''}`} aria-labelledby="rk-bulk-subtask-heading">
      <h4 id="rk-bulk-subtask-heading" className="rk-bulk-subtask-heading">{labels.bulk_subtask_title}</h4>
      <label className="rk-field">
        <span className="rk-label">{labels.bulk_subtask_default_tracker ?? labels.issue_tracker ?? 'Tracker'}</span>
        <select aria-label={labels.bulk_subtask_default_tracker ?? 'Default tracker'} value={defaultTrackerId || ''} onChange={(event) => setDefaultTrackerId(Number(event.target.value))} disabled={disabled}>
          <option value="">{labels.select_tracker ?? 'Select tracker'}</option>
          {trackers.map((tracker) => <option key={tracker.id} value={tracker.id}>{tracker.name}</option>)}
        </select>
      </label>

      {mode === 'text' ? (
        <>
          <textarea aria-label={labels.bulk_subtask_title} rows={3} value={text} onChange={(event) => setText(event.target.value)} placeholder={labels.bulk_subtask_placeholder} disabled={disabled} />
          <div className="rk-bulk-subtask-count">{inputs.length} {labels.bulk_subtask_count ?? 'items detected'}</div>
          {preservedDrafts.length > 0 ? <div className="rk-bulk-subtask-notice">✓ {notice ?? labels.bulk_subtask_preserved}</div> : null}
          <button type="button" className="rk-btn rk-btn-sm" onClick={enterTable} disabled={disabled}>{labels.bulk_subtask_edit_rows ?? 'Set tracker per row'}</button>
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
          <button type="button" className="rk-btn rk-btn-dashed" onClick={addRow}>{labels.bulk_subtask_add_row ?? '+ Add row'}</button>
          <div className="rk-bulk-subtask-apply"><select aria-label={labels.bulk_subtask_apply_tracker ?? 'Apply tracker to all'} value={defaultTrackerId || ''} onChange={(event) => applyToAll(Number(event.target.value))}>{trackers.map((tracker) => <option key={tracker.id} value={tracker.id}>{tracker.name}</option>)}</select><button type="button" className="rk-btn rk-btn-sm" onClick={() => applyToAll(defaultTrackerId)}>{labels.bulk_subtask_apply ?? 'Apply to all'}</button></div>
          <button type="button" className="rk-btn rk-btn-sm" onClick={leaveTable}>{labels.bulk_subtask_back_to_text ?? 'Back to multiline input (keep settings)'}</button>
        </>
      )}
      {notice && mode === 'table' ? <div className="rk-bulk-subtask-notice">{notice}</div> : null}
      {error ? <div className="rk-error" role="alert">{error}</div> : null}
    </section>
  );
}
