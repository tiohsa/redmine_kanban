import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { SortKey } from './board/sort';
import type { Filters } from './boardFilters';
import { buildProjectScopeFromDataUrl, makeScopedStorageKey, readScopedBooleanWithLegacy, readScopedNumberSetWithLegacy, readScopedValueWithLegacy } from './utils/storage';
import type { FitMode } from './kanbanShared';

export type LaneType = 'none' | 'assignee' | 'priority';
export const DEFAULT_MAXIMUM_BOARD_ENTITY_COUNT = 1500;
export const MAXIMUM_BOARD_ENTITY_COUNT = 2_147_483_647;

export function parseMaximumBoardEntityCount(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return DEFAULT_MAXIMUM_BOARD_ENTITY_COUNT;
  const raw = String(value).trim();
  if (raw === '') return DEFAULT_MAXIMUM_BOARD_ENTITY_COUNT;
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAXIMUM_BOARD_ENTITY_COUNT) return null;
  return parsed;
}

export function normalizeMaximumBoardEntityCount(value: string | number | null | undefined): number {
  return parseMaximumBoardEntityCount(value) ?? DEFAULT_MAXIMUM_BOARD_ENTITY_COUNT;
}

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

export function useKanbanPreferences(dataUrl: string, initialCurrentUserId?: number) {
  const projectScope = useMemo(() => buildProjectScopeFromDataUrl(dataUrl), [dataUrl]);
  const [currentUserId, setCurrentUserId] = useState<number | null>(initialCurrentUserId ?? null);
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
  const maximumBoardEntityCountStorageKey = projectKey('rk_maximum_board_entity_count');
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
  const [maximumBoardEntityCount, setMaximumBoardEntityCount] = useState(DEFAULT_MAXIMUM_BOARD_ENTITY_COUNT);
  const [hydratedScope, setHydratedScope] = useState<string | null>(null);
  const preferencesReady = userScope !== null && hydratedScope === userScope;

  useLayoutEffect(() => {
    if (!userScope) return;
    setFilters(readFilters(filtersStorageKey, makeScopedStorageKey('rk_filters', projectScope)));
    setFullWindow(readScopedValueWithLegacy(fullWindowStorageKey!, 'rk_fullwindow') === '1');
    const fitMode = readScopedValueWithLegacy(fitModeStorageKey!, 'rk_fit_mode');
    const legacyFitToScreen = readStorageValue('rk_fit_to_screen');
    if (fitMode === null && legacyFitToScreen === '1') {
      // The gated persistence effects perform the migration write after hydration.
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
    const warnDays = Math.max(0, Number(readScopedValueWithLegacy(agingWarnDaysStorageKey!, makeScopedStorageKey('rk_aging_warn_days', projectScope))) || 3);
    setAgingWarnDays(warnDays);
    setAgingDangerDays(Math.max(warnDays, Number(readScopedValueWithLegacy(agingDangerDaysStorageKey!, makeScopedStorageKey('rk_aging_danger_days', projectScope))) || 7));
    setAgingExcludeClosed(readScopedBooleanWithLegacy(agingExcludeClosedStorageKey!, makeScopedStorageKey('rk_aging_exclude_closed', projectScope), true));
    setViewableProjectsEnabled(readScopedBooleanWithLegacy(viewableProjectsStorageKey!, makeScopedStorageKey('rk_viewable_projects_enabled', projectScope), false));
    setMaximumBoardEntityCount(normalizeMaximumBoardEntityCount(readStorageValue(maximumBoardEntityCountStorageKey!)));
    setHydratedScope(userScope);
  }, [agingDangerDaysStorageKey, agingExcludeClosedStorageKey, agingWarnDaysStorageKey, filtersStorageKey, fitModeStorageKey, fontSizeStorageKey, fullWindowStorageKey, hiddenStatusStorageKey, laneTypeStorageKey, maximumBoardEntityCountStorageKey, priorityLaneStorageKey, projectScope, showSubtasksStorageKey, sortKeyStorageKey, timeEntryStorageKey, userScope, viewableProjectsStorageKey]);

  useEffect(() => {
    if (!preferencesReady) return;
    const legacyFitKey = 'rk_fit_to_screen';
    if (readStorageValue(legacyFitKey) === '1') removeStorageValue(legacyFitKey);
    const legacyLaneKey = makeScopedStorageKey('rk_lane_type', projectScope);
    if (readStorageValue(legacyLaneKey) !== null && laneTypeStorageKey && readStorageValue(laneTypeStorageKey) === null) removeStorageValue(legacyLaneKey);
  }, [laneTypeStorageKey, preferencesReady, projectScope]);

  useEffect(() => {
    const className = 'rk-kanban-fullwindow';
    if (fullWindow) {
      document.body.classList.add(className);
    } else {
      document.body.classList.remove(className);
    }

    if (preferencesReady && fullWindowStorageKey) writeStorageValue(fullWindowStorageKey, fullWindow ? '1' : '0');

    return () => {
      document.body.classList.remove(className);
    };
  }, [fullWindow, fullWindowStorageKey, preferencesReady]);

  useEffect(() => {
    if (preferencesReady && fitModeStorageKey) writeStorageValue(fitModeStorageKey, fitMode);
  }, [fitMode, fitModeStorageKey, preferencesReady]);

  useEffect(() => {
    if (preferencesReady && sortKeyStorageKey) writeStorageValue(sortKeyStorageKey, sortKey);
  }, [preferencesReady, sortKey, sortKeyStorageKey]);

  useEffect(() => {
    if (preferencesReady && filtersStorageKey) writeStorageValue(filtersStorageKey, JSON.stringify(filters));
  }, [filters, filtersStorageKey, preferencesReady]);

  useEffect(() => {
    if (preferencesReady && hiddenStatusStorageKey) writeStorageValue(hiddenStatusStorageKey, JSON.stringify(Array.from(hiddenStatusIds)));
  }, [hiddenStatusIds, hiddenStatusStorageKey, preferencesReady]);

  useEffect(() => {
    if (preferencesReady && showSubtasksStorageKey) writeStorageValue(showSubtasksStorageKey, showSubtasks ? '1' : '0');
  }, [preferencesReady, showSubtasks, showSubtasksStorageKey]);

  useEffect(() => {
    if (preferencesReady && fontSizeStorageKey) writeStorageValue(fontSizeStorageKey, String(fontSize));
  }, [fontSize, fontSizeStorageKey, preferencesReady]);

  useEffect(() => {
    if (preferencesReady && timeEntryStorageKey) writeStorageValue(timeEntryStorageKey, timeEntryOnClose ? '1' : '0');
  }, [preferencesReady, timeEntryOnClose, timeEntryStorageKey]);

  useEffect(() => {
    if (preferencesReady && laneTypeStorageKey) writeStorageValue(laneTypeStorageKey, laneType);
  }, [laneType, laneTypeStorageKey, preferencesReady]);

  useEffect(() => {
    if (preferencesReady && agingWarnDaysStorageKey) writeStorageValue(agingWarnDaysStorageKey, String(agingWarnDays));
  }, [agingWarnDays, agingWarnDaysStorageKey, preferencesReady]);

  useEffect(() => {
    if (preferencesReady && agingDangerDaysStorageKey) writeStorageValue(agingDangerDaysStorageKey, String(agingDangerDays));
  }, [agingDangerDays, agingDangerDaysStorageKey, preferencesReady]);

  useEffect(() => {
    if (preferencesReady && agingExcludeClosedStorageKey) writeStorageValue(agingExcludeClosedStorageKey, agingExcludeClosed ? '1' : '0');
  }, [agingExcludeClosed, agingExcludeClosedStorageKey, preferencesReady]);

  useEffect(() => {
    if (preferencesReady && viewableProjectsStorageKey) writeStorageValue(viewableProjectsStorageKey, viewableProjectsEnabled ? '1' : '0');
  }, [preferencesReady, viewableProjectsEnabled, viewableProjectsStorageKey]);

  useEffect(() => {
    if (preferencesReady && maximumBoardEntityCountStorageKey) writeStorageValue(maximumBoardEntityCountStorageKey, String(maximumBoardEntityCount));
  }, [maximumBoardEntityCount, maximumBoardEntityCountStorageKey, preferencesReady]);

  const setMaximumBoardEntityCountImmediately = useCallback((value: number) => {
    setMaximumBoardEntityCount(value);
    if (preferencesReady && maximumBoardEntityCountStorageKey) {
      writeStorageValue(maximumBoardEntityCountStorageKey, String(value));
    }
  }, [maximumBoardEntityCountStorageKey, preferencesReady]);

  return {
    projectScope,
    preferencesReady,
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
    maximumBoardEntityCount,
    setMaximumBoardEntityCount: setMaximumBoardEntityCountImmediately,
  };
}
