import { useMemo } from 'react';
import type { BoardData, Issue } from './types';
import { buildBoardState, type BoardState } from './board/state';
import { applyBoardDataFilters, buildPresentationProjection, buildVisibleIssues, type Filters } from './boardFilters';
import { buildDisplayData } from './kanbanShared';
import type { SortKey } from './board/sort';

type Args = {
  data: BoardData | null;
  laneType: Parameters<typeof buildDisplayData>[1];
  agingWarnDays: number;
  agingDangerDays: number;
  agingExcludeClosed: boolean;
  showSubtasks: boolean;
  filters: Filters;
  hiddenStatusIds: Set<number>;
  pendingDeleteIssue: Issue | null;
  sortKey: SortKey;
};

export function useBoardPresentation({
  data,
  laneType,
  agingWarnDays,
  agingDangerDays,
  agingExcludeClosed,
  showSubtasks,
  filters,
  hiddenStatusIds,
  pendingDeleteIssue,
  sortKey,
}: Args) {
  const displayData = useMemo(() => {
    if (!data) return null;
    return buildDisplayData(data, laneType, { warnDays: agingWarnDays, dangerDays: agingDangerDays, excludeClosed: agingExcludeClosed });
  }, [agingDangerDays, agingExcludeClosed, agingWarnDays, data, laneType]);

  const primaryFilteredData = useMemo(
    () => applyBoardDataFilters(displayData, showSubtasks, filters.statusIds, filters.trackerIds),
    [displayData, filters.statusIds, filters.trackerIds, showSubtasks],
  );
  const issues = useMemo(
    () => buildVisibleIssues(primaryFilteredData, filters, hiddenStatusIds, pendingDeleteIssue),
    [filters, hiddenStatusIds, pendingDeleteIssue, primaryFilteredData],
  );
  const presentation = useMemo(
    () => {
      if (!primaryFilteredData || !displayData) return null;
      return buildPresentationProjection(
        displayData,
        primaryFilteredData.columns,
        issues,
        filters.statusIds,
        hiddenStatusIds,
      );
    }, [displayData, filters.statusIds, hiddenStatusIds, issues, primaryFilteredData],
  );
  const filteredData = useMemo(
    () => {
      if (!primaryFilteredData || !presentation) return null;
      return { ...primaryFilteredData, columns: presentation.columns };
    }, [presentation, primaryFilteredData],
  );
  const priorityRank = useMemo(() => {
    const rank = new Map<number, number>();
    for (const [index, priority] of (data?.lists.priorities ?? []).entries()) rank.set(priority.id, index);
    return rank;
  }, [data]);
  const boardState = useMemo<BoardState | null>(() => {
    if (!filteredData) return null;
    return buildBoardState(
      filteredData,
      presentation?.issues ?? [],
      sortKey,
      priorityRank,
      filters.assigneeIds,
      filters.priority,
      filters.priorityFilterEnabled,
    );
  }, [filteredData, filters.assigneeIds, filters.priority, filters.priorityFilterEnabled, presentation?.issues, priorityRank, sortKey]);

  return { boardState, displayData, filteredData, issues, presentation, primaryFilteredData };
}
