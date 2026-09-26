import { useEffect, useRef, useState } from 'react';
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
type Mode = 'list' | 'manage' | 'create' | 'rename' | 'delete';

function viewSummary(settings: SavedViewSettings, labels: Record<string, string>): string {
  const dueLabels = {
    all: labels.all, overdue: labels.overdue, thisweek: labels.this_week,
    '3days': labels.within_3_days, '7days': labels.within_1_week, '1day': labels.within_1_day,
    custom: labels.saved_views_due_days.replace('%{days}', String(settings.filters.dueDays ?? 7)), none: labels.not_set,
  };
  const lanes = { none: labels.none, assignee: labels.assignee, priority: labels.issue_priority, category: labels.category };
  return `${labels.due}: ${dueLabels[settings.filters.due]} / ${labels.lane_type}: ${lanes[settings.laneType]}`;
}

export function SavedViewsPopover({ storageKey, current, onApply, labels, validation }: Props) {
  const views = useSavedViews(storageKey, current, onApply);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('list');
  const [actionsOpen, setActionsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const close = () => { setOpen(false); setMode('list'); setActionsOpen(false); };
  const { triggerRef, menuRef, menuId } = useDropdownDismiss(open, close);
  const closeAndFocus = () => { close(); triggerRef.current?.focus(); };
  const changeMode = (next: Mode) => { views.clearFeedback(); setActionsOpen(false); setMode(next); };
  useEffect(() => {
    if (!open) return;
    if (mode === 'create' || mode === 'rename') inputRef.current?.focus();
    else {
      const activeView = mode === 'list' ? menuRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') : null;
      const firstView = mode === 'list' ? menuRef.current?.querySelector<HTMLButtonElement>('[aria-pressed]') : null;
      (activeView ?? firstView ?? menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled):not(.rk-saved-views-close)'))?.focus();
    }
  }, [mode, open, menuRef]);
  const triggerLabel = `${labels.saved_views}${views.changed ? ` (${labels.saved_views_changed})` : ''}`;
  const title = mode === 'create' ? labels.saved_views_create_title : mode === 'rename' ? labels.saved_views_rename_title : mode === 'manage' ? labels.saved_views_manage : labels.saved_views;
  const isForm = mode === 'create' || mode === 'rename';
  return (
    <div className="rk-dropdown-container">
      <button type="button" className={`rk-btn rk-btn-labeled rk-saved-views-trigger${open || views.active ? ' rk-btn-toggle-active' : ''}`} ref={triggerRef} aria-label={triggerLabel} aria-expanded={open} aria-controls={open ? menuId : undefined} aria-haspopup="dialog" onClick={() => { if (open) close(); else { views.clearFeedback(); setOpen(true); } }}>
        <span className="rk-icon" aria-hidden="true">bookmarks</span>
        <span className="rk-btn-label rk-saved-views-trigger-label" aria-hidden="true">{labels.saved_views}</span>
        {views.active ? <span className="rk-indicator-dot" aria-hidden="true" /> : null}
        {views.changed ? <span className="rk-icon rk-saved-views-dirty-icon" aria-hidden="true">error_outline</span> : null}
      </button>
      {open ? <div id={menuId} ref={menuRef} role="dialog" aria-label={title} className="rk-settings-menu rk-saved-views">
        <div className="rk-settings-title rk-saved-views-heading">
          {mode === 'manage' ? <button type="button" className="rk-btn rk-btn-sm rk-btn-ghost" aria-label={labels.saved_views_back} onClick={() => changeMode('list')}><span className="rk-icon" aria-hidden="true">arrow_back</span></button> : null}
          <span className="rk-saved-views-title">{title}</span>
          <button type="button" className="rk-btn rk-btn-sm rk-btn-ghost rk-saved-views-close" aria-label={labels.close} onClick={closeAndFocus}><span className="rk-icon" aria-hidden="true">close</span></button>
        </div>
        {mode === 'list' || mode === 'manage' ? <>
          {mode === 'list' ? <div className="rk-saved-views-list-heading">{labels.saved_views_switch}</div> : null}
          <div className="rk-saved-views-list">
            {views.stored.views.length === 0 ? <p className="rk-settings-help">{labels.saved_views_empty}</p> : null}
            {views.stored.views.map((view, index) => mode === 'list' ? (
              <button key={view.id} type="button" className="rk-settings-row rk-saved-views-row" aria-pressed={view.id === views.activeId} aria-label={`${view.name}${view.id === views.activeId && views.changed ? ` (${labels.saved_views_changed})` : ''}`} aria-describedby={`${menuId}-summary-${index}`} onClick={() => {
                views.applyView(view.id);
              }}>
                <span className="rk-icon rk-saved-views-check" aria-hidden="true">{view.id === views.activeId ? 'check' : ''}</span>
                <span className="rk-saved-views-label">
                  <span className="rk-saved-views-name" title={view.name}>{view.name}</span>
                  <span className="rk-saved-views-description" id={`${menuId}-summary-${index}`}>{viewSummary(view.settings, labels)}</span>
                </span>
                {view.id === views.activeId && views.changed ? <span className="rk-saved-views-dirty">{labels.saved_views_changed}</span> : null}
              </button>
            ) : (
              <div key={view.id} className="rk-saved-views-managed" aria-current={view.id === views.activeId ? true : undefined}>
                <div className="rk-saved-views-row">
                  <span className="rk-icon rk-saved-views-check" aria-hidden="true">{view.id === views.activeId ? 'check' : ''}</span>
                  <span className="rk-saved-views-name" title={view.name}>{view.name}</span>
                  <button type="button" className="rk-btn rk-btn-sm rk-btn-ghost" aria-label={labels.saved_views_actions.replace('%{name}', view.name)} aria-expanded={actionsOpen && views.selectedId === view.id} aria-controls={actionsOpen && views.selectedId === view.id ? `${menuId}-actions` : undefined} onClick={() => {
                    const expanded = actionsOpen && views.selectedId === view.id;
                    views.select(view.id); setActionsOpen(!expanded);
                  }}><span className="rk-icon" aria-hidden="true">more_horiz</span></button>
                </div>
                {actionsOpen && views.selectedId === view.id ? <div id={`${menuId}-actions`} className="rk-saved-views-row-actions" role="group" aria-label={labels.saved_views_actions.replace('%{name}', view.name)}>
                  <button type="button" className="rk-settings-row" onClick={() => changeMode('rename')}>{labels.saved_views_rename}</button>
                  <button type="button" className="rk-settings-row rk-saved-views-delete" onClick={() => changeMode('delete')}>{labels.delete}</button>
                </div> : null}
              </div>
            ))}
          </div>
          {mode === 'list' && views.active && views.changed ? <div className="rk-saved-views-save-changes"><button type="button" className="rk-btn rk-btn-sm rk-btn-primary" onClick={() => { if (views.update('overwrite')) menuRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus(); }}>{labels.saved_views_overwrite}</button></div> : null}
          {mode === 'list' ? <div className="rk-saved-views-section rk-saved-views-footer">
            <button type="button" className="rk-settings-row rk-saved-views-new" disabled={Boolean(views.stored.error)} onClick={() => { views.editName(''); changeMode('create'); }}><span className="rk-icon" aria-hidden="true">add</span>{labels.saved_views_new}</button>
            <button type="button" className="rk-settings-row rk-saved-views-action" onClick={() => changeMode('manage')}><span className="rk-icon" aria-hidden="true">settings</span>{labels.saved_views_manage}</button>
            {views.active ? <button type="button" className="rk-saved-views-clear" title={labels.saved_views_clear_help} onClick={() => { if (views.clearActiveView()) closeAndFocus(); }}>{labels.saved_views_clear}</button> : null}
          </div> : null}
        </> : null}
        {isForm ? <form className="rk-saved-views-section" onSubmit={(event) => {
          event.preventDefault();
          if (mode === 'create' ? views.create() : views.update('rename')) setMode(mode === 'create' ? 'list' : 'manage');
        }}>
          <label className="rk-saved-views-field">{labels.saved_views_name}<input ref={inputRef} value={views.name} onChange={(event) => views.editName(event.target.value)} /></label>
          <div className="rk-saved-views-form-actions">
            <button type="button" className="rk-btn rk-btn-sm" onClick={() => changeMode(mode === 'create' ? 'list' : 'manage')}>{labels.cancel}</button>
            <button type="submit" className="rk-btn rk-btn-sm rk-btn-primary">{mode === 'create' ? labels.save : labels.saved_views_rename_submit}</button>
          </div>
        </form> : null}
        {mode === 'delete' && views.selected ? <div className="rk-saved-views-confirm" role="group" aria-label={labels.delete}>
          <p>{labels.saved_views_delete_confirm.replace('%{name}', views.selected.name)}</p>
          <div className="rk-saved-views-form-actions">
            <button type="button" className="rk-btn rk-btn-sm" onClick={() => changeMode('manage')}>{labels.cancel}</button>
            <button type="button" className="rk-btn rk-btn-sm rk-btn-danger" onClick={() => { if (views.remove(views.selectedId)) setMode('manage'); }}>{labels.saved_views_confirm_delete}</button>
          </div>
        </div> : null}
        {views.error || views.stored.error ? <p className="rk-saved-views-message is-error" role="alert">{labels[views.error ?? views.stored.error ?? 'saved_views_unreadable']}</p> : null}
        {views.saved ? <p className="rk-saved-views-message is-success" role="status">{labels.saved_views_saved}</p> : null}
        {views.active && validation.pending ? <p className="rk-saved-views-message" role="status">{labels.saved_views_pending}</p> : null}
        <p className="rk-settings-help">{mode === 'list' ? labels.saved_views_switch_help : mode === 'manage' ? labels.saved_views_manage_help : labels.saved_views_help}</p>
      </div> : null}
    </div>
  );
}
