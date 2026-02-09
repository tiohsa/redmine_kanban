import type { BoardData, Column, Issue, Lane } from '../types';
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
  priorityRank: Map<number, number>
): BoardState {
  const columns = data.columns ?? [];
  const lanes = data.lanes ?? [];
  const columnOrder = columns.map((c) => c.id);
  const laneOrder = data.meta.lane_type === 'none' ? ['none'] : lanes.map((l) => l.id);

  const cardsById = new Map<number, Issue>();
  for (const issue of issues) {
    cardsById.set(issue.id, issue);
  }

  const cardsByCell = new Map<string, number[]>();
  for (const issue of issues) {
    const laneId = resolveLaneId(data, issue);
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

export function cellKey(statusId: number, laneId: string | number) {
  return `${statusId}:${String(laneId)}`;
}

export function resolveLaneId(data: BoardData, issue: Issue): string | number {
  if (data.meta.lane_type === 'assignee') {
    return issue.assigned_to_id ?? 'unassigned';
  }
  if (data.meta.lane_type === 'priority') {
    return issue.priority_id ?? 'no_priority';
  }
  return 'none';
}
