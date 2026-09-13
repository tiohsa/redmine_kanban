import { describe, expect, it, vi } from 'vitest';
import { renderCanvasScene } from './CanvasRenderer';

function contextStub() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe('renderCanvasScene', () => {
  it('preserves the board layer order and sticky header transform', () => {
    const ctx = contextStub();
    const order: string[] = [];
    renderCanvasScene({
      ctx,
      scale: 0.8,
      scroll: { x: 12, y: 34 },
      drawCells: () => order.push('cells'),
      drawLaneLabels: () => order.push('lanes'),
      drawDragOverlay: () => order.push('drag'),
      drawHeaders: () => order.push('headers'),
    });

    expect(order).toEqual(['cells', 'lanes', 'drag', 'headers']);
    expect(ctx.scale).toHaveBeenCalledWith(0.8, 0.8);
    expect(ctx.translate).toHaveBeenNthCalledWith(1, -12, -34);
    expect(ctx.translate).toHaveBeenNthCalledWith(2, 0, 34);
  });
});
