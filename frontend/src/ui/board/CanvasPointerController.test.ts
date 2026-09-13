import { describe, expect, it } from 'vitest';
import type { BoardData, Issue } from '../types';
import { createRectMap } from './HitTestIndex';
import {
  advanceDragState,
  createDragState,
  resolveDropTarget,
  toBoardPoint,
} from './CanvasPointerController';

const data = { meta: { lane_type: 'none' } } as BoardData;
const categoryData = { meta: { lane_type: 'category' } } as BoardData;
const issue = { id: 7, status_id: 1, allowed_status_ids: [1, 2] } as Issue;

describe('CanvasPointerController', () => {
  it('converts client coordinates into board coordinates', () => {
    const canvas = { getBoundingClientRect: () => ({ left: 10, top: 20 }) } as HTMLCanvasElement;
    expect(toBoardPoint({ clientX: 50, clientY: 80 }, { x: 100, y: 40 }, canvas, 2)).toEqual({ x: 120, y: 70 });
  });

  it('creates a drag state through the existing drag phase machine', () => {
    const drag = createDragState(issue, { x: 2, y: 3 }, data);
    expect(drag).toMatchObject({
      issueId: 7,
      origin: { statusId: 1, laneId: 'none' },
      phase: 'pressed',
      targetCellKey: null,
    });
    expect(drag.allowedStatusIds).toEqual(new Set([1, 2]));
  });

  it('advances through threshold and keeps the target cell in drag state', () => {
    const index = createRectMap();
    index.cells.set('2:9', { x: 10, y: 10, width: 20, height: 20 });
    const drag = createDragState(issue, { x: 0, y: 0 }, data);
    const next = advanceDragState(drag, { x: 15, y: 15 }, index, categoryData);
    expect(next.phase).toBe('dragging');
    expect(next.targetCellKey).toBe('2:9');
  });

  it('resolves a drop target without dispatching a command', () => {
    const index = createRectMap();
    index.cells.set('2:9', { x: 10, y: 10, width: 20, height: 20 });
    expect(resolveDropTarget({ x: 15, y: 15 }, index, categoryData)).toEqual({
      statusId: 2, laneId: 9, cellKey: '2:9',
    });
    expect(resolveDropTarget({ x: 0, y: 0 }, index, categoryData)).toBeNull();
  });
});
