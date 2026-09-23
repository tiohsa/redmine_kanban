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
  const mutate = (operation: (views: SavedView[]) => SavedView[], after?: () => void) => {
    setSaved(false);
    setError(null);
    try {
      // Re-read before each explicit write; never replace corrupt/unknown documents.
      const latest = parseSavedViews(localStorage.getItem(storageKey));
      const views = operation(latest.views);
      localStorage.setItem(storageKey, JSON.stringify({ version: 1, views }));
      setStored({ views, error: null });
      setSaved(true);
      after?.();
    } catch (caught) {
      const code = caught instanceof Error && caught.message.startsWith('saved_views_') ? caught.message : 'saved_views_write_failed';
      setError(code);
    }
  };
  const update = (operation: 'rename' | 'overwrite') => {
    if (!selected) return;
    mutate((views) => {
      if (!views.some((v) => v.id === selected.id)) throw new Error('saved_views_unreadable');
      const newName = operation === 'rename' ? validateViewName(name, views, selected.id) : selected.name;
      return views.map((view) => view.id === selected.id ? { ...view, name: newName, settings: operation === 'overwrite' ? copyViewSettings(current) : view.settings } : view);
    });
  };
  return (
    <div className="rk-dropdown-container">
      <button type="button" className="rk-btn rk-btn-labeled" ref={triggerRef} aria-expanded={open} aria-controls={open ? menuId : undefined} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        {labels.saved_views}{active ? `: ${active.name}` : ''}{changed ? ` (${labels.saved_views_changed})` : ''}
      </button>
      {open ? <div id={menuId} ref={menuRef} role="dialog" aria-label={labels.saved_views} className="rk-settings-menu rk-saved-views">
        <label>{labels.saved_views_select}
          <select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setName(stored.views.find((view) => view.id === event.target.value)?.name ?? ''); setConfirmDelete(null); setSaved(false); }}>
            <option value="">{labels.saved_views_none}</option>
            {stored.views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
          </select>
        </label>
        <button type="button" className="rk-btn" disabled={!selected} onClick={() => {
          if (!selected) return;
          onApply(copyViewSettings(selected.settings)); setActiveId(selected.id); setSaved(false); setError(null);
        }}>{labels.saved_views_apply}</button>
        <label>{labels.saved_views_name}<input value={name} onChange={(event) => { setName(event.target.value); setSaved(false); }} /></label>
        <div className="rk-settings-actions">
          <button type="button" className="rk-btn" disabled={Boolean(stored.error)} onClick={() => {
            let newId = '';
            mutate((views) => {
              const trimmed = validateViewName(name, views);
              if (views.length >= MAX_SAVED_VIEWS) throw new Error('saved_views_limit');
              newId = crypto.randomUUID();
              return [...views, { id: newId, name: trimmed, settings: copyViewSettings(current) }];
            }, () => { setActiveId(newId); setSelectedId(newId); setName(name.trim()); });
          }}>{labels.saved_views_new}</button>
          <button type="button" className="rk-btn" disabled={!selected} onClick={() => update('overwrite')}>{labels.saved_views_overwrite}</button>
          <button type="button" className="rk-btn" disabled={!selected} onClick={() => update('rename')}>{labels.saved_views_rename}</button>
          <button type="button" className="rk-btn" disabled={!selected} onClick={() => { setConfirmDelete(selectedId); setSaved(false); }}>{labels.delete}</button>
        </div>
        {confirmDelete ? <div role="group" aria-label={labels.saved_views_delete_confirm}>
          <p>{labels.saved_views_delete_confirm.replace('%{name}', stored.views.find((v) => v.id === confirmDelete)?.name ?? '')}</p>
          <button type="button" className="rk-btn" onClick={() => mutate((views) => views.filter((view) => view.id !== confirmDelete), () => {
            if (activeId === confirmDelete) setActiveId('');
            setSelectedId(''); setName(''); setConfirmDelete(null);
          })}>{labels.saved_views_confirm_delete}</button>
          <button type="button" className="rk-btn" onClick={() => setConfirmDelete(null)}>{labels.cancel}</button>
        </div> : null}
        {error || stored.error ? <p role="alert">{labels[error ?? stored.error ?? 'saved_views_unreadable']}</p> : null}
        {saved ? <p role="status">{labels.saved_views_saved}</p> : null}
        {active && changed ? <p role="status">{labels.saved_views_changed}</p> : null}
        {active && validation.pending ? <p role="status">{labels.saved_views_pending}</p> : null}
        <p className="rk-settings-help">{labels.saved_views_help}</p>
      </div> : null}
    </div>
  );
}
