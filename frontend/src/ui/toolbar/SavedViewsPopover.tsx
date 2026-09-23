import { useState } from 'react';
import type { SavedViewSettings } from '../../model/view/savedViews';
import { useSavedViews } from '../../application/savedViews/useSavedViews';
import type { ViewValidation } from '../../model/view/validation';
import { useDropdownDismiss } from './useDropdownDismiss';

type Props = {
  storageKey: string;
  current: SavedViewSettings;
  onApply: (settings: SavedViewSettings) => void;
  labels: Record<string, string>;
  validation: ViewValidation;
};
export function SavedViewsPopover({ storageKey, current, onApply, labels, validation }: Props) {
  const views = useSavedViews(storageKey, current, onApply);
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const { triggerRef, menuRef, menuId } = useDropdownDismiss(open, () => { setOpen(false); setConfirmDelete(null); });
  const triggerLabel = `${labels.saved_views}${views.active ? `: ${views.active.name}` : ''}${views.changed ? ` (${labels.saved_views_changed})` : ''}`;
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
            <select value={views.selectedId} onChange={(event) => { views.select(event.target.value); setConfirmDelete(null); }}>
              <option value="">{labels.saved_views_none}</option>
              {views.stored.views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
            </select>
          </label>
          <button type="button" className="rk-btn rk-btn-sm rk-saved-views-apply" disabled={!views.selected} onClick={views.apply}>{labels.saved_views_apply}</button>
        </div>
        <div className="rk-saved-views-section">
          <label className="rk-saved-views-field">{labels.saved_views_name}<input value={views.name} onChange={(event) => views.editName(event.target.value)} /></label>
          <div className="rk-saved-views-actions">
            <button type="button" className="rk-btn rk-btn-sm" disabled={Boolean(views.stored.error)} onClick={views.create}>{labels.saved_views_new}</button>
            <button type="button" className="rk-btn rk-btn-sm" disabled={!views.selected} onClick={() => views.update('overwrite')}>{labels.saved_views_overwrite}</button>
            <button type="button" className="rk-btn rk-btn-sm" disabled={!views.selected} onClick={() => views.update('rename')}>{labels.saved_views_rename}</button>
            <button type="button" className="rk-btn rk-btn-sm" disabled={!views.selected} onClick={() => { setConfirmDelete(views.selectedId); views.clearSaved(); }}>{labels.delete}</button>
          </div>
        </div>
        {confirmDelete ? <div className="rk-saved-views-confirm" role="group" aria-label={labels.saved_views_delete_confirm}>
          <p>{labels.saved_views_delete_confirm.replace('%{name}', views.stored.views.find((v) => v.id === confirmDelete)?.name ?? '')}</p>
          <div className="rk-saved-views-confirm-actions">
            <button type="button" className="rk-btn rk-btn-sm rk-btn-danger" onClick={() => { if (views.remove(confirmDelete)) setConfirmDelete(null); }}>{labels.saved_views_confirm_delete}</button>
            <button type="button" className="rk-btn rk-btn-sm" onClick={() => setConfirmDelete(null)}>{labels.cancel}</button>
          </div>
        </div> : null}
        {views.error || views.stored.error ? <p className="rk-saved-views-message is-error" role="alert">{labels[views.error ?? views.stored.error ?? 'saved_views_unreadable']}</p> : null}
        {views.saved ? <p className="rk-saved-views-message is-success" role="status">{labels.saved_views_saved}</p> : null}
        {views.active && views.changed ? <p className="rk-saved-views-message" role="status">{labels.saved_views_changed}</p> : null}
        {views.active && validation.pending ? <p className="rk-saved-views-message" role="status">{labels.saved_views_pending}</p> : null}
        <p className="rk-settings-help">{labels.saved_views_help}</p>
      </div> : null}
    </div>
  );
}
