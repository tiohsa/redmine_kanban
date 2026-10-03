import { useState } from 'react';
import type { FitMode } from '../../model/view/types';
import type { CardDisplayMode, LaneType } from '../useKanbanPreferences';
import { useDropdownDismiss } from './useDropdownDismiss';

const FONT_SIZE_OPTIONS = ['10', '12', '13', '14', '16', '18', '20', '22', '24', '26', '28', '30'] as const;

export function SettingsToggle({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="rk-settings-row" onClick={onChange} role="switch" aria-checked={checked} disabled={disabled}>
      <span>{label}</span>
      <span className={`rk-switch ${checked ? 'rk-switch-on' : ''}`} aria-hidden="true">
        <span className="rk-switch-thumb" />
      </span>
    </button>
  );
}

function SettingsSelect({ label, value, options, onChange, selectClassName }: { label: string; value: string; options: { id: string; name: string }[]; onChange: (value: string) => void; selectClassName?: string }) {
  return (
    <label className="rk-settings-select-row">
      <span>{label}</span>
      <select className={selectClassName} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
    </label>
  );
}

export function DisplaySettingsPopover({
  labels,
  showSubtasks,
  onToggleShowSubtasks,
  laneType,
  onChangeLaneType,
  agingWarnDays,
  onChangeAgingWarnDays,
  agingDangerDays,
  onChangeAgingDangerDays,
  agingExcludeClosed,
  onToggleAgingExcludeClosed,
  timeEntryOnClose,
  onToggleTimeEntryOnClose,
  fitMode,
  onToggleFitMode,
  cardDisplayMode,
  onChangeCardDisplayMode,
  fontSize,
  onChangeFontSize,
}: {
  labels: Record<string, string>;
  showSubtasks: boolean;
  onToggleShowSubtasks: () => void;
  laneType: LaneType;
  onChangeLaneType: (value: LaneType) => void;
  agingWarnDays: number;
  onChangeAgingWarnDays: (value: number) => void;
  agingDangerDays: number;
  onChangeAgingDangerDays: (value: number) => void;
  agingExcludeClosed: boolean;
  onToggleAgingExcludeClosed: () => void;
  timeEntryOnClose: boolean;
  onToggleTimeEntryOnClose: () => void;
  fitMode: FitMode;
  onToggleFitMode: () => void;
  cardDisplayMode: CardDisplayMode;
  onChangeCardDisplayMode: (value: CardDisplayMode) => void;
  fontSize: number;
  onChangeFontSize: (size: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const { triggerRef, menuRef, menuId } = useDropdownDismiss(open, () => setOpen(false));
  const title = labels.display_settings;
  const widthOptions = [
    { id: 'none', name: labels.fit_none },
    { id: 'width', name: labels.fit_width },
  ];
  const fontSizeOptions = FONT_SIZE_OPTIONS.map((value) => ({ id: value, name: `${value}px` }));
  const isSingleLineMode = cardDisplayMode === 'single_line';

  return (
    <div className="rk-dropdown-container">
      <button type="button" ref={triggerRef} aria-label={title} aria-expanded={open} aria-controls={open ? menuId : undefined} aria-haspopup="dialog" className={`rk-btn rk-btn-labeled ${open ? 'rk-btn-toggle-active' : ''}`} onClick={() => setOpen(!open)} title={title}>
        <span className="rk-icon">tune</span>
        <span className="rk-btn-label">{title}</span>
      </button>
      {open ? (
        <div id={menuId} ref={menuRef} className="rk-settings-menu" role="dialog" aria-label={title}>
          <div className="rk-settings-title">{title}</div>
          <SettingsToggle label={labels.show_subtasks_short} checked={isSingleLineMode ? false : showSubtasks} onChange={onToggleShowSubtasks} disabled={isSingleLineMode} />
          <SettingsSelect label={labels.lane_type} value={laneType} options={[
            { id: 'none', name: labels.none },
            { id: 'assignee', name: labels.assignee },
            { id: 'priority', name: labels.issue_priority },
            { id: 'category', name: labels.category },
          ]} onChange={(value) => onChangeLaneType(value as LaneType)} />
          <SettingsSelect label={labels.aging_warn_days} value={String(agingWarnDays)} options={[0, 1, 3, 5, 7, 14, 30].map((value) => ({ id: String(value), name: String(value) }))} onChange={(value) => onChangeAgingWarnDays(Number(value))} selectClassName="rk-settings-aging-days-select" />
          <SettingsSelect label={labels.aging_danger_days} value={String(agingDangerDays)} options={[1, 3, 5, 7, 14, 30, 60].map((value) => ({ id: String(value), name: String(value) }))} onChange={(value) => onChangeAgingDangerDays(Number(value))} selectClassName="rk-settings-aging-days-select" />
          <SettingsToggle label={labels.aging_exclude_closed} checked={agingExcludeClosed} onChange={onToggleAgingExcludeClosed} />
          <SettingsToggle label={labels.time_entry_short} checked={timeEntryOnClose} onChange={onToggleTimeEntryOnClose} />
          <SettingsSelect label={labels.display_width} value={fitMode} options={widthOptions} onChange={(value) => { if (value !== fitMode) onToggleFitMode(); }} />
          <SettingsSelect label={labels.card_display_mode} value={cardDisplayMode} options={[
            { id: 'standard', name: labels.card_display_standard },
            { id: 'single_line', name: labels.card_display_single_line },
          ]} onChange={(value) => onChangeCardDisplayMode(value === 'single_line' ? 'single_line' : 'standard')} />
          <SettingsSelect label={labels.font_size} value={String(fontSize)} options={fontSizeOptions} onChange={(value) => onChangeFontSize(Number(value))} />
        </div>
      ) : null}
    </div>
  );
}
