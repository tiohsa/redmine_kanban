import type { BoardData, Issue } from '../types';
import { flattenSubtasks } from '../subtasksTree';
import type { getMetrics } from './metrics';
import type { BoardState } from './state';
import { cellKey } from './state';

export type CardHeightCache = Map<string, number>;

// The caller supplies the existing two-line subject measurement without exposing Canvas.
export type SubjectLineMeasurer = (text: string, maxWidth: number, fontSize: number) => number;

export function computeLayout(
  state: BoardState,
  data: BoardData,
  canCreate: boolean,
  metrics: ReturnType<typeof getMetrics>,
  containerWidth: number = 0,
  fitMode: 'none' | 'width' = 'none',
  measureSubjectLines?: SubjectLineMeasurer,
  fontSize?: number,
  cardHeightCache?: CardHeightCache
) {
  const columnCount = state.columnOrder.length;
  const gridStartX = data.meta.lane_type === 'none' ? 0 : metrics.laneHeaderWidth;

  // Calculate dynamic column width when fitMode is 'width'
  let columnWidth = metrics.columnWidth;
  if (fitMode === 'width' && containerWidth > 0 && columnCount > 0) {
    const availableWidth = containerWidth - gridStartX;
    const totalGapWidth = Math.max(0, columnCount - 1) * metrics.columnGap;
    const calculatedWidth = Math.floor((availableWidth - totalGapWidth) / columnCount);
    // Use the larger of calculated width or minimum width (200px)
    columnWidth = Math.max(200, calculatedWidth);
  }

  const gridWidth =
    columnCount * columnWidth + Math.max(0, columnCount - 1) * metrics.columnGap;
  const headerHeight = metrics.headerHeight;
  const lanes = data.meta.lane_type === 'none' ? ['none'] : state.laneOrder;

  // Create adjusted metrics for lane height calculation
  const adjustedMetrics = { ...metrics, columnWidth };

  let currentY = headerHeight;
  const laneLayouts = lanes.map((laneId) => {
    const laneHeight = computeLaneHeight(state, data, laneId, canCreate, adjustedMetrics, measureSubjectLines, fontSize, cardHeightCache);
    const y = currentY;
    currentY += laneHeight;
    return { laneId, y, height: laneHeight };
  });

  const lastLane = laneLayouts[laneLayouts.length - 1];
  const boardHeight =
    (lastLane ? lastLane.y + lastLane.height : headerHeight) + metrics.boardPaddingBottom;

  return {
    gridStartX,
    gridWidth,
    headerHeight,
    laneLayouts,
    boardWidth: gridStartX + gridWidth,
    boardHeight,
    columnWidth,
  };
}

export function measureCardHeight(
  issue: Issue,
  metrics: ReturnType<typeof getMetrics>,
  measureSubjectLines?: SubjectLineMeasurer,
  fontSize?: number,
  cardWidth?: number,
  currentProjectId?: number
): number {
  let h = metrics.cardBaseHeight;
  const metaFontSize = Math.max(10, (fontSize ?? 13) - 2);
  if (issue.project && issue.project.id !== currentProjectId) {
    h += metaFontSize + 7;
  }

  if (measureSubjectLines && fontSize && cardWidth) {
    const stripWidth = 5;
    const contentW = cardWidth - metrics.cellPadding * 2 - stripWidth - 16;
    // Action icons are drawn as hover overlays, so they do not reserve layout space.
    const subjectW = contentW;
    const lineCount = measureSubjectLines(issue.subject, subjectW, fontSize);
    if (lineCount > 1) {
      h += (fontSize + 3) * (lineCount - 1);
    }
  }

  const subtaskRows = flattenSubtasks(issue.subtasks);
  if (subtaskRows.length > 0) {
    h += 20; // Padding before subtasks (increased from 8)
    h += subtaskRows.length * metrics.subtaskHeight;
  }
  return h;
}

export function makeSubtaskSignature(issue: Issue) {
  const subtaskRows = flattenSubtasks(issue.subtasks);
  const lastSubtaskId = subtaskRows[subtaskRows.length - 1]?.subtask.id ?? 0;
  const closedCount = subtaskRows.filter(({ subtask }) => subtask.is_closed).length;
  return `${subtaskRows.length}:${lastSubtaskId}:${closedCount}`;
}

export function makeCardHeightCacheKey(issue: Issue, fontSize: number | undefined, columnWidth: number | undefined, currentProjectId?: number) {
  return [issue.id, issue.subject, makeSubtaskSignature(issue), fontSize ?? 'default', columnWidth ?? 'default', currentProjectId ?? 'default'].join('|');
}

export function measureCardHeightCached(
  issue: Issue,
  metrics: ReturnType<typeof getMetrics>,
  cache: CardHeightCache | undefined,
  measureSubjectLines?: SubjectLineMeasurer,
  fontSize?: number,
  cardWidth?: number,
  currentProjectId?: number
) {
  if (!cache) return measureCardHeight(issue, metrics, measureSubjectLines, fontSize, cardWidth, currentProjectId);

  const key = makeCardHeightCacheKey(issue, fontSize, cardWidth, currentProjectId);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const height = measureCardHeight(issue, metrics, measureSubjectLines, fontSize, cardWidth, currentProjectId);
  cache.set(key, height);
  return height;
}

export function computeLaneHeight(
  state: BoardState,
  data: BoardData,
  laneId: string | number,
  canCreate: boolean,
  metrics: ReturnType<typeof getMetrics>,
  measureSubjectLines?: SubjectLineMeasurer,
  fontSize?: number,
  cardHeightCache?: CardHeightCache
) {
  let maxCellHeight = 0;

  for (const statusId of state.columnOrder) {
    const key = cellKey(statusId, laneId);
    const cardIds = state.cardsByCell.get(key) ?? [];

    let height = metrics.cellPadding * 2;
    if (cardIds.length > 0) {
      for (const cardId of cardIds) {
        const issue = state.cardsById.get(cardId);
        if (issue) {
          height += measureCardHeightCached(issue, metrics, cardHeightCache, measureSubjectLines, fontSize, metrics.columnWidth, data.meta.project_id);
        }
      }
      height += (cardIds.length - 1) * metrics.cardGap;
    }

    maxCellHeight = Math.max(maxCellHeight, height);
  }

  if (data.meta.lane_type === 'none') return maxCellHeight;
  return Math.max(maxCellHeight, metrics.laneTitleHeight);
}
