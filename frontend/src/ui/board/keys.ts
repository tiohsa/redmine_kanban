import type { BoardData, Issue } from '../types';

export function buildSubtaskKey(issueId: number, subtaskId: number): string {
  return `${issueId}:${subtaskId}`;
}

export function parseSubtaskKey(key: string): { issueId: number; subtaskId: number } {
  const [issueId, subtaskId] = key.split(':').map(Number);
  return { issueId, subtaskId };
}

export function parseCellKey(key: string, data: BoardData): [number, string | number] {
  const [status, lane] = key.split(':');
  const statusId = Number(status);
  if (data.meta.lane_type === 'none') return [statusId, 'none'];
  if (lane === 'unassigned') return [statusId, 'unassigned'];
  if (lane === 'no_priority') return [statusId, 'no_priority'];
  const parsedLane = Number(lane);
  return [statusId, Number.isFinite(parsedLane) ? parsedLane : lane];
}

export function resolveBoardLaneId(data: BoardData, issue: Issue): string | number {
  if (data.meta.lane_type === 'assignee') return issue.assigned_to_id ?? 'unassigned';
  if (data.meta.lane_type === 'priority') return issue.priority_id ?? 'no_priority';
  return 'none';
}

export function laneIdToAssignee(
  data: BoardData,
  laneId: string | number,
  fallback: number | null,
): number | null {
  if (data.meta.lane_type !== 'assignee') return fallback;
  if (laneId === 'unassigned') return null;
  const parsed = Number(laneId);
  return Number.isFinite(parsed) ? parsed : null;
}

export function laneIdToPriority(
  data: BoardData,
  laneId: string | number,
  fallback: number | null,
): number | null | undefined {
  if (data.meta.lane_type !== 'priority') return fallback;
  if (laneId === 'no_priority') return null;
  const parsed = Number(laneId);
  return Number.isFinite(parsed) ? parsed : null;
}
