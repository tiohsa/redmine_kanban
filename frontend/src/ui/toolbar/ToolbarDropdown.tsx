import { useMemo, useState, type ReactNode } from 'react';
import { useDropdownDismiss } from './useDropdownDismiss';

type Option<T extends string> = { id: T; name: string };

function triggerClass(showLabel: boolean | undefined, open: boolean, active: boolean) {
  return `rk-dropdown-trigger ${showLabel ? 'rk-dropdown-trigger-labeled' : ''} ${open ? 'rk-active' : ''} ${active ? 'rk-active-soft' : ''}`;
}

export function ToolbarDropdown<T extends string>({
  label,
  icon,
  options,
  value,
  onChange,
  onReset,
  width = '240px',
  closeOnSelect = true,
  labels,
  showDot,
  active,
  showTriggerLabel,
}: {
  label: string;
  icon: string;
  options: Option<T>[];
  value: T;
  onChange: (id: T) => void;
  onReset?: () => void;
  width?: string;
  closeOnSelect?: boolean;
  labels: Record<string, string>;
  showDot?: boolean;
  active?: boolean;
  showTriggerLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { triggerRef, menuRef } = useDropdownDismiss(open, () => setOpen(false));
  const selectedName = options.find((option) => option.id === value)?.name ?? value;

  return (
    <div className="rk-dropdown-container">
      <div ref={triggerRef} className={triggerClass(showTriggerLabel, open, Boolean(showDot))} onClick={() => setOpen(!open)} title={selectedName}>
        <span className="rk-icon">{icon}</span>
        {showTriggerLabel ? <span>{label}</span> : null}
        {showDot ? <span className="rk-indicator-dot" /> : null}
      </div>
      {open ? (
        <div ref={menuRef} className="rk-dropdown-menu" style={{ width }}>
          <div className="rk-dropdown-title">{label}</div>
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {options.map((option) => (
              <div
                key={option.id}
                className={`rk-dropdown-item ${option.id === value ? 'selected' : ''}`}
                onClick={() => {
                  onChange(option.id);
                  if (closeOnSelect) setOpen(false);
                }}
              >
                <div className="rk-dropdown-checkbox" />
                <span>{option.name}</span>
              </div>
            ))}
          </div>
          {onReset ? (
            <div className="rk-dropdown-footer">
              <button type="button" className="rk-dropdown-link" onClick={() => { onReset(); setOpen(false); }}>
                {labels.reset}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ToolbarMultiSelect({
  label,
  icon,
  options,
  value,
  onChange,
  onReset,
  width = '240px',
  labels,
  includeAllOption = false,
  allLabel,
  showDot,
  active,
  showTriggerLabel,
  extraContent,
}: {
  label: string;
  icon: string;
  options: Option<string>[];
  value: string[];
  onChange: (ids: string[]) => void;
  onReset?: () => void;
  width?: string;
  labels: Record<string, string>;
  includeAllOption?: boolean;
  allLabel?: string;
  showDot?: boolean;
  active?: boolean;
  showTriggerLabel?: boolean;
  extraContent?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { triggerRef, menuRef } = useDropdownDismiss(open, () => setOpen(false));
  const optionIds = useMemo(() => options.map((option) => option.id), [options]);
  const optionIdSet = useMemo(() => new Set(optionIds), [optionIds]);
  const allSelected = optionIds.length > 0 && optionIds.every((id) => value.includes(id));
  const selectedCount = value.filter((id) => optionIdSet.has(id)).length;
  const resolvedAllLabel = allLabel ?? labels.all ?? 'All';
  const title = allSelected
    ? resolvedAllLabel
    : value.length > 0
      ? value.map((selected) => options.find((option) => option.id === selected)?.name).join(', ')
      : label;

  return (
    <div className="rk-dropdown-container">
      <div ref={triggerRef} className={triggerClass(showTriggerLabel, open, active ?? Boolean(showDot))} onClick={() => setOpen(!open)} title={title}>
        <span className="rk-icon">{icon}</span>
        {showTriggerLabel ? <span>{selectedCount > 0 ? `${label} (${selectedCount})` : label}</span> : null}
        {showDot ? <span className="rk-indicator-dot" /> : null}
      </div>
      {open ? (
        <div ref={menuRef} className="rk-dropdown-menu" style={{ width }}>
          <div className="rk-dropdown-title">{label}</div>
          {extraContent ? <div className="rk-dropdown-extra">{extraContent}</div> : null}
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {includeAllOption ? (
              <div className={`rk-dropdown-item ${allSelected ? 'selected' : ''}`} onClick={() => onChange(allSelected ? [] : optionIds)}>
                <div className="rk-dropdown-checkbox" />
                <span>{resolvedAllLabel}</span>
              </div>
            ) : null}
            {options.map((option) => {
              const checked = value.includes(option.id);
              return (
                <div
                  key={option.id}
                  className={`rk-dropdown-item ${checked ? 'selected' : ''}`}
                  onClick={() => onChange(checked ? value.filter((selected) => selected !== option.id) : [...value, option.id])}
                >
                  <div className="rk-dropdown-checkbox" />
                  <span>{option.name}</span>
                </div>
              );
            })}
          </div>
          {onReset ? (
            <div className="rk-dropdown-footer">
              <button type="button" className="rk-dropdown-link" onClick={() => { onReset(); setOpen(false); }}>
                {labels.reset}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
