/**
 * Composes a rendered board scene onto a canvas context.
 *
 * The callbacks contain the feature-specific drawing primitives. This module
 * owns only the canvas transform and layer order, so it has no React state or
 * mutable board state of its own.
 */
export type CanvasRenderScene = {
  ctx: CanvasRenderingContext2D;
  scale: number;
  scroll: { x: number; y: number };
  drawCells: () => void;
  drawLaneLabels?: () => void;
  drawDragOverlay: () => void;
  drawHeaders: () => void;
};

export function renderCanvasScene({
  ctx,
  scale,
  scroll,
  drawCells,
  drawLaneLabels,
  drawDragOverlay,
  drawHeaders,
}: CanvasRenderScene): void {
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-scroll.x, -scroll.y);

  drawCells();
  drawLaneLabels?.();
  drawDragOverlay();

  // Headers are sticky: counteract the board's vertical translation.
  ctx.save();
  ctx.translate(0, scroll.y);
  drawHeaders();
  ctx.restore();

  ctx.restore();
}
