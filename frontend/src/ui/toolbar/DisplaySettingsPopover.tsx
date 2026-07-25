import { useState } from 'react';
import type { FitMode } from '../kanbanShared';
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

function SettingsSelect({ label, value, options, onChange }: { label: string; value: string; options: { id: string; name: string }[]; onChange: (value: string) => void }) {
  return (
    <label className="rk-settings-select-row">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
    </label>
  );
}

export function DisplaySettingsPopover({
  labels,
  showSubtasks,
  onToggleShowSubtasks,
  priorityLaneEnabled,
  onTogglePriorityLane,
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
  priorityLaneEnabled: boolean;
  onTogglePriorityLane: () => void;
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
          <SettingsToggle label={labels.priority_lane_short ?? labels.show_priority_lanes ?? 'Priority lanes'} checked={priorityLaneEnabled} onChange={onTogglePriorityLane} />
          <SettingsToggle label={labels.time_entry_short ?? 'Time entry on close'} checked={timeEntryOnClose} onChange={onToggleTimeEntryOnClose} />
          <SettingsSelect label={labels.display_width ?? 'Display width'} value={fitMode} options={widthOptions} onChange={(value) => { if (value !== fitMode) onToggleFitMode(); }} />
          <SettingsSelect label={labels.font_size ?? 'Font size'} value={String(fontSize)} options={fontSizeOptions} onChange={(value) => onChangeFontSize(Number(value))} />
        </div>
      ) : null}
    </div>
  );
}
