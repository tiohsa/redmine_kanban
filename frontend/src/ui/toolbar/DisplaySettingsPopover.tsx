import { useState } from 'react';
import type { FitMode } from '../../model/view/types';
import type { CardDisplayMode, LaneType } from '../useKanbanPreferences';
import { useDropdownDismiss } from './useDropdownDismiss';
import { DEFAULT_ISSUE_DIALOG_SIZE, type IssueDialogSizeSettings } from '../../model/view/issueDialogSize';

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

function SettingsSelect({ label, value, options, onChange, selectClassName, disabled = false }: { label: string; value: string; options: { id: string; name: string }[]; onChange: (value: string) => void; selectClassName?: string; disabled?: boolean }) {
  return (
    <label className="rk-settings-select-row">
      <span>{label}</span>
      <select className={selectClassName} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
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
  issueDialogSize = DEFAULT_ISSUE_DIALOG_SIZE,
  onChangeIssueDialogSize = () => {},
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
  issueDialogSize?: IssueDialogSizeSettings;
  onChangeIssueDialogSize?: (settings: IssueDialogSizeSettings) => void;
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
          <div role="group" aria-label={labels.issue_dialog_settings}>
            <div className="rk-settings-title">{labels.issue_dialog_settings}</div>
            <SettingsSelect label={labels.issue_dialog_width} selectClassName="rk-settings-dialog-width-select" value={String(issueDialogSize.widthPx)} options={[
              { id: '900', name: labels.issue_dialog_width_compact },
              { id: '1200', name: labels.issue_dialog_width_standard },
              { id: '1500', name: labels.issue_dialog_width_wide },
            ]} disabled={issueDialogSize.fullScreen} onChange={(value) => onChangeIssueDialogSize({ ...issueDialogSize, widthPx: Number(value) as IssueDialogSizeSettings['widthPx'] })} />
            <SettingsSelect label={labels.issue_dialog_height} value={issueDialogSize.heightMode} options={[
              { id: 'auto', name: labels.issue_dialog_height_auto },
              { id: 'fixed', name: labels.issue_dialog_height_fixed },
            ]} disabled={issueDialogSize.fullScreen} onChange={(value) => onChangeIssueDialogSize({ ...issueDialogSize, heightMode: value === 'fixed' ? 'fixed' : 'auto' })} />
            <SettingsSelect label={labels.issue_dialog_height_percent} value={String(issueDialogSize.heightPercent)} options={
              Array.from({ length: 9 }, (_, index) => 50 + index * 5).map((percent) => ({ id: String(percent), name: `${percent}%` }))
            } disabled={issueDialogSize.fullScreen || issueDialogSize.heightMode !== 'fixed'} onChange={(value) => onChangeIssueDialogSize({ ...issueDialogSize, heightPercent: Number(value) })} />
            <SettingsToggle label={labels.issue_dialog_fullscreen} checked={issueDialogSize.fullScreen} onChange={() => onChangeIssueDialogSize({ ...issueDialogSize, fullScreen: !issueDialogSize.fullScreen })} />
            <button type="button" className="rk-settings-row" onClick={() => onChangeIssueDialogSize({ ...DEFAULT_ISSUE_DIALOG_SIZE })}>{labels.issue_dialog_reset}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
