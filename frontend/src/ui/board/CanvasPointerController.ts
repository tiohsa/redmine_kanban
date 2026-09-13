import type { BoardData, Issue } from '../types';
import { cellKey } from './state';
import { hitTestCell, type RectMap } from './HitTestIndex';
import { resolveBoardLaneId } from './keys';
import { assessDrop, type DropAssessment } from './canvasInteraction';
import { transitionDragPhase, type DragPhase } from './dragInteraction';

export type BoardPoint = { x: number; y: number };

export type ClientPoint = { clientX: number; clientY: number };

export type DragState = {
  issueId: number;
  start: BoardPoint;
  current: BoardPoint;
  origin: { statusId: number; laneId: string | number };
  allowedStatusIds?: ReadonlySet<number>;
  phase: Exclude<DragPhase, 'idle'>;
  targetCellKey: string | null;
  targetAssessment: DropAssessment | null;
  dropTargetCellKey?: string | null;
};

export function toBoardPoint(
  event: ClientPoint,
  scroll: { x: number; y: number },
  canvas: HTMLCanvasElement | null,
  scale = 1,
): BoardPoint {
  const rect = canvas?.getBoundingClientRect();
  const offsetX = rect ? event.clientX - rect.left : event.clientX;
  const offsetY = rect ? event.clientY - rect.top : event.clientY;
  return {
    x: offsetX / scale + scroll.x,
    y: offsetY / scale + scroll.y,
  };
}

export function createDragState(issue: Issue, point: BoardPoint, data: BoardData): DragState {
  return {
    issueId: issue.id,
    start: point,
    current: point,
    origin: { statusId: issue.status_id, laneId: resolveBoardLaneId(data, issue) },
    allowedStatusIds: issue.allowed_status_ids ? new Set(issue.allowed_status_ids) : undefined,
    phase: transitionDragPhase('idle', 'pointerdown') as Exclude<DragPhase, 'idle'>,
    targetCellKey: null,
    targetAssessment: null,
  };
}

export function advanceDragState(
  drag: DragState,
  point: BoardPoint,
  rectMap: RectMap,
  data: BoardData,
  threshold = 4,
): DragState {
  const next = { ...drag, current: point };
  if (next.phase === 'pressed') {
    const dx = Math.abs(point.x - next.start.x);
    const dy = Math.abs(point.y - next.start.y);
    if (dx + dy >= threshold) {
      next.phase = transitionDragPhase(next.phase, 'threshold-reached') as Exclude<DragPhase, 'idle'>;
    }
  }
  if (next.phase === 'dragging') {
    const target = hitTestCell(point, rectMap, data);
    next.targetCellKey = target ? cellKey(target.statusId, target.laneId) : null;
    next.targetAssessment = target
      ? assessDrop(
        next.origin.statusId,
        next.origin.laneId,
        target.statusId,
        target.laneId,
        next.allowedStatusIds,
        data.meta.lane_type,
      )
      : null;
  }
  return next;
}

export type DropTarget = { statusId: number; laneId: string | number; cellKey: string };

export function resolveDropTarget(
  point: BoardPoint,
  rectMap: RectMap,
  data: BoardData,
): DropTarget | null {
  const target = hitTestCell(point, rectMap, data);
  if (!target) return null;
  return { ...target, cellKey: cellKey(target.statusId, target.laneId) };
}
