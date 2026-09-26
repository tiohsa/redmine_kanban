import { useState } from 'react';
import type { SortConfig, SortCriterion } from '../board/sort';
import { useDropdownDismiss } from './useDropdownDismiss';

export function SortPopover({ sortConfig, onChangeSort, labels }: {
  sortConfig: SortConfig;
  onChangeSort: (config: SortConfig) => void;
  labels: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const { triggerRef, menuRef, menuId } = useDropdownDismiss(open, () => setOpen(false));
  const options: { field: SortCriterion['field']; label: string }[] = [
    { field: 'due', label: labels.issue_due_date },
    { field: 'priority', label: labels.issue_priority },
    { field: 'updated', label: labels.updated },
  ];
  const nextOption = options.find((option) => !sortConfig.some((criterion) => criterion.field === option.field));
  const canAdd = sortConfig.length < 3 && nextOption !== undefined;
  const updateCriterion = (index: number, patch: Partial<SortCriterion>) => {
    onChangeSort(sortConfig.map((criterion, criterionIndex) => criterionIndex === index ? { ...criterion, ...patch } : criterion));
  };
  const title = labels.sort;

  return (
    <div className="rk-dropdown-container">
      <button type="button" ref={triggerRef} aria-label={title} aria-expanded={open} aria-controls={open ? menuId : undefined} aria-haspopup="dialog" className={`rk-btn rk-btn-labeled ${open || sortConfig.length > 0 ? 'rk-btn-toggle-active' : ''}`} onClick={() => setOpen(!open)} title={title}>
        <span className="rk-icon">sort</span>
        <span className="rk-btn-label">{title}</span>
        {sortConfig.length > 0 ? <span className="rk-indicator-dot" aria-hidden="true" /> : null}
      </button>
      {open ? (
        <div id={menuId} ref={menuRef} className="rk-sort-menu" role="dialog" aria-label={title}>
          <div className="rk-settings-title">{title}</div>
          {sortConfig.map((criterion, index) => {
            const availableOptions = options.filter((option) => !sortConfig.some((other, otherIndex) => otherIndex !== index && other.field === option.field));
            const label = options.find((option) => option.field === criterion.field)?.label;
            const direction = criterion.direction === 'asc' ? '↑' : '↓';
            return (
              <div key={index} className="rk-settings-select-row" role="group" aria-label={`${title} ${index + 1}`} style={{ gap: 4, padding: '8px 4px' }}>
                <span aria-hidden="true">{index + 1}.</span>
                <select value={criterion.field} aria-label={`${title} ${index + 1}`} style={{ flex: 1, minWidth: 0 }} onChange={(event) => {
                  const option = availableOptions.find((item) => item.field === event.target.value);
                  if (option) updateCriterion(index, { field: option.field });
                }}>
                  {availableOptions.map((option) => <option key={option.field} value={option.field}>{option.label}</option>)}
                </select>
                <button type="button" className="rk-btn rk-btn-sm rk-sort-direction" aria-label={`${title} ${index + 1}: ${label} ${direction}`} title={`${label} ${direction}`} onClick={() => {
                  updateCriterion(index, { direction: criterion.direction === 'asc' ? 'desc' : 'asc' });
                }}>{direction}</button>
                <button type="button" className="rk-btn rk-btn-sm" aria-label={`${labels.delete}: ${title} ${index + 1}`} title={labels.delete} disabled={sortConfig.length <= 1} onClick={() => {
                  if (sortConfig.length <= 1) return;
                  menuRef.current?.querySelectorAll('select')[Math.min(index, sortConfig.length - 2)]?.focus();
                  onChangeSort(sortConfig.filter((_, criterionIndex) => criterionIndex !== index));
                }}>×</button>
              </div>
            );
          })}
          <button type="button" className="rk-sort-row" disabled={!canAdd} onClick={() => {
            if (canAdd && nextOption) onChangeSort([...sortConfig, { field: nextOption.field, direction: 'asc' }]);
          }}>{labels.add}</button>
          <button type="button" className="rk-sort-row" onClick={() => onChangeSort([{ field: 'updated', direction: 'desc' }])}>{labels.reset}</button>
        </div>
      ) : null}
    </div>
  );
}
