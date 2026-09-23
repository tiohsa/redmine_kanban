import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type SetStateAction } from 'react';
import { DEFAULT_SORT_CONFIG, parseSortConfig, serializeSortConfig, type SortConfig } from '../../model/view/sort';
import type { CardDisplayMode, Filters, FitMode, LaneType } from '../../model/view/types';
import { DEFAULT_FILTERS, DEFAULT_MAXIMUM_BOARD_ENTITY_COUNT, normalizeMaximumBoardEntityCount, restoreAgingDays } from '../../model/view/preferences';
import { readFilters, readStorageValue, removeStorageValue, writeStorageValue } from '../../infrastructure/storage/preferencesRepository';
export { DEFAULT_MAXIMUM_BOARD_ENTITY_COUNT, MAXIMUM_BOARD_ENTITY_COUNT, normalizeMaximumBoardEntityCount, parseMaximumBoardEntityCount } from '../../model/view/preferences';
import { buildProjectScopeFromDataUrl, makeScopedStorageKey, readScopedBooleanWithLegacy, readScopedNumberSetWithLegacy, readScopedValueWithLegacy } from '../../infrastructure/storage/scopedStorage';
import { copyViewSettings, type SavedViewSettings } from '../../model/view/savedViews';

export type { LaneType } from '../../model/view/types';
export type { CardDisplayMode } from '../../model/view/types';
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
  const cardDisplayModeStorageKey = userKey('rk_card_display_mode');
  const showSubtasksStorageKey = userKey('rk_show_subtasks');
  const sortConfigStorageKey = userKey('rk_sortkey');
  const fontSizeStorageKey = userKey('rk_font_size');
  const timeEntryStorageKey = userKey('rk_time_entry_on_close');

  const [viewSettings, setViewSettings] = useState<SavedViewSettings>({
    filters: DEFAULT_FILTERS,
    sortConfig: DEFAULT_SORT_CONFIG.map((criterion) => ({ ...criterion })),
    laneType: 'assignee', hiddenStatusIds: [], viewableProjectsEnabled: false,
  });
  const { filters, sortConfig, laneType, viewableProjectsEnabled } = viewSettings;
  const hiddenStatusIds = useMemo(() => new Set(viewSettings.hiddenStatusIds), [viewSettings.hiddenStatusIds]);
  const applyViewSettings = useCallback((settings: SavedViewSettings) => setViewSettings(copyViewSettings(settings)), []);
  const setFilters = useCallback((action: SetStateAction<Filters>) => {
    setViewSettings((previous) => ({ ...previous, filters: typeof action === 'function' ? action(previous.filters) : action }));
  }, []);
  const setSortConfig = useCallback((action: SetStateAction<SortConfig>) => {
    setViewSettings((previous) => ({ ...previous, sortConfig: typeof action === 'function' ? action(previous.sortConfig) : action }));
  }, []);
  const setLaneType = useCallback((action: SetStateAction<LaneType>) => {
    setViewSettings((previous) => ({ ...previous, laneType: typeof action === 'function' ? action(previous.laneType) : action }));
  }, []);
  const setViewableProjectsEnabled = useCallback((action: SetStateAction<boolean>) => {
    setViewSettings((previous) => ({ ...previous, viewableProjectsEnabled: typeof action === 'function' ? action(previous.viewableProjectsEnabled) : action }));
  }, []);
  const [fullWindow, setFullWindow] = useState(false);
  const [fitMode, setFitMode] = useState<FitMode>('none');
  const [cardDisplayMode, setCardDisplayMode] = useState<CardDisplayMode>('standard');
  const [showSubtasks, setShowSubtasks] = useState(true);
  const setHiddenStatusIds = useCallback((action: SetStateAction<Set<number>>) => {
    setViewSettings((previous) => ({ ...previous, hiddenStatusIds: Array.from(typeof action === 'function' ? action(new Set(previous.hiddenStatusIds)) : action) }));
  }, []);
  const [fontSize, setFontSize] = useState(13);
  const [timeEntryOnClose, setTimeEntryOnClose] = useState(false);
  const [agingWarnDays, setAgingWarnDays] = useState(3);
  const [agingDangerDays, setAgingDangerDays] = useState(7);
  const [agingExcludeClosed, setAgingExcludeClosed] = useState(true);
  const [maximumBoardEntityCount, setMaximumBoardEntityCount] = useState(DEFAULT_MAXIMUM_BOARD_ENTITY_COUNT);
  const [hydratedScope, setHydratedScope] = useState<string | null>(null);
  const hydrationScope = userScope ? `${projectScope}:${userScope}` : null;
  const preferencesReady = hydrationScope !== null && hydratedScope === hydrationScope;

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
    setCardDisplayMode(readStorageValue(cardDisplayModeStorageKey!) === 'single_line' ? 'single_line' : 'standard');
    setShowSubtasks(readScopedValueWithLegacy(showSubtasksStorageKey!, 'rk_show_subtasks') !== '0');
    const savedSortConfig = readScopedValueWithLegacy(sortConfigStorageKey!, 'rk_sortkey');
    setSortConfig(parseSortConfig(savedSortConfig));
    setHiddenStatusIds(readScopedNumberSetWithLegacy(hiddenStatusStorageKey!, makeScopedStorageKey('rk_hidden_status_ids', projectScope), new Set()));
    setFontSize(Number(readScopedValueWithLegacy(fontSizeStorageKey!, 'rk_font_size')) || 13);
    setTimeEntryOnClose(readScopedValueWithLegacy(timeEntryStorageKey!, 'rk_time_entry_on_close') === '1');
    const laneType = readStorageValue(laneTypeStorageKey!);
    const legacyLaneTypeStorageKey = makeScopedStorageKey('rk_lane_type', projectScope);
    const legacyLaneType = laneType === null ? readStorageValue(legacyLaneTypeStorageKey) : null;
    const resolvedLaneType = laneType ?? legacyLaneType;
    setLaneType(
      resolvedLaneType === 'none' || resolvedLaneType === 'priority' || resolvedLaneType === 'assignee' || resolvedLaneType === 'category'
        ? resolvedLaneType
        : readScopedBooleanWithLegacy(
            priorityLaneStorageKey!,
            makeScopedStorageKey('rk_priority_lane_enabled', projectScope),
            false,
          )
          ? 'priority'
          : 'assignee',
    );
    const warnDays = restoreAgingDays(readScopedValueWithLegacy(agingWarnDaysStorageKey!, makeScopedStorageKey('rk_aging_warn_days', projectScope)), 3);
    setAgingWarnDays(warnDays);
    setAgingDangerDays(Math.max(warnDays, restoreAgingDays(readScopedValueWithLegacy(agingDangerDaysStorageKey!, makeScopedStorageKey('rk_aging_danger_days', projectScope)), 7)));
    setAgingExcludeClosed(readScopedBooleanWithLegacy(agingExcludeClosedStorageKey!, makeScopedStorageKey('rk_aging_exclude_closed', projectScope), true));
    setViewableProjectsEnabled(readScopedBooleanWithLegacy(viewableProjectsStorageKey!, makeScopedStorageKey('rk_viewable_projects_enabled', projectScope), false));
    setMaximumBoardEntityCount(normalizeMaximumBoardEntityCount(readStorageValue(maximumBoardEntityCountStorageKey!)));
    setHydratedScope(hydrationScope);
  }, [hydrationScope, setFilters, setSortConfig, setHiddenStatusIds, setLaneType, setViewableProjectsEnabled, agingDangerDaysStorageKey, agingExcludeClosedStorageKey, agingWarnDaysStorageKey, cardDisplayModeStorageKey, filtersStorageKey, fitModeStorageKey, fontSizeStorageKey, fullWindowStorageKey, hiddenStatusStorageKey, laneTypeStorageKey, maximumBoardEntityCountStorageKey, priorityLaneStorageKey, projectScope, showSubtasksStorageKey, sortConfigStorageKey, timeEntryStorageKey, userScope, viewableProjectsStorageKey]);

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
    if (preferencesReady && cardDisplayModeStorageKey) writeStorageValue(cardDisplayModeStorageKey, cardDisplayMode);
  }, [cardDisplayMode, cardDisplayModeStorageKey, preferencesReady]);

  useEffect(() => {
    if (preferencesReady && sortConfigStorageKey) writeStorageValue(sortConfigStorageKey, serializeSortConfig(sortConfig));
  }, [preferencesReady, sortConfig, sortConfigStorageKey]);

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
    viewSettings,
    applyViewSettings,
    projectScope,
    preferencesReady,
    setCurrentUserId,
    filters,
    setFilters,
    fullWindow,
    setFullWindow,
    fitMode,
    setFitMode,
    cardDisplayMode,
    setCardDisplayMode,
    showSubtasks,
    setShowSubtasks,
    sortConfig,
    setSortConfig,
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
