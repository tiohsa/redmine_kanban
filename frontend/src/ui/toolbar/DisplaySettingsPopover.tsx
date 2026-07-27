import { useState } from 'react';
import type { FitMode } from '../kanbanShared';
import type { LaneType } from '../useKanbanPreferences';
import { useDropdownDismiss } from './useDropdownDismiss';

const FONT_SIZE_OPTIONS = ['10', '12', '14', '16', '18', '20', '22', '24', '26', '28', '30'] as const;

export function SettingsToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <button type="button" className="rk-settings-row" onClick={onChange} role="switch" aria-checked={checked}>
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
  fontSize: number;
  onChangeFontSize: (size: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const { triggerRef, menuRef } = useDropdownDismiss(open, () => setOpen(false));
  const title = labels.display_settings ?? 'Display settings';
  const widthOptions = [
    { id: 'none', name: labels.fit_none ?? 'Original size' },
    { id: 'width', name: labels.fit_width ?? 'Fit to width' },
  ];
  const fontSizeOptions = FONT_SIZE_OPTIONS.map((value) => ({ id: value, name: `${value}px` }));

  return (
    <div className="rk-dropdown-container">
      <div ref={triggerRef} className={`rk-btn rk-btn-labeled ${open ? 'rk-btn-toggle-active' : ''}`} onClick={() => setOpen(!open)} title={title} aria-expanded={open} role="button" tabIndex={0}>
        <span className="rk-icon">tune</span>
        <span className="rk-btn-label">{title}</span>
      </div>
      {open ? (
        <div ref={menuRef} className="rk-settings-menu" role="dialog" aria-label={title}>
          <div className="rk-settings-title">{title}</div>
          <SettingsToggle label={labels.show_subtasks_short ?? labels.show_subtasks ?? 'Show subtasks'} checked={showSubtasks} onChange={onToggleShowSubtasks} />
          <SettingsSelect label={labels.lane_type ?? 'Swimlane'} value={laneType} options={[
            { id: 'none', name: labels.none ?? 'None' },
            { id: 'assignee', name: labels.assignee ?? 'Assignee' },
            { id: 'priority', name: labels.issue_priority ?? 'Priority' },
          ]} onChange={(value) => onChangeLaneType(value as LaneType)} />
          <SettingsSelect label={labels.aging_warn_days ?? 'Aging warning days'} value={String(agingWarnDays)} options={[0, 1, 3, 5, 7, 14, 30].map((value) => ({ id: String(value), name: String(value) }))} onChange={(value) => onChangeAgingWarnDays(Number(value))} selectClassName="rk-settings-aging-days-select" />
          <SettingsSelect label={labels.aging_danger_days ?? 'Aging danger days'} value={String(agingDangerDays)} options={[1, 3, 5, 7, 14, 30, 60].map((value) => ({ id: String(value), name: String(value) }))} onChange={(value) => onChangeAgingDangerDays(Number(value))} selectClassName="rk-settings-aging-days-select" />
          <SettingsToggle label={labels.aging_exclude_closed ?? 'Exclude closed issues from aging'} checked={agingExcludeClosed} onChange={onToggleAgingExcludeClosed} />
          <SettingsToggle label={labels.time_entry_short ?? 'Time entry on close'} checked={timeEntryOnClose} onChange={onToggleTimeEntryOnClose} />
          <SettingsSelect label={labels.display_width ?? 'Display width'} value={fitMode} options={widthOptions} onChange={(value) => { if (value !== fitMode) onToggleFitMode(); }} />
          <SettingsSelect label={labels.font_size ?? 'Font size'} value={String(fontSize)} options={fontSizeOptions} onChange={(value) => onChangeFontSize(Number(value))} />
        </div>
      ) : null}
    </div>
  );
}
