import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useDropdownDismiss } from './useDropdownDismiss';

type Option<T extends string> = { id: T; name: string; searchText?: string };

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
  const { triggerRef, menuRef, menuId } = useDropdownDismiss(open, () => setOpen(false));
  const selectedName = options.find((option) => option.id === value)?.name ?? value;

  return (
    <div className="rk-dropdown-container">
      <button type="button" ref={triggerRef} aria-label={label} aria-expanded={open} aria-controls={open ? menuId : undefined} aria-haspopup="dialog" className={triggerClass(showTriggerLabel, open, Boolean(showDot))} onClick={() => setOpen(!open)} title={selectedName}>
        <span className="rk-icon">{icon}</span>
        {showTriggerLabel ? <span>{label}</span> : null}
        {showDot ? <span className="rk-indicator-dot" /> : null}
      </button>
      {open ? (
        <div id={menuId} ref={menuRef} role="dialog" aria-label={label} className="rk-dropdown-menu" style={{ width }}>
          <div className="rk-dropdown-title">{label}</div>
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {options.map((option) => (
              <button type="button" aria-pressed={option.id === value}
                key={option.id}
                className={`rk-dropdown-item ${option.id === value ? 'selected' : ''}`}
                onClick={() => {
                  onChange(option.id);
                  if (closeOnSelect) setOpen(false);
                }}
              >
                <span className="rk-dropdown-checkbox" aria-hidden="true" />
                <span>{option.name}</span>
              </button>
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
  searchable = false,
  searchPlaceholder,
  searchEmptyLabel,
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
  searchable?: boolean;
  searchPlaceholder?: string;
  searchEmptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const closeDropdown = () => {
    setOpen(false);
    setQuery('');
  };
  const { triggerRef, menuRef, menuId } = useDropdownDismiss(open, closeDropdown);
  const visibleOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!searchable || !normalizedQuery) return options;
    return options.filter((option) => (option.searchText ?? option.name).toLowerCase().includes(normalizedQuery));
  }, [options, query, searchable]);
  const optionIds = useMemo(() => options.map((option) => option.id), [options]);
  const optionIdSet = useMemo(() => new Set(optionIds), [optionIds]);
  const allSelected = optionIds.length > 0 && optionIds.every((id) => value.includes(id));
  const selectedCount = value.filter((id) => optionIdSet.has(id)).length;
  const resolvedAllLabel = allLabel ?? labels.all;
  const title = allSelected
    ? resolvedAllLabel
    : value.length > 0
      ? value.map((selected) => options.find((option) => option.id === selected)?.name).join(', ')
      : label;

  return (
    <div className="rk-dropdown-container">
      <button type="button" ref={triggerRef} aria-label={label} aria-expanded={open} aria-controls={open ? menuId : undefined} aria-haspopup="dialog" className={triggerClass(showTriggerLabel, open, active ?? Boolean(showDot))} onClick={() => open ? closeDropdown() : setOpen(true)} title={title}>
        <span className="rk-icon">{icon}</span>
        {showTriggerLabel ? <span>{selectedCount > 0 ? `${label} (${selectedCount})` : label}</span> : null}
        {showDot ? <span className="rk-indicator-dot" /> : null}
      </button>
      {open ? (
        <div id={menuId} ref={menuRef} role="dialog" aria-label={label} className="rk-dropdown-menu" style={{ width }}>
          <div className="rk-dropdown-title">{label}</div>
          {searchable ? (
            <div style={{ padding: '8px 12px' }}>
              <div className="rk-search-box">
                <span className="rk-icon">search</span>
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder ?? label}
                />
                {query ? (
                  <button
                    type="button"
                    className="rk-search-clear"
                    aria-label={label}
                    onClick={() => {
                      setQuery('');
                      inputRef.current?.focus();
                    }}
                  >
                    <span className="rk-icon">close</span>
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          {extraContent ? <div className="rk-dropdown-extra">{extraContent}</div> : null}
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {includeAllOption ? (
              <button type="button" aria-pressed={allSelected} className={`rk-dropdown-item ${allSelected ? 'selected' : ''}`} onClick={() => onChange(allSelected ? [] : optionIds)}>
                <span className="rk-dropdown-checkbox" aria-hidden="true" />
                <span>{resolvedAllLabel}</span>
              </button>
            ) : null}
            {searchable && visibleOptions.length === 0 ? (
              <div role="status" style={{ padding: '8px 12px', color: 'var(--rk-text-secondary)', fontSize: '13px' }}>
                {searchEmptyLabel ?? labels.no_result ?? 'No results'}
              </div>
            ) : null}
            {visibleOptions.map((option) => {
              const checked = value.includes(option.id);
              return (
                <button type="button" aria-pressed={checked}
                  key={option.id}
                  className={`rk-dropdown-item ${checked ? 'selected' : ''}`}
                  onClick={() => onChange(checked ? value.filter((selected) => selected !== option.id) : [...value, option.id])}
                >
                  <span className="rk-dropdown-checkbox" aria-hidden="true" />
                  <span>{option.name}</span>
                </button>
              );
            })}
          </div>
          {onReset ? (
            <div className="rk-dropdown-footer">
              <button type="button" className="rk-dropdown-link" onClick={() => { onReset(); closeDropdown(); }}>
                {labels.reset}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
