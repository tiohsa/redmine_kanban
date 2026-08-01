import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { SortKey } from './board/sort';
import type { Filters } from './boardFilters';
import { buildProjectScopeFromDataUrl, makeScopedStorageKey, readScopedBooleanWithLegacy, readScopedNumberSetWithLegacy, readScopedValueWithLegacy } from './utils/storage';
import type { FitMode } from './kanbanShared';

export type LaneType = 'none' | 'assignee' | 'priority';

const DEFAULT_FILTERS: Filters = {
  assigneeIds: [],
  q: '',
  due: 'all',
  priority: [],
  priorityFilterEnabled: false,
  projectIds: [],
  statusIds: [],
  trackerIds: [],
};

function readStorageValue(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageValue(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function removeStorageValue(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function readFilters(storageKey: string | null, legacyKey?: string): Filters {
  try {
    const value = storageKey && legacyKey ? readScopedValueWithLegacy(storageKey, legacyKey) : null;
    if (value) {
      const parsed = JSON.parse(value);
      return {
        assigneeIds: Array.isArray(parsed.assigneeIds) ? parsed.assigneeIds.map(String) : [],
        q: parsed.q || '',
        due: parsed.due || 'all',
        dueDays: parsed.dueDays || 7,
        priority: Array.isArray(parsed.priority) ? parsed.priority : [],
        priorityFilterEnabled:
          typeof parsed.priorityFilterEnabled === 'boolean'
            ? parsed.priorityFilterEnabled
            : Array.isArray(parsed.priority) && parsed.priority.length > 0,
        projectIds: Array.isArray(parsed.projectIds) ? parsed.projectIds.map(Number) : [],
        statusIds: Array.isArray(parsed.statusIds) ? parsed.statusIds.map(Number) : [],
        trackerIds: Array.isArray(parsed.trackerIds) ? parsed.trackerIds.map(Number) : [],
      };
    }
  } catch {
    // ignore
  }
  return DEFAULT_FILTERS;
}

export function useKanbanPreferences(dataUrl: string) {
  const projectScope = useMemo(() => buildProjectScopeFromDataUrl(dataUrl), [dataUrl]);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const userScope = currentUserId === null ? null : `user:${currentUserId}`;
  const projectKey = useMemo(() => (baseKey: string) => userScope ? makeScopedStorageKey(baseKey, `${projectScope}:${userScope}`) : null, [projectScope, userScope]);
  const userKey = useMemo(() => (baseKey: string) => userScope ? makeScopedStorageKey(baseKey, userScope) : null, [userScope]);
  const filtersStorageKey = projectKey('rk_filters');
  const hiddenStatusStorageKey = projectKey('rk_hidden_status_ids');
  const priorityLaneStorageKey = projectKey('rk_priority_lane_enabled');
  const laneTypeStorageKey = projectKey('rk_lane_type');
  const agingWarnDaysStorageKey = projectKey('rk_aging_warn_days');
  const agingDangerDaysStorageKey = projectKey('rk_aging_danger_days');
  const agingExcludeClosedStorageKey = projectKey('rk_aging_exclude_closed');
  const viewableProjectsStorageKey = projectKey('rk_viewable_projects_enabled');
  const fullWindowStorageKey = userKey('rk_fullwindow');
  const fitModeStorageKey = userKey('rk_fit_mode');
  const showSubtasksStorageKey = userKey('rk_show_subtasks');
  const sortKeyStorageKey = userKey('rk_sortkey');
  const fontSizeStorageKey = userKey('rk_font_size');
  const timeEntryStorageKey = userKey('rk_time_entry_on_close');

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [fullWindow, setFullWindow] = useState(false);
  const [fitMode, setFitMode] = useState<FitMode>('none');
  const [showSubtasks, setShowSubtasks] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('updated_desc');
  const [hiddenStatusIds, setHiddenStatusIds] = useState<Set<number>>(new Set());
  const [fontSize, setFontSize] = useState(13);
  const [timeEntryOnClose, setTimeEntryOnClose] = useState(false);
  const [laneType, setLaneType] = useState<LaneType>('assignee');
  const [agingWarnDays, setAgingWarnDays] = useState(3);
  const [agingDangerDays, setAgingDangerDays] = useState(7);
  const [agingExcludeClosed, setAgingExcludeClosed] = useState(true);
  const [viewableProjectsEnabled, setViewableProjectsEnabled] = useState(false);

  useLayoutEffect(() => {
    if (!userScope) return;
    setFilters(readFilters(filtersStorageKey, makeScopedStorageKey('rk_filters', projectScope)));
    setFullWindow(readScopedValueWithLegacy(fullWindowStorageKey!, 'rk_fullwindow') === '1');
    const fitMode = readScopedValueWithLegacy(fitModeStorageKey!, 'rk_fit_mode');
    const legacyFitToScreen = readStorageValue('rk_fit_to_screen');
    if (fitMode === null && legacyFitToScreen === '1') {
      writeStorageValue(fitModeStorageKey!, 'width');
      removeStorageValue('rk_fit_to_screen');
    }
    setFitMode(fitMode === 'width' || (fitMode === null && legacyFitToScreen === '1') ? 'width' : 'none');
    setShowSubtasks(readScopedValueWithLegacy(showSubtasksStorageKey!, 'rk_show_subtasks') !== '0');
    const sortKey = readScopedValueWithLegacy(sortKeyStorageKey!, 'rk_sortkey');
    setSortKey(sortKey === 'updated_asc' || sortKey === 'due_asc' || sortKey === 'due_desc' || sortKey === 'priority_desc' || sortKey === 'priority_asc' ? sortKey : 'updated_desc');
    setHiddenStatusIds(readScopedNumberSetWithLegacy(hiddenStatusStorageKey!, makeScopedStorageKey('rk_hidden_status_ids', projectScope), new Set()));
    setFontSize(Number(readScopedValueWithLegacy(fontSizeStorageKey!, 'rk_font_size')) || 13);
    setTimeEntryOnClose(readScopedValueWithLegacy(timeEntryStorageKey!, 'rk_time_entry_on_close') === '1');
    const laneType = readStorageValue(laneTypeStorageKey!);
    const legacyLaneTypeStorageKey = makeScopedStorageKey('rk_lane_type', projectScope);
    const legacyLaneType = laneType === null ? readStorageValue(legacyLaneTypeStorageKey) : null;
    const resolvedLaneType = laneType ?? legacyLaneType;
    setLaneType(
      resolvedLaneType === 'none' || resolvedLaneType === 'priority' || resolvedLaneType === 'assignee'
        ? resolvedLaneType
        : readScopedBooleanWithLegacy(
            priorityLaneStorageKey!,
            makeScopedStorageKey('rk_priority_lane_enabled', projectScope),
            false,
          )
          ? 'priority'
          : 'assignee',
    );
    if (laneType === null && legacyLaneType !== null) {
      // The project-scoped value belonged to the first user upgrading from the
      // legacy version. Consume it so a later Redmine user does not inherit it.
      removeStorageValue(legacyLaneTypeStorageKey);
    }
    const warnDays = Math.max(0, Number(readScopedValueWithLegacy(agingWarnDaysStorageKey!, makeScopedStorageKey('rk_aging_warn_days', projectScope))) || 3);
    setAgingWarnDays(warnDays);
    setAgingDangerDays(Math.max(warnDays, Number(readScopedValueWithLegacy(agingDangerDaysStorageKey!, makeScopedStorageKey('rk_aging_danger_days', projectScope))) || 7));
    setAgingExcludeClosed(readScopedBooleanWithLegacy(agingExcludeClosedStorageKey!, makeScopedStorageKey('rk_aging_exclude_closed', projectScope), true));
    setViewableProjectsEnabled(readScopedBooleanWithLegacy(viewableProjectsStorageKey!, makeScopedStorageKey('rk_viewable_projects_enabled', projectScope), false));
  }, [agingDangerDaysStorageKey, agingExcludeClosedStorageKey, agingWarnDaysStorageKey, filtersStorageKey, fitModeStorageKey, fontSizeStorageKey, fullWindowStorageKey, hiddenStatusStorageKey, laneTypeStorageKey, priorityLaneStorageKey, projectScope, showSubtasksStorageKey, sortKeyStorageKey, timeEntryStorageKey, userScope, viewableProjectsStorageKey]);

  useEffect(() => {
    const className = 'rk-kanban-fullwindow';
    if (fullWindow) {
      document.body.classList.add(className);
    } else {
      document.body.classList.remove(className);
    }

    if (fullWindowStorageKey) writeStorageValue(fullWindowStorageKey, fullWindow ? '1' : '0');

    return () => {
      document.body.classList.remove(className);
    };
  }, [fullWindow, fullWindowStorageKey]);

  useEffect(() => {
    if (fitModeStorageKey) writeStorageValue(fitModeStorageKey, fitMode);
  }, [fitMode, fitModeStorageKey]);

  useEffect(() => {
    if (sortKeyStorageKey) writeStorageValue(sortKeyStorageKey, sortKey);
  }, [sortKey, sortKeyStorageKey]);

  useEffect(() => {
    if (filtersStorageKey) writeStorageValue(filtersStorageKey, JSON.stringify(filters));
  }, [filters, filtersStorageKey]);

  useEffect(() => {
    if (hiddenStatusStorageKey) writeStorageValue(hiddenStatusStorageKey, JSON.stringify(Array.from(hiddenStatusIds)));
  }, [hiddenStatusIds, hiddenStatusStorageKey]);

  useEffect(() => {
    if (showSubtasksStorageKey) writeStorageValue(showSubtasksStorageKey, showSubtasks ? '1' : '0');
  }, [showSubtasks, showSubtasksStorageKey]);

  useEffect(() => {
    if (fontSizeStorageKey) writeStorageValue(fontSizeStorageKey, String(fontSize));
  }, [fontSize, fontSizeStorageKey]);

  useEffect(() => {
    if (timeEntryStorageKey) writeStorageValue(timeEntryStorageKey, timeEntryOnClose ? '1' : '0');
  }, [timeEntryOnClose, timeEntryStorageKey]);

  useEffect(() => {
    if (laneTypeStorageKey) writeStorageValue(laneTypeStorageKey, laneType);
  }, [laneType, laneTypeStorageKey]);

  useEffect(() => {
    if (agingWarnDaysStorageKey) writeStorageValue(agingWarnDaysStorageKey, String(agingWarnDays));
  }, [agingWarnDays, agingWarnDaysStorageKey]);

  useEffect(() => {
    if (agingDangerDaysStorageKey) writeStorageValue(agingDangerDaysStorageKey, String(agingDangerDays));
  }, [agingDangerDays, agingDangerDaysStorageKey]);

  useEffect(() => {
    if (agingExcludeClosedStorageKey) writeStorageValue(agingExcludeClosedStorageKey, agingExcludeClosed ? '1' : '0');
  }, [agingExcludeClosed, agingExcludeClosedStorageKey]);

  useEffect(() => {
    if (viewableProjectsStorageKey) writeStorageValue(viewableProjectsStorageKey, viewableProjectsEnabled ? '1' : '0');
  }, [viewableProjectsEnabled, viewableProjectsStorageKey]);

  return {
    projectScope,
    setCurrentUserId,
    filters,
    setFilters,
    fullWindow,
    setFullWindow,
    fitMode,
    setFitMode,
    showSubtasks,
    setShowSubtasks,
    sortKey,
    setSortKey,
    hiddenStatusIds,
    setHiddenStatusIds,
    fontSize,
    setFontSize,
    timeEntryOnClose,
    setTimeEntryOnClose,
    laneType,
    setLaneType,
    agingWarnDays,
    setAgingWarnDays,
    agingDangerDays,
    setAgingDangerDays,
    agingExcludeClosed,
    setAgingExcludeClosed,
    viewableProjectsEnabled,
    setViewableProjectsEnabled,
  };
}
