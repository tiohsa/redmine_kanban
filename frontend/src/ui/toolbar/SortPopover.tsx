import { useState } from 'react';
import type { SortKey } from '../board/sort';
import { useDropdownDismiss } from './useDropdownDismiss';

export function SortPopover({ sortKey, onChangeSort, labels }: {
  sortKey: SortKey;
  onChangeSort: (key: SortKey) => void;
  labels: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const { triggerRef, menuRef } = useDropdownDismiss(open, () => setOpen(false));
  const options: { key: 'due' | 'priority' | 'updated'; label: string; asc: SortKey; desc: SortKey }[] = [
    { key: 'due', label: labels.issue_due_date ?? 'Due date', asc: 'due_asc', desc: 'due_desc' },
    { key: 'priority', label: labels.issue_priority ?? 'Priority', asc: 'priority_asc', desc: 'priority_desc' },
    { key: 'updated', label: labels.updated ?? 'Updated', asc: 'updated_asc', desc: 'updated_desc' },
  ];
  const active = options.find((option) => sortKey === option.asc || sortKey === option.desc);
  const title = labels.sort ?? labels.sort_by ?? 'Sort';

  return (
    <div className="rk-dropdown-container">
      <div ref={triggerRef} className={`rk-btn rk-btn-labeled ${open || active ? 'rk-btn-toggle-active' : ''}`} onClick={() => setOpen(!open)} title={title} aria-expanded={open} role="button" tabIndex={0}>
        <span className="rk-icon">sort</span>
        <span className="rk-btn-label">{title}</span>
      </div>
      {open ? (
        <div ref={menuRef} className="rk-sort-menu" role="menu" aria-label={title}>
          <div className="rk-settings-title">{title}</div>
          {options.map((option) => {
            const selected = active?.key === option.key;
            const next = selected && sortKey === option.asc ? option.desc : option.asc;
            return (
              <button key={option.key} type="button" className={`rk-sort-row ${selected ? 'rk-sort-row-selected' : ''}`} onClick={() => onChangeSort(next)} role="menuitem">
                <span>{option.label}</span>
                {selected ? <span className="rk-sort-direction">{sortKey === option.asc ? '↑' : '↓'}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
