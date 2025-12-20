import { BoardState, RectMap, Rect } from '../domain/model';

export const LAYOUT_CONSTANTS = {
  COLUMN_WIDTH: 280,
  COLUMN_HEADER_HEIGHT: 40,
  LANE_HEADER_WIDTH: 40, // If we have swimlanes with headers on the left
  CARD_HEIGHT: 100, // Estimated, or dynamic? Prompt says "RectMap based". We might need variable height.
  CARD_WIDTH: 260,
  CARD_GAP: 10,
  COLUMN_GAP: 10,
  LANE_GAP: 20,
  PADDING: 10
};

// For MVP, we assume fixed card height or simplistic calculation.
// Real-world often needs text measurement.
// "Layout... separate... all rendering based on RectMap" implies we compute this first.
// If text is variable, we need a way to measure it *before* layout or assume a max height.
// I'll stick to fixed height for now to satisfy MVP, or simple text estimation.

export class LayoutService {
  private static readonly CARD_HEIGHT = 80;
  private static readonly CARD_PADDING = 8;
  private static readonly LINE_HEIGHT = 14;

  static calculateLayout(state: BoardState): RectMap {
    const { structure, entities } = state;
    const { columnIds, laneIds, board } = structure;

    const map: RectMap = {
      columns: {},
      lanes: {},
      cells: {},
      cards: {},
      boardWidth: 0,
      boardHeight: 0
    };

    let currentX = LAYOUT_CONSTANTS.PADDING;
    let currentY = LAYOUT_CONSTANTS.PADDING;

    // 1. Calculate Column Header positions
    // If we have lane headers on the left, we offset X.
    const hasLaneHeaders = laneIds.length > 0 && state.meta.lane_type !== 'none';
    const startX = hasLaneHeaders ? LAYOUT_CONSTANTS.LANE_HEADER_WIDTH + LAYOUT_CONSTANTS.PADDING : LAYOUT_CONSTANTS.PADDING;
    const headerY = LAYOUT_CONSTANTS.PADDING;

    // Top Headers (Columns)
    columnIds.forEach((colId, index) => {
      const x = startX + index * (LAYOUT_CONSTANTS.COLUMN_WIDTH + LAYOUT_CONSTANTS.COLUMN_GAP);
      map.columns[colId] = {
        x,
        y: headerY,
        w: LAYOUT_CONSTANTS.COLUMN_WIDTH,
        h: LAYOUT_CONSTANTS.COLUMN_HEADER_HEIGHT
      };
    });

    const boardContentStartY = headerY + LAYOUT_CONSTANTS.COLUMN_HEADER_HEIGHT + LAYOUT_CONSTANTS.PADDING;
    currentY = boardContentStartY;

    // 2. Iterate Lanes and Columns to place Cards
    laneIds.forEach((laneId) => {
      let maxLaneHeight = 0;
      const laneStartY = currentY;

      // Calculate layout for each cell in this lane
      columnIds.forEach((colId) => {
        const colRect = map.columns[colId]; // Get X from header
        const key = `${colId}:${laneId}`;
        const cardIds = board[key] || [];

        let cardY = laneStartY + LAYOUT_CONSTANTS.PADDING; // Inside the cell
        const cardX = colRect.x + (LAYOUT_CONSTANTS.COLUMN_WIDTH - LAYOUT_CONSTANTS.CARD_WIDTH) / 2;

        cardIds.forEach(cardId => {
          const card = entities.cards[cardId];
          // Simple dynamic height estimation
          const height = this.estimateCardHeight(card);

          map.cards[cardId] = {
            x: cardX,
            y: cardY,
            w: LAYOUT_CONSTANTS.CARD_WIDTH,
            h: height
          };

          cardY += height + LAYOUT_CONSTANTS.CARD_GAP;
        });

        const cellHeight = cardY - laneStartY;
        if (cellHeight > maxLaneHeight) {
          maxLaneHeight = cellHeight;
        }
      });

      // Minimum lane height
      maxLaneHeight = Math.max(maxLaneHeight, 100);

      // Store Lane Rect (Left header area or full row?)
      // Let's store the full row area as "lane" usually.
      // Or if 'lanes' map implies headers:
      if (hasLaneHeaders) {
        map.lanes[laneId] = {
           x: LAYOUT_CONSTANTS.PADDING,
           y: laneStartY,
           w: LAYOUT_CONSTANTS.LANE_HEADER_WIDTH,
           h: maxLaneHeight
        };
      }

      // Store Cells (Backgrounds)
      columnIds.forEach((colId) => {
        const colRect = map.columns[colId];
        const key = `${colId}:${laneId}`;
        map.cells[key] = {
          x: colRect.x,
          y: laneStartY,
          w: colRect.w,
          h: maxLaneHeight
        };
      });

      currentY += maxLaneHeight + LAYOUT_CONSTANTS.LANE_GAP;
    });

    // Final Dimensions
    const lastColId = columnIds[columnIds.length - 1];
    const rightEdge = lastColId ? (map.columns[lastColId].x + map.columns[lastColId].w) : 0;

    map.boardWidth = rightEdge + LAYOUT_CONSTANTS.PADDING;
    map.boardHeight = currentY;

    return map;
  }

  private static estimateCardHeight(card: any): number {
    // Very basic estimation
    let h = 40; // Title area
    if (card.assigned_to_name) h += 20;
    // if (card.description) h += 20; // Maybe not showing desc in list
    // Add logic for tags, etc.
    return h + 10; // Padding
  }
}
