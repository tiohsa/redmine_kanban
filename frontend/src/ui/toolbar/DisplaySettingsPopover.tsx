import { useEffect, useState } from 'react';
import type { FitMode } from '../kanbanShared';
import { DEFAULT_MAXIMUM_BOARD_ENTITY_COUNT, MAXIMUM_BOARD_ENTITY_COUNT, parseMaximumBoardEntityCount, type LaneType } from '../useKanbanPreferences';
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
  maximumBoardEntityCount = DEFAULT_MAXIMUM_BOARD_ENTITY_COUNT,
  onChangeMaximumBoardEntityCount = () => {},
  serverEntityLimit,
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
  maximumBoardEntityCount?: number;
  onChangeMaximumBoardEntityCount?: (value: number) => void;
  serverEntityLimit?: number;
}) {
  const [open, setOpen] = useState(false);
  const [maximumEntityCountDraft, setMaximumEntityCountDraft] = useState(String(maximumBoardEntityCount));
  const [maximumEntityCountError, setMaximumEntityCountError] = useState<string | null>(null);
  const [maximumEntityCountSaved, setMaximumEntityCountSaved] = useState(false);
  const { triggerRef, menuRef } = useDropdownDismiss(open, () => setOpen(false));
  useEffect(() => {
    setMaximumEntityCountDraft(String(maximumBoardEntityCount));
  }, [maximumBoardEntityCount]);
  const title = labels.display_settings;
  const widthOptions = [
    { id: 'none', name: labels.fit_none },
    { id: 'width', name: labels.fit_width },
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
          <SettingsToggle label={labels.show_subtasks_short} checked={showSubtasks} onChange={onToggleShowSubtasks} />
          <SettingsSelect label={labels.lane_type} value={laneType} options={[
            { id: 'none', name: labels.none },
            { id: 'assignee', name: labels.assignee },
            { id: 'priority', name: labels.issue_priority },
          ]} onChange={(value) => onChangeLaneType(value as LaneType)} />
          <SettingsSelect label={labels.aging_warn_days} value={String(agingWarnDays)} options={[0, 1, 3, 5, 7, 14, 30].map((value) => ({ id: String(value), name: String(value) }))} onChange={(value) => onChangeAgingWarnDays(Number(value))} selectClassName="rk-settings-aging-days-select" />
          <SettingsSelect label={labels.aging_danger_days} value={String(agingDangerDays)} options={[1, 3, 5, 7, 14, 30, 60].map((value) => ({ id: String(value), name: String(value) }))} onChange={(value) => onChangeAgingDangerDays(Number(value))} selectClassName="rk-settings-aging-days-select" />
          <SettingsToggle label={labels.aging_exclude_closed} checked={agingExcludeClosed} onChange={onToggleAgingExcludeClosed} />
          <SettingsToggle label={labels.time_entry_short} checked={timeEntryOnClose} onChange={onToggleTimeEntryOnClose} />
          <div className="rk-settings-field">
            <label className="rk-settings-field-label" htmlFor="rk-maximum-board-entity-count">
              <span className="rk-settings-label-with-info">
              <span>{labels.maximum_board_entity_count}</span>
              <span className="rk-settings-info-wrap">
                <button
                  type="button"
                  className="rk-settings-info"
                  aria-label={labels.maximum_board_entity_count_help}
                >
                  <span className="rk-settings-info-glyph" aria-hidden="true">i</span>
                </button>
                <span className="rk-settings-tooltip" role="tooltip">
                  {labels.maximum_board_entity_count_help.replace('%{max}', MAXIMUM_BOARD_ENTITY_COUNT.toLocaleString())}
                  {serverEntityLimit ? ` ${labels.server_entity_limit_notice.replace('%{count}', String(serverEntityLimit))}` : ''}
                </span>
              </span>
              </span>
            </label>
            <input
              id="rk-maximum-board-entity-count"
              className="rk-input"
              type="text"
              inputMode="numeric"
              value={maximumEntityCountDraft}
              onChange={(event) => {
                setMaximumEntityCountDraft(event.target.value);
                setMaximumEntityCountError(null);
                setMaximumEntityCountSaved(false);
              }}
              aria-invalid={maximumEntityCountError ? 'true' : 'false'}
            />
          </div>
          {maximumEntityCountError ? <div className="rk-settings-error" role="alert">{maximumEntityCountError}</div> : null}
          {maximumEntityCountSaved ? <div className="rk-settings-help" role="status">{labels.maximum_board_entity_count_saved}</div> : null}
          <div className="rk-settings-actions">
            <button type="button" className="rk-btn rk-btn-sm" onClick={() => {
              const parsed = parseMaximumBoardEntityCount(maximumEntityCountDraft);
              if (parsed === null) {
                setMaximumEntityCountError(labels.maximum_board_entity_count_invalid);
                return;
              }
              onChangeMaximumBoardEntityCount(parsed);
              setMaximumEntityCountError(null);
              setMaximumEntityCountSaved(true);
            }}>{labels.save}</button>
            <button type="button" className="rk-btn rk-btn-sm" onClick={() => {
              setMaximumEntityCountDraft(String(DEFAULT_MAXIMUM_BOARD_ENTITY_COUNT));
              onChangeMaximumBoardEntityCount(DEFAULT_MAXIMUM_BOARD_ENTITY_COUNT);
              setMaximumEntityCountError(null);
              setMaximumEntityCountSaved(true);
            }}>{labels.reset}</button>
          </div>
          <SettingsSelect label={labels.display_width} value={fitMode} options={widthOptions} onChange={(value) => { if (value !== fitMode) onToggleFitMode(); }} />
          <SettingsSelect label={labels.font_size} value={String(fontSize)} options={fontSizeOptions} onChange={(value) => onChangeFontSize(Number(value))} />
        </div>
      ) : null}
    </div>
  );
}
