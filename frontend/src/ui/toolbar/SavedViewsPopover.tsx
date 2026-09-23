import { useState } from 'react';
import { copyViewSettings, MAX_SAVED_VIEWS, parseSavedViews, validateViewName, viewSettingsEqual, type SavedView, type SavedViewSettings } from '../savedViews';
import type { ViewValidation } from '../savedViewValidation';
import { useDropdownDismiss } from './useDropdownDismiss';

type Props = {
  storageKey: string;
  current: SavedViewSettings;
  onApply: (settings: SavedViewSettings) => void;
  labels: Record<string, string>;
  validation: ViewValidation;
};
function readViews(key: string): { views: SavedView[]; error: string | null } {
  try { return { views: parseSavedViews(localStorage.getItem(key)).views, error: null }; }
  catch { return { views: [], error: 'saved_views_unreadable' }; }
}
export function SavedViewsPopover({ storageKey, current, onApply, labels, validation }: Props) {
  const [stored, setStored] = useState(() => readViews(storageKey));
  const [selectedId, setSelectedId] = useState('');
  const [activeId, setActiveId] = useState('');
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { triggerRef, menuRef, menuId } = useDropdownDismiss(open, () => { setOpen(false); setConfirmDelete(null); });
  const selected = stored.views.find((view) => view.id === selectedId);
  const active = stored.views.find((view) => view.id === activeId);
  const changed = Boolean(active && !viewSettingsEqual(current, active.settings));
  const triggerLabel = `${labels.saved_views}${active ? `: ${active.name}` : ''}${changed ? ` (${labels.saved_views_changed})` : ''}`;
  const mutate = (operation: (views: SavedView[]) => SavedView[], after?: () => void) => {
    setSaved(false);
    setError(null);
    try {
      // Re-read before each explicit write; never replace corrupt/unknown documents.
      const latest = parseSavedViews(localStorage.getItem(storageKey));
      const views = operation(latest.views);
      const serialized = JSON.stringify({ version: 1, views });
      const validated = parseSavedViews(serialized);
      localStorage.setItem(storageKey, serialized);
      setStored({ views: validated.views, error: null });
      setSaved(true);
      after?.();
    } catch (caught) {
      const code = caught instanceof Error && caught.message.startsWith('saved_views_') ? caught.message : 'saved_views_write_failed';
      setError(code);
    }
  };
  const update = (operation: 'rename' | 'overwrite') => {
    if (!selected) return;
    let latestName = '';
    mutate((views) => {
      if (!views.some((v) => v.id === selected.id)) throw new Error('saved_views_unreadable');
      return views.map((view) => {
        if (view.id !== selected.id) return view;
        latestName = operation === 'rename' ? validateViewName(name, views, view.id) : view.name;
        return operation === 'overwrite'
          ? { ...view, settings: copyViewSettings(current) }
          : { ...view, name: latestName };
      });
    }, () => setName(latestName));
  };
  return (
    <div className="rk-dropdown-container">
      <button type="button" className={`rk-btn rk-btn-labeled rk-saved-views-trigger${open ? ' rk-btn-toggle-active' : ''}`} ref={triggerRef} aria-label={triggerLabel} aria-expanded={open} aria-controls={open ? menuId : undefined} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        <span className="rk-icon" aria-hidden="true">bookmarks</span>
        <span className="rk-btn-label rk-saved-views-trigger-label" aria-hidden="true">{triggerLabel}</span>
      </button>
      {open ? <div id={menuId} ref={menuRef} role="dialog" aria-label={labels.saved_views} className="rk-settings-menu rk-saved-views">
        <div className="rk-settings-title">{labels.saved_views}</div>
        <div className="rk-saved-views-section rk-saved-views-selection">
          <label className="rk-saved-views-field">{labels.saved_views_select}
            <select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setName(stored.views.find((view) => view.id === event.target.value)?.name ?? ''); setConfirmDelete(null); setSaved(false); }}>
              <option value="">{labels.saved_views_none}</option>
              {stored.views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
            </select>
          </label>
          <button type="button" className="rk-btn rk-btn-sm rk-saved-views-apply" disabled={!selected} onClick={() => {
            if (!selected) return;
            onApply(copyViewSettings(selected.settings)); setActiveId(selected.id); setSaved(false); setError(null);
          }}>{labels.saved_views_apply}</button>
        </div>
        <div className="rk-saved-views-section">
          <label className="rk-saved-views-field">{labels.saved_views_name}<input value={name} onChange={(event) => { setName(event.target.value); setSaved(false); }} /></label>
          <div className="rk-saved-views-actions">
            <button type="button" className="rk-btn rk-btn-sm" disabled={Boolean(stored.error)} onClick={() => {
              let newId = '';
              mutate((views) => {
                const trimmed = validateViewName(name, views);
                if (views.length >= MAX_SAVED_VIEWS) throw new Error('saved_views_limit');
                const candidate = globalThis.crypto?.randomUUID?.() ?? `view_${Date.now()}_${Math.random().toString(36).slice(2)}`;
                newId = candidate;
                for (let suffix = 1; views.some((view) => view.id === newId); suffix++) newId = `${candidate}_${suffix}`;
                return [...views, { id: newId, name: trimmed, settings: copyViewSettings(current) }];
              }, () => { setActiveId(newId); setSelectedId(newId); setName(name.trim()); });
            }}>{labels.saved_views_new}</button>
            <button type="button" className="rk-btn rk-btn-sm" disabled={!selected} onClick={() => update('overwrite')}>{labels.saved_views_overwrite}</button>
            <button type="button" className="rk-btn rk-btn-sm" disabled={!selected} onClick={() => update('rename')}>{labels.saved_views_rename}</button>
            <button type="button" className="rk-btn rk-btn-sm" disabled={!selected} onClick={() => { setConfirmDelete(selectedId); setSaved(false); }}>{labels.delete}</button>
          </div>
        </div>
        {confirmDelete ? <div className="rk-saved-views-confirm" role="group" aria-label={labels.saved_views_delete_confirm}>
          <p>{labels.saved_views_delete_confirm.replace('%{name}', stored.views.find((v) => v.id === confirmDelete)?.name ?? '')}</p>
          <div className="rk-saved-views-confirm-actions">
            <button type="button" className="rk-btn rk-btn-sm rk-btn-danger" onClick={() => mutate((views) => views.filter((view) => view.id !== confirmDelete), () => {
              if (activeId === confirmDelete) setActiveId('');
              setSelectedId(''); setName(''); setConfirmDelete(null);
            })}>{labels.saved_views_confirm_delete}</button>
            <button type="button" className="rk-btn rk-btn-sm" onClick={() => setConfirmDelete(null)}>{labels.cancel}</button>
          </div>
        </div> : null}
        {error || stored.error ? <p className="rk-saved-views-message is-error" role="alert">{labels[error ?? stored.error ?? 'saved_views_unreadable']}</p> : null}
        {saved ? <p className="rk-saved-views-message is-success" role="status">{labels.saved_views_saved}</p> : null}
        {active && changed ? <p className="rk-saved-views-message" role="status">{labels.saved_views_changed}</p> : null}
        {active && validation.pending ? <p className="rk-saved-views-message" role="status">{labels.saved_views_pending}</p> : null}
        <p className="rk-settings-help">{labels.saved_views_help}</p>
      </div> : null}
    </div>
  );
}
