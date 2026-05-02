import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { BoardData } from './types';
import type { Filters } from './boardFilters';
import type { SortKey } from './board/sort';
import type { FitMode } from './kanbanShared';

type ToolbarProps = {
  data: BoardData;
  filters: Filters;
  onChange: (filters: Filters) => void;
  sortKey: SortKey;
  onChangeSort: (key: SortKey) => void;
  fullWindow: boolean;
  onToggleFullWindow: () => void;
  fitMode: FitMode;
  onToggleFitMode: () => void;
  showSubtasks: boolean;
  onToggleShowSubtasks: () => void;
  fontSize: number;
  onChangeFontSize: (size: number) => void;
  canCreate: boolean;
  onCreate: () => void;
  onScrollToTop: () => void;
  timeEntryOnClose: boolean;
  onToggleTimeEntryOnClose: () => void;
  priorityLaneEnabled: boolean;
  onTogglePriorityLane: () => void;
  viewableProjectsEnabled: boolean;
  onToggleViewableProjects: () => void;
  onOpenHelp: () => void;
};

const FONT_SIZE_OPTIONS = ['10', '12', '14', '16', '18', '20', '22', '24', '26', '28', '30'] as const;

function buildDropdownTriggerClass(showTriggerLabel: boolean | undefined, isOpen: boolean, isActive: boolean) {
  return `rk-dropdown-trigger ${showTriggerLabel ? 'rk-dropdown-trigger-labeled' : ''} ${isOpen ? 'rk-active' : ''} ${isActive ? 'rk-active-soft' : ''}`;
}

function getSortDirection(sortKey: SortKey, key: 'due' | 'priority' | 'updated'): 'asc' | 'desc' | null {
  if (sortKey === `${key}_asc`) return 'asc';
  if (sortKey === `${key}_desc`) return 'desc';
  return null;
}

function isSortActive(sortKey: SortKey, key: 'due' | 'priority' | 'updated') {
  return sortKey.startsWith(`${key}_`);
}

function useDropdownDismiss(open: boolean, onDismiss: () => void) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        menuRef.current &&
        !menuRef.current.contains(target)
      ) {
        onDismiss();
      }
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onDismiss, open]);

  return { triggerRef, menuRef };
}

function Dropdown<T extends string>({
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
  showTriggerLabel,
}: {
  label: string;
  icon: string;
  options: { id: T; name: string }[];
  value: T;
  onChange: (id: T) => void;
  onReset?: () => void;
  width?: string;
  closeOnSelect?: boolean;
  labels: Record<string, string>;
  showDot?: boolean;
  showTriggerLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { triggerRef, menuRef } = useDropdownDismiss(open, () => setOpen(false));

  const selectedName = options.find((option) => option.id === value)?.name ?? value;
  const triggerClassName = buildDropdownTriggerClass(showTriggerLabel, open, Boolean(showDot));

  return (
    <div className="rk-dropdown-container">
      <div
        ref={triggerRef}
        className={triggerClassName}
        onClick={() => setOpen(!open)}
        title={selectedName}
      >
        <span className="rk-icon">{icon}</span>
        {showTriggerLabel ? <span>{label}</span> : null}
        {showDot ? <span className="rk-indicator-dot" /> : null}
      </div>

      {open ? (
        <div ref={menuRef} className="rk-dropdown-menu" style={{ width }}>
          <div className="rk-dropdown-title">{label}</div>
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {options.map((option) => {
              const checked = option.id === value;
              return (
                <div
                  key={option.id}
                  className={`rk-dropdown-item ${checked ? 'selected' : ''}`}
                  onClick={() => {
                    onChange(option.id);
                    if (closeOnSelect) setOpen(false);
                  }}
                >
                  <div className="rk-dropdown-checkbox" />
                  <span>{option.name}</span>
                </div>
              );
            })}
          </div>
          {onReset ? (
            <div className="rk-dropdown-footer">
              <button
                type="button"
                className="rk-dropdown-link"
                onClick={() => {
                  onReset();
                  setOpen(false);
                }}
              >
                {labels.reset}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MultiSelectDropdown({
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
  showTriggerLabel,
}: {
  label: string;
  icon: string;
  options: { id: string; name: string }[];
  value: string[];
  onChange: (ids: string[]) => void;
  onReset?: () => void;
  width?: string;
  labels: Record<string, string>;
  includeAllOption?: boolean;
  allLabel?: string;
  showDot?: boolean;
  showTriggerLabel?: boolean;
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
  const triggerClassName = buildDropdownTriggerClass(showTriggerLabel, open, Boolean(showDot));
  const triggerLabel = selectedCount > 0 ? `${label} (${selectedCount})` : label;

  return (
    <div className="rk-dropdown-container">
      <div
        ref={triggerRef}
        className={triggerClassName}
        onClick={() => setOpen(!open)}
        title={title}
      >
        <span className="rk-icon">{icon}</span>
        {showTriggerLabel ? <span>{triggerLabel}</span> : null}
        {showDot ? <span className="rk-indicator-dot" /> : null}
      </div>

      {open ? (
        <div ref={menuRef} className="rk-dropdown-menu" style={{ width }}>
          <div className="rk-dropdown-title">{label}</div>
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {includeAllOption ? (
              <div
                key="__all__"
                className={`rk-dropdown-item ${allSelected ? 'selected' : ''}`}
                onClick={() => onChange(allSelected ? [] : optionIds)}
              >
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
                  onClick={() => {
                    if (checked) onChange(value.filter((selected) => selected !== option.id));
                    else onChange([...value, option.id]);
                  }}
                >
                  <div className="rk-dropdown-checkbox" />
                  <span>{option.name}</span>
                </div>
              );
            })}
          </div>
          {onReset ? (
            <div className="rk-dropdown-footer">
              <button
                type="button"
                className="rk-dropdown-link"
                onClick={() => {
                  onReset();
                  setOpen(false);
                }}
              >
                {labels.reset}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SearchDropdown({
  label,
  title,
  placeholder,
  value,
  onChange,
  showTriggerLabel,
}: {
  label: string;
  title: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  showTriggerLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { triggerRef, menuRef } = useDropdownDismiss(open, () => setOpen(false));
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerClassName = buildDropdownTriggerClass(showTriggerLabel, open, Boolean(value));

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
        const target = event.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        event.preventDefault();
        setOpen(true);
      }

      if (event.key === 'Escape' && open) {
        onChange('');
        setOpen(false);
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onChange, open]);

  return (
    <div className="rk-dropdown-container">
      <div
        ref={triggerRef}
        className={triggerClassName}
        onClick={() => setOpen(!open)}
        title={label}
      >
        <span className="rk-icon">filter_list</span>
        {showTriggerLabel ? <span>{label}</span> : null}
        {value ? <span className="rk-indicator-dot" /> : null}
      </div>

      {open ? (
        <div ref={menuRef} className="rk-dropdown-menu" style={{ width: '300px' }}>
          <div className="rk-dropdown-title">{title}</div>
          <div style={{ padding: '12px' }}>
            <div className="rk-search-box">
              <span className="rk-icon">search</span>
              <input
                ref={inputRef}
                autoFocus
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
              />
              {value ? (
                <button
                  type="button"
                  className="rk-search-clear"
                  aria-label={label}
                  onClick={() => {
                    onChange('');
                    inputRef.current?.focus();
                  }}
                >
                  <span className="rk-icon">close</span>
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SortButton({
  active,
  direction,
  label,
  icon,
  onClick,
  labels,
}: {
  active: boolean;
  direction: 'asc' | 'desc' | null;
  label: string;
  icon: string;
  onClick: () => void;
  labels: Record<string, string>;
}) {
  return (
    <button type="button" className={`rk-btn rk-btn-labeled ${active ? 'rk-btn-toggle-active' : ''}`} onClick={onClick} title={(labels?.sort_by || '') + label}>
      <span className="rk-icon" style={{ fontSize: '18px' }}>{icon}</span>
      <span className="rk-btn-label">{label}</span>
      {active ? <span className="rk-indicator-dot" /> : null}
    </button>
  );
}

export function KanbanToolbar({
  data,
  filters,
  onChange,
  sortKey,
  onChangeSort,
  fullWindow,
  onToggleFullWindow,
  fitMode,
  onToggleFitMode,
  showSubtasks,
  onToggleShowSubtasks,
  fontSize,
  onChangeFontSize,
  canCreate,
  onCreate,
  onScrollToTop,
  timeEntryOnClose,
  onToggleTimeEntryOnClose,
  priorityLaneEnabled,
  onTogglePriorityLane,
  viewableProjectsEnabled,
  onToggleViewableProjects,
  onOpenHelp,
}: ToolbarProps) {
  const assignees = data.lists.assignees ?? [];
  const labels = data.labels;
  const projectOptions = (viewableProjectsEnabled ? data.lists.viewable_projects : data.lists.projects) ?? [];
  const updateFilters = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const assigneeOptions = [
    { id: 'unassigned', name: labels.unassigned },
    ...assignees.filter((assignee) => assignee.id !== null).map((assignee) => ({ id: String(assignee.id), name: assignee.name })),
  ];
  const dueOptions = [
    { id: 'all', name: labels.all },
    { id: 'overdue', name: labels.overdue },
    { id: 'thisweek', name: labels.this_week },
    { id: '3days', name: labels.within_3_days },
    { id: '7days', name: labels.within_1_week },
    { id: '1day', name: labels.within_1_day },
    { id: 'custom', name: labels.within_specified_days },
    { id: 'none', name: labels.not_set },
  ];
  const priorityOptions = [
    ...(data.lists.priorities ?? []).map((priority) => ({ id: String(priority.id), name: priority.name })),
    { id: 'no_priority', name: labels.not_set },
  ];
  const priorityValue = filters.priorityFilterEnabled ? filters.priority : priorityOptions.map((option) => option.id);
  const projectDropdownOptions = projectOptions.map((project) => ({
    id: String(project.id),
    name: '\xA0'.repeat(project.level * 2) + project.name,
  }));
  const statusDropdownOptions = data.columns.map((column) => ({ id: String(column.id), name: column.name }));
  const projectFilterValue = filters.projectIds.map(String);
  const statusFilterValue = filters.statusIds.map(String);
  const showAssigneeDot = filters.assigneeIds.length > 0;
  const showProjectDot = filters.projectIds.length > 0;
  const showStatusDot = filters.statusIds.length > 0;
  const showDueCustomInput = filters.due === 'custom';
  const dueDaysValue = filters.dueDays ?? 7;
  const dueSortDirection = getSortDirection(sortKey, 'due');
  const prioritySortDirection = getSortDirection(sortKey, 'priority');
  const updatedSortDirection = getSortDirection(sortKey, 'updated');
  const dueSortNext: SortKey = sortKey === 'due_asc' ? 'due_desc' : 'due_asc';
  const prioritySortNext: SortKey = sortKey === 'priority_desc' ? 'priority_asc' : 'priority_desc';
  const fitModeActive = fitMode !== 'none';
  const fitModeTitle = fitMode === 'none' ? labels.fit_none : fitMode === 'width' ? labels.fit_width : labels.fit_all;
  const fitModeIcon = fitMode === 'none' ? 'zoom_in' : 'fit_screen';
  const showSubtasksIcon = showSubtasks ? 'check_box' : 'check_box_outline_blank';
  const fullWindowIcon = fullWindow ? 'fullscreen_exit' : 'fullscreen';
  const fontSizeLabel = `${fontSize}px`;
  const fontSizeOptions = FONT_SIZE_OPTIONS.map((value) => ({ id: value, name: `${value}px` }));

  return (
    <div className="rk-toolbar">
      {canCreate ? (
        <>
          <div className="rk-toolbar-group">
            <div className="rk-dropdown-trigger" onClick={onCreate} title={labels.create} role="button">
              <span className="rk-icon">add</span>
            </div>
          </div>
          <div className="rk-toolbar-separator" />
        </>
      ) : null}

      <div className="rk-toolbar-group">
        <SearchDropdown
          label={labels.filter}
          title={labels.filter_task}
          placeholder={labels.filter_subject}
          value={filters.q}
          onChange={(value) => updateFilters({ q: value })}
          showTriggerLabel
        />
      </div>

      <div className="rk-toolbar-separator" />

      <div className="rk-toolbar-group">
        <MultiSelectDropdown
          label={labels.assignee}
          icon="person"
          options={assigneeOptions}
          value={filters.assigneeIds}
          onChange={(value) => updateFilters({ assigneeIds: value })}
          onReset={() => updateFilters({ assigneeIds: [] })}
          labels={labels}
          includeAllOption
          allLabel={labels.all}
          showDot={showAssigneeDot}
          showTriggerLabel
        />
      </div>

      <div className="rk-toolbar-separator" />

      <div className="rk-toolbar-group">
        <MultiSelectDropdown
          label={labels.project}
          icon="folder"
          options={projectDropdownOptions}
          value={projectFilterValue}
          onChange={(value) => updateFilters({ projectIds: value.map(Number) })}
          width="280px"
          labels={labels}
          includeAllOption
          allLabel={labels.all}
          showDot={showProjectDot}
          showTriggerLabel
        />
      </div>

      <div className="rk-toolbar-separator" />

      <div className="rk-toolbar-group">
        <MultiSelectDropdown
          label={labels.status}
          icon="fact_check"
          options={statusDropdownOptions}
          value={statusFilterValue}
          onChange={(value) => updateFilters({ statusIds: value.map(Number) })}
          width="200px"
          labels={labels}
          includeAllOption
          allLabel={labels.all}
          showDot={showStatusDot}
          showTriggerLabel
        />
      </div>

      <div className="rk-toolbar-separator" />

      <div className="rk-toolbar-group">
        <MultiSelectDropdown
          label={labels.issue_priority}
          icon="priority_high"
          options={priorityOptions}
          value={priorityValue}
          onChange={(value) => {
            const enabled = value.length !== priorityOptions.length;
            updateFilters({ priority: enabled ? value : [], priorityFilterEnabled: enabled });
          }}
          width="160px"
          labels={labels}
          includeAllOption
          allLabel={labels.all}
          showDot={filters.priorityFilterEnabled}
          showTriggerLabel
        />

        <Dropdown
          label={labels.due}
          icon="calendar_month"
          options={dueOptions}
          value={filters.due}
          onChange={(value) => updateFilters({ due: value as Filters['due'] })}
          onReset={() => updateFilters({ due: 'all' })}
          width="180px"
          closeOnSelect={false}
          labels={labels}
          showDot={filters.due !== 'all'}
          showTriggerLabel
        />

        {showDueCustomInput ? (
          <input
            type="number"
            min="1"
            className="rk-input"
            style={{ width: '60px', marginLeft: '6px', height: '32px', padding: '0 8px' }}
            value={dueDaysValue}
            onChange={(event) => {
              const value = parseInt(event.target.value, 10);
              if (!Number.isNaN(value) && value > 0) updateFilters({ dueDays: value });
            }}
          />
        ) : null}
      </div>

      <div className="rk-toolbar-separator" />

      <div className="rk-toolbar-group rk-sort">
        <SortButton
          active={isSortActive(sortKey, 'due')}
          direction={dueSortDirection}
          label={labels.issue_due_date}
          icon="event"
          onClick={() => onChangeSort(dueSortNext)}
          labels={labels}
        />
        <SortButton
          active={isSortActive(sortKey, 'priority')}
          direction={prioritySortDirection}
          label={labels.issue_priority}
          icon="sort"
          onClick={() => onChangeSort(prioritySortNext)}
          labels={labels}
        />
        <SortButton
          active={isSortActive(sortKey, 'updated')}
          direction={updatedSortDirection}
          label={labels.updated}
          icon="update"
          onClick={() => onChangeSort('updated_asc')}
          labels={labels}
        />
      </div>

      <div className="rk-toolbar-spacer" />

      <div className="rk-toolbar-group">
        <button
          type="button"
          className={`rk-btn ${priorityLaneEnabled ? 'rk-btn-toggle-active' : ''}`}
          onClick={onTogglePriorityLane}
          title={priorityLaneEnabled ? labels.hide_priority_lanes : labels.show_priority_lanes}
        >
          <span className="rk-icon">view_stream</span>
          {priorityLaneEnabled ? <span className="rk-indicator-dot" /> : null}
        </button>

        <button
          type="button"
          className={`rk-btn ${timeEntryOnClose ? 'rk-btn-toggle-active' : ''}`}
          onClick={onToggleTimeEntryOnClose}
          title={timeEntryOnClose ? labels.disable_time_entry_on_close : labels.enable_time_entry_on_close}
        >
          <span className="rk-icon">schedule</span>
          {timeEntryOnClose ? <span className="rk-indicator-dot" /> : null}
        </button>

        <button
          type="button"
          className={`rk-btn ${viewableProjectsEnabled ? 'rk-btn-toggle-active' : ''}`}
          onClick={onToggleViewableProjects}
          title={viewableProjectsEnabled ? labels.hide_viewable_projects : labels.show_viewable_projects}
        >
          <span className="rk-icon">folder_shared</span>
          {viewableProjectsEnabled ? <span className="rk-indicator-dot" /> : null}
        </button>

        <button
          type="button"
          className={`rk-btn ${fitModeActive ? 'rk-btn-toggle-active' : ''}`}
          onClick={onToggleFitMode}
          title={fitModeTitle}
        >
          <span className="rk-icon">{fitModeIcon}</span>
          {fitModeActive ? <span className="rk-indicator-dot" /> : null}
        </button>

        <button
          type="button"
          className={`rk-btn ${showSubtasks ? 'rk-btn-toggle-active' : ''}`}
          onClick={onToggleShowSubtasks}
          title={showSubtasks ? labels.hide_subtasks : labels.show_subtasks}
        >
          <span className="rk-icon">{showSubtasksIcon}</span>
          {showSubtasks ? <span className="rk-indicator-dot" /> : null}
        </button>

        <button type="button" className={`rk-btn ${fullWindow ? 'rk-btn-toggle-active' : ''}`} onClick={onToggleFullWindow} title={fullWindow ? labels.normal_view : labels.fullscreen_view}>
          <span className="rk-icon">{fullWindowIcon}</span>
          {fullWindow ? <span className="rk-indicator-dot" /> : null}
        </button>

        <button type="button" className="rk-btn" onClick={onScrollToTop} title={labels.scroll_top}>
          <span className="rk-icon">vertical_align_top</span>
        </button>

        <Dropdown
          label={fontSizeLabel}
          icon="format_size"
          options={fontSizeOptions}
          value={String(fontSize)}
          onChange={(value) => onChangeFontSize(Number(value))}
          width="100px"
          closeOnSelect={false}
          labels={labels}
        />

        <button type="button" className="rk-btn" onClick={onOpenHelp} title={labels.help}>
          <span className="rk-icon">help_outline</span>
        </button>
      </div>
    </div>
  );
}
