import type { BoardData, Column, Issue, Lane } from '../types';
import { resolveBoardLaneId } from './keys';
import { sortIssues, type SortKey } from './sort';

export type BoardState = {
  columns: Column[];
  lanes: Lane[];
  columnOrder: number[];
  laneOrder: Array<string | number>;
  cardsById: Map<number, Issue>;
  cardsByCell: Map<string, number[]>;
};

export function buildBoardState(
  data: BoardData,
  issues: Issue[],
  sortKey: SortKey,
  priorityRank: Map<number, number>,
  assigneeIds: string[] = [],
  priorityIds: string[] = [],
  priorityFilterEnabled: boolean = false,
): BoardState {
  const columns = data.columns ?? [];
  const lanes = buildVisibleLanes(data, assigneeIds, priorityIds, priorityFilterEnabled);
  const columnOrder = columns.map((c) => c.id);
  const laneOrder = data.meta.lane_type === 'none' ? ['none'] : lanes.map((l) => l.id);

  const cardsById = new Map<number, Issue>();
  for (const issue of issues) {
    cardsById.set(issue.id, issue);
  }

  const cardsByCell = new Map<string, number[]>();
  for (const issue of issues) {
    const laneId = resolveBoardLaneId(data, issue);
    const key = cellKey(issue.status_id, laneId);
    const list = cardsByCell.get(key) ?? [];
    list.push(issue.id);
    cardsByCell.set(key, list);
  }

  for (const [key, ids] of cardsByCell) {
    const list = ids.map((id) => cardsById.get(id)).filter((v): v is Issue => Boolean(v));
    const sorted = sortIssues(list, sortKey, priorityRank);
    cardsByCell.set(
      key,
      sorted.map((it) => it.id)
    );
  }

  return {
    columns,
    lanes,
    columnOrder,
    laneOrder,
    cardsById,
    cardsByCell,
  };
}

function buildVisibleLanes(
  data: BoardData,
  assigneeIds: string[],
  priorityIds: string[],
  priorityFilterEnabled: boolean,
): Lane[] {
  if (data.meta.lane_type === 'priority') {
    return buildVisiblePriorityLanes(data, priorityIds, priorityFilterEnabled);
  }
  if (data.meta.lane_type !== 'assignee') return data.lanes ?? [];

  const availableLanes = (data.lists.assignees ?? []).map((assignee) => ({
    id: assignee.id ?? 'unassigned',
    name: assignee.name,
    assigned_to_id: assignee.id,
  }));

  if (assigneeIds.length === 0) return availableLanes;

  const visibleLaneIds = new Set<string | number>();
  for (const assigneeId of assigneeIds) {
    if (assigneeId === 'unassigned') {
      visibleLaneIds.add('unassigned');
      continue;
    }

    const parsedId = Number(assigneeId);
    visibleLaneIds.add(Number.isFinite(parsedId) ? parsedId : assigneeId);
  }

  return availableLanes.filter((lane) => visibleLaneIds.has(lane.id));
}

function buildVisiblePriorityLanes(data: BoardData, priorityIds: string[], priorityFilterEnabled: boolean): Lane[] {
  const availableLanes = [
    ...(data.lists.priorities ?? []).map((priority) => ({
      id: priority.id,
      name: priority.name,
      priority_id: priority.id,
      assigned_to_id: null,
    })),
    {
      id: 'no_priority',
      name: data.labels.not_set,
      priority_id: null,
      assigned_to_id: null,
    },
  ];

  if (!priorityFilterEnabled || priorityIds.length === 0) return availableLanes;

  const visibleLaneIds = new Set<string | number>();
  for (const priorityId of priorityIds) {
    if (priorityId === 'no_priority') {
      visibleLaneIds.add('no_priority');
      continue;
    }

    const parsedId = Number(priorityId);
    visibleLaneIds.add(Number.isFinite(parsedId) ? parsedId : priorityId);
  }

  return availableLanes.filter((lane) => visibleLaneIds.has(lane.id));
}

export function cellKey(statusId: number, laneId: string | number) {
  return `${statusId}:${String(laneId)}`;
}

export { resolveBoardLaneId as resolveLaneId } from './keys';
