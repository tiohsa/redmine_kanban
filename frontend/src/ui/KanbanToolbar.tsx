import React from 'react';
import type { ToolbarViewModel } from './types';
import type { Filters } from './boardFilters';
import type { SortConfig } from './board/sort';
import type { FitMode } from '../model/view/types';
import type { FilterOptionsState } from '../model/board/types';
import type { CardDisplayMode, LaneType } from './useKanbanPreferences';
import { buildToolbarOptions, togglePriorityFilter } from './toolbar/toolbarOptions';
import { SearchPopover } from './toolbar/SearchPopover';
import { SortPopover } from './toolbar/SortPopover';
import { DisplaySettingsPopover, SettingsToggle } from './toolbar/DisplaySettingsPopover';
import { ToolbarDropdown, ToolbarMultiSelect } from './toolbar/ToolbarDropdown';

type ToolbarProps = {
  data: ToolbarViewModel;
  filterOptionsState: FilterOptionsState;
  onRetryFilterOptions: () => void;
  savedViews?: React.ReactNode;
  filters: Filters;
  onChange: (filters: Filters) => void;
  sortConfig: SortConfig;
  onChangeSort: (config: SortConfig) => void;
  fullWindow: boolean;
  onToggleFullWindow: () => void;
  fitMode: FitMode;
  onToggleFitMode: () => void;
  cardDisplayMode: CardDisplayMode;
  onChangeCardDisplayMode: (value: CardDisplayMode) => void;
  showSubtasks: boolean;
  onToggleShowSubtasks: () => void;
  fontSize: number;
  onChangeFontSize: (size: number) => void;
  canCreate: boolean;
  createDisabled?: boolean;
  onCreate: () => void;
  onScrollToTop: () => void;
  timeEntryOnClose: boolean;
  onToggleTimeEntryOnClose: () => void;
  laneType?: LaneType;
  onChangeLaneType?: (value: LaneType) => void;
  agingWarnDays?: number;
  onChangeAgingWarnDays?: (value: number) => void;
  agingDangerDays?: number;
  onChangeAgingDangerDays?: (value: number) => void;
  agingExcludeClosed?: boolean;
  onToggleAgingExcludeClosed?: () => void;
  viewableProjectsEnabled: boolean;
  onToggleViewableProjects: () => void;
  onOpenHelp: () => void;
};

export function KanbanToolbar({
  data,
  filterOptionsState,
  onRetryFilterOptions,
  savedViews,
  filters,
  onChange,
  sortConfig,
  onChangeSort,
  fullWindow,
  onToggleFullWindow,
  fitMode,
  onToggleFitMode,
  cardDisplayMode,
  onChangeCardDisplayMode,
  showSubtasks,
  onToggleShowSubtasks,
  fontSize,
  onChangeFontSize,
  canCreate,
  createDisabled = false,
  onCreate,
  onScrollToTop,
  timeEntryOnClose,
  onToggleTimeEntryOnClose,
  laneType = 'assignee',
  onChangeLaneType = () => {},
  agingWarnDays = 3,
  onChangeAgingWarnDays = () => {},
  agingDangerDays = 7,
  onChangeAgingDangerDays = () => {},
  agingExcludeClosed = true,
  onToggleAgingExcludeClosed = () => {},
  viewableProjectsEnabled,
  onToggleViewableProjects,
  onOpenHelp,
}: ToolbarProps) {
  const labels = data.labels;
  const filterOptions = filterOptionsState.state === 'complete' ? filterOptionsState.options : null;
  const candidatesUnavailable = filterOptionsState.state !== 'complete';
  const candidateMessage = filterOptionsState.state === 'loading' ? (labels.candidate_loading ?? 'Loading filter choices…')
    : filterOptionsState.state === 'incomplete' ? (labels.board_filter_options_incomplete ?? 'Select projects to narrow filter choices.')
      : filterOptionsState.state === 'failed' ? (labels.candidate_unavailable ?? 'Filter choices are temporarily unavailable.') : undefined;
  const updateFilters = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const {
    assigneeOptions,
    dueOptions,
    priorityOptions,
    priorityValue,
    projectOptions,
    statusOptions,
    trackerOptions,
  } = buildToolbarOptions(data, filters, viewableProjectsEnabled, filterOptions);
  const projectFilterValue = filters.projectIds.map(String);
  const statusFilterValue = filters.statusIds.map(String);
  const trackerFilterValue = filters.trackerIds.map(String);
  const showAssigneeDot = filters.assigneeIds.length > 0;
  const showProjectDot = filters.projectIds.length > 0;
  const showStatusDot = filters.statusIds.length > 0;
  const showTrackerDot = filters.trackerIds.length > 0;
  const showDueCustomInput = filters.due === 'custom';
  const dueDaysValue = filters.dueDays ?? 7;
  const fullWindowIcon = fullWindow ? 'fullscreen_exit' : 'fullscreen';
  return (
    <div className="rk-toolbar">
      {canCreate ? (
        <>
          <div className="rk-toolbar-group">
            <button type="button" className="rk-dropdown-trigger" disabled={createDisabled} onClick={onCreate} title={labels.create} aria-label={labels.create}>
              <span className="rk-icon" aria-hidden="true">add</span>
            </button>
          </div>
          <div className="rk-toolbar-separator" />
        </>
      ) : null}

      <div className="rk-toolbar-group">
        <SearchPopover
          label={labels.filter}
          title={labels.filter_task}
          placeholder={labels.filter_subject}
          value={filters.q}
          onChange={(value) => updateFilters({ q: value })}
        />
      </div>

      <div className="rk-toolbar-separator" />

      <div className="rk-toolbar-group">
        <ToolbarMultiSelect
          label={labels.assignee}
          icon="person"
          options={assigneeOptions}
          unavailable={candidatesUnavailable}
          unavailableMessage={candidateMessage}
          onRetryUnavailable={filterOptionsState.state === 'failed' ? onRetryFilterOptions : undefined}
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
        <ToolbarMultiSelect
          label={labels.project}
          icon="folder"
          options={projectOptions}
          value={projectFilterValue}
          onChange={(value) => updateFilters({ projectIds: value.map(Number) })}
          width="440px"
          labels={labels}
          includeAllOption
          allLabel={labels.all}
          searchable
          searchPlaceholder={labels.project_search_placeholder}
          searchEmptyLabel={labels.project_search_no_results}
          showDot={showProjectDot}
          showTriggerLabel
          extraContent={(
            <SettingsToggle
              label={labels.viewable_projects_short}
              checked={viewableProjectsEnabled}
              onChange={onToggleViewableProjects}
            />
          )}
        />
      </div>

      <div className="rk-toolbar-separator" />

      <div className="rk-toolbar-group">
        <ToolbarMultiSelect
          label={labels.issue_tracker}
          icon="label"
          options={trackerOptions}
          unavailable={candidatesUnavailable}
          unavailableMessage={candidateMessage}
          onRetryUnavailable={filterOptionsState.state === 'failed' ? onRetryFilterOptions : undefined}
          value={trackerFilterValue}
          onChange={(value) => updateFilters({ trackerIds: value.map(Number) })}
          onReset={() => updateFilters({ trackerIds: [] })}
          width="200px"
          labels={labels}
          includeAllOption
          allLabel={labels.all}
          showDot={showTrackerDot}
          showTriggerLabel
        />
      </div>

      <div className="rk-toolbar-separator" />

      <div className="rk-toolbar-group">
        <ToolbarMultiSelect
          label={labels.status}
          icon="fact_check"
          options={statusOptions}
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
        <ToolbarMultiSelect
          label={labels.issue_priority}
          icon="priority_high"
          options={priorityOptions}
          unavailable={candidatesUnavailable}
          unavailableMessage={candidateMessage}
          onRetryUnavailable={filterOptionsState.state === 'failed' ? onRetryFilterOptions : undefined}
          value={priorityValue}
          onChange={(value) => {
            updateFilters(togglePriorityFilter(value, priorityOptions.length));
          }}
          width="160px"
          labels={labels}
          includeAllOption
          allLabel={labels.all}
          active={!filters.priorityFilterEnabled || filters.priority.length > 0}
          showDot={!filters.priorityFilterEnabled || filters.priority.length > 0}
          showTriggerLabel
        />

        <ToolbarDropdown
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

        <SortPopover sortConfig={sortConfig} onChangeSort={onChangeSort} labels={labels} />

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

      {savedViews}
      <div className="rk-toolbar-spacer" />

      <div className="rk-toolbar-group">
        <DisplaySettingsPopover
          labels={labels}
          showSubtasks={showSubtasks}
          onToggleShowSubtasks={onToggleShowSubtasks}
          laneType={laneType}
          onChangeLaneType={onChangeLaneType}
          agingWarnDays={agingWarnDays}
          onChangeAgingWarnDays={onChangeAgingWarnDays}
          agingDangerDays={agingDangerDays}
          onChangeAgingDangerDays={onChangeAgingDangerDays}
          agingExcludeClosed={agingExcludeClosed}
          onToggleAgingExcludeClosed={onToggleAgingExcludeClosed}
          timeEntryOnClose={timeEntryOnClose}
          onToggleTimeEntryOnClose={onToggleTimeEntryOnClose}
          fitMode={fitMode}
          onToggleFitMode={onToggleFitMode}
          cardDisplayMode={cardDisplayMode}
          onChangeCardDisplayMode={onChangeCardDisplayMode}
          fontSize={fontSize}
          onChangeFontSize={onChangeFontSize}
        />

        <button type="button" className={`rk-btn ${fullWindow ? 'rk-btn-toggle-active' : ''}`} onClick={onToggleFullWindow} aria-label={fullWindow ? labels.normal_view : labels.fullscreen_view} title={fullWindow ? labels.normal_view : labels.fullscreen_view}>
          <span className="rk-icon">{fullWindowIcon}</span>
          {fullWindow ? <span className="rk-indicator-dot" /> : null}
        </button>

        <button type="button" className="rk-btn" onClick={onScrollToTop} aria-label={labels.scroll_top} title={labels.scroll_top}>
          <span className="rk-icon">vertical_align_top</span>
        </button>

        <button type="button" className="rk-btn" onClick={onOpenHelp} aria-label={labels.help} title={labels.help}>
          <span className="rk-icon">help_outline</span>
        </button>
      </div>
    </div>
  );
}
