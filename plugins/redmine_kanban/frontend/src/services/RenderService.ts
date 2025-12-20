import { BoardState, RectMap } from '../domain/model';
import { LAYOUT_CONSTANTS } from './LayoutService';

export class RenderService {
  private ctx: CanvasRenderingContext2D;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  // Main Render Loop
  public render(state: BoardState, rectMap: RectMap, viewState: any) {
    const { ctx } = this;
    const { boardWidth, boardHeight } = rectMap;
    const { scrollX, scrollY, viewportW, viewportH } = viewState;

    // 1. Clear Viewport
    ctx.clearRect(0, 0, viewportW, viewportH);

    ctx.save();
    // Apply Scroll
    ctx.translate(-scrollX, -scrollY);

    // 2. Draw Background
    this.drawBackground(boardWidth, boardHeight);

    // 3. Draw Columns (Headers & Backgrounds)
    this.drawColumns(state, rectMap);

    // 4. Draw Lanes (if any)
    this.drawLanes(state, rectMap);

    // 5. Draw Cards
    this.drawCards(state, rectMap, viewState);

    // 6. Draw Overlay (Drag Ghost)
    if (viewState.isDragging && viewState.draggedCardId) {
       this.drawDragOverlay(state, rectMap, viewState);
    }

    ctx.restore();
  }

  private drawBackground(w: number, h: number) {
    this.ctx.fillStyle = '#f0f2f5';
    this.ctx.fillRect(0, 0, w, h);
  }

  private drawColumns(state: BoardState, map: RectMap) {
    const { ctx } = this;

    // Draw Column Headers
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const colIdStr in map.columns) {
      const colId = Number(colIdStr);
      const r = map.columns[colId];
      const col = state.entities.columns[colId];

      // Header BG
      ctx.fillStyle = '#dfe1e6';
      ctx.fillRect(r.x, r.y, r.w, r.h);

      // Title
      ctx.fillStyle = '#172b4d';
      ctx.fillText(col.name, r.x + r.w / 2, r.y + r.h / 2);
    }

    // Draw Cell Backgrounds (Optional, helpful for debugging or styling)
    /*
    for (const key in map.cells) {
      const r = map.cells[key];
      ctx.strokeStyle = '#e0e0e0';
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
    */
  }

  private drawLanes(state: BoardState, map: RectMap) {
    const { ctx } = this;
    // ... Implement lane drawing if needed
  }

  private drawCards(state: BoardState, map: RectMap, viewState: any) {
    const { ctx } = this;
    const { scrollX, scrollY, viewportW, viewportH } = viewState;

    // Optimized Virtualization: Iterate Columns -> Cards in View
    const viewportRect = { x: scrollX, y: scrollY, w: viewportW, h: viewportH };

    // 1. Identify Visible Columns
    const visibleColIds: number[] = [];
    for (const colIdStr in map.columns) {
      const colId = Number(colIdStr);
      const r = map.columns[colId];
      // Check horizontal intersection only (columns are full height effectively)
      if (r.x + r.w >= scrollX && r.x <= scrollX + viewportW) {
        visibleColIds.push(colId);
      }
    }

    // 2. Iterate Lanes to find cells within visible columns
    // Since we don't have a direct "Cell -> Cards" map in RectMap (we have cells map but not linked to cards directly efficiently without lookup),
    // we use the State structure which maps Column+Lane -> Cards.
    // RectMap needs to give us the Y range of the lane.

    const { structure, entities } = state;

    structure.laneIds.forEach(laneId => {
      // Check if Lane is vertically visible
      // We need the Y position of the lane.
      // If we have lane headers, we can use that. If not, we need to know the lane's range.
      // map.lanes might strictly be headers. map.cells has the info.

      // Let's use the first visible column to determine lane Y range roughly, or rely on map.cells
      // Pick the first visible column to check lane vertical visibility
      if (visibleColIds.length === 0) return;
      const testColId = visibleColIds[0];
      const cellKey = `${testColId}:${laneId}`;
      const cellRect = map.cells[cellKey];

      if (!cellRect) return; // Should not happen

      // Check vertical intersection
      if (cellRect.y + cellRect.h < scrollY || cellRect.y > scrollY + viewportH) {
        return; // Lane not visible
      }

      // 3. Render cards in this Lane for visible Columns
      visibleColIds.forEach(colId => {
        const key = `${colId}:${laneId}`;
        const cardIds = structure.board[key];
        if (!cardIds) return;

        cardIds.forEach(cardId => {
          if (viewState.isDragging && viewState.draggedCardId === cardId) return;

          const r = map.cards[cardId];
          if (!r) return;

          // Extra check for partial visibility (e.g. at the top/bottom edge of viewport)
          if (r.y + r.h < scrollY || r.y > scrollY + viewportH) return;

          const card = entities.cards[cardId];
          this.drawCard(ctx, r, card);
        });
      });
    });
  }

  private drawCard(ctx: CanvasRenderingContext2D, r: any, card: any) {
    // Shadow
    ctx.shadowColor = 'rgba(0,0,0,0.1)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 2;

    // Card BG
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(r.x, r.y, r.w, r.h);

    // Reset Shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Border (if selected or hovered - ignored for now)
    // ctx.strokeStyle = '#ccc';
    // ctx.strokeRect(r.x, r.y, r.w, r.h);

    // Content
    ctx.fillStyle = '#333';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // Subject (Truncate logic needed for real app)
    ctx.fillText(card.subject, r.x + 8, r.y + 8);

    // Metadata
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#666';
    if (card.assigned_to_name) {
      ctx.fillText(card.assigned_to_name, r.x + 8, r.y + 30);
    }
  }

  private drawDragOverlay(state: BoardState, map: RectMap, viewState: any) {
    const { ctx } = this;
    const cardId = viewState.draggedCardId;
    const originalRect = map.cards[cardId];
    if (!originalRect) return;

    // Calculate current position based on drag delta
    const x = originalRect.x + (viewState.dragCurrentX - viewState.dragStartX);
    const y = originalRect.y + (viewState.dragCurrentY - viewState.dragStartY);

    const r = { ...originalRect, x, y };

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.translate(5, 5); // Lift effect
    this.drawCard(ctx, r, state.entities.cards[cardId]);
    ctx.restore();
  }

  private intersects(r1: any, r2: any): boolean {
    return !(r2.x > r1.x + r1.w ||
             r2.x + r2.w < r1.x ||
             r2.y > r1.y + r1.h ||
             r2.y + r2.h < r1.y);
  }
}
