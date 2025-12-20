import { RectMap } from '../domain/model';

export type HitType =
  | 'NONE'
  | 'CARD'
  | 'COLUMN_HEADER'
  | 'LANE_HEADER'
  | 'CELL_BACKGROUND' // Empty space in a column/lane
  | 'BOARD_BACKGROUND';

export interface HitResult {
  type: HitType;
  id?: number | string; // Card ID, Column ID, Lane ID
  context?: {
    columnId?: number;
    laneId?: string | number;
  };
}

export class HitTestService {
  static hitTest(rectMap: RectMap, x: number, y: number): HitResult {
    // 1. Check Cards (Topmost usually, unless we have Z-index, but standard is top)
    // Reverse order check if overlaps exist?
    // Usually cards don't overlap in Kanban, but strictly:
    for (const cardIdStr in rectMap.cards) {
      const cardId = Number(cardIdStr);
      const r = rectMap.cards[cardId];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        return { type: 'CARD', id: cardId };
      }
    }

    // 2. Check Column Headers
    for (const colIdStr in rectMap.columns) {
      const colId = Number(colIdStr);
      const r = rectMap.columns[colId];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        return { type: 'COLUMN_HEADER', id: colId };
      }
    }

    // 3. Check Lane Headers
    for (const laneIdStr in rectMap.lanes) {
      const laneId = laneIdStr; // might be number string
      const r = rectMap.lanes[laneId];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        return { type: 'LANE_HEADER', id: laneId };
      }
    }

    // 4. Check Cells (Backgrounds)
    for (const key in rectMap.cells) {
      const r = rectMap.cells[key];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        const [colId, laneId] = key.split(':');
        return {
          type: 'CELL_BACKGROUND',
          id: key,
          context: {
            columnId: Number(colId),
            laneId: isNaN(Number(laneId)) && laneId !== '0' ? laneId : Number(laneId) // Simple parsing
          }
        };
      }
    }

    return { type: 'BOARD_BACKGROUND' };
  }
}
