import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { BoardData, Column, Issue, Lane } from '../types';
import type { BoardCommand } from './commands';
import type { BoardState } from './state';
import { cellKey } from './state';

const metrics = {
  columnWidth: 260,
  columnGap: 0,
  laneHeaderWidth: 160,
  headerHeight: 56,
  laneTitleHeight: 40,
  laneGap: 0,
  cellPadding: 12,
  cardHeight: 84,
  cardGap: 8,
  // addButtonHeight: 28, // Removed
  // addButtonGap: 8,     // Removed
  boardPaddingBottom: 24,
};

const dragThreshold = 4;

type Rect = { x: number; y: number; width: number; height: number };

type RectMap = {
  cards: Map<number, Rect>;
  cells: Map<string, Rect>;
  addButtons: Map<string, Rect>;
  deleteButtons: Map<number, Rect>;
  editButtons: Map<number, Rect>;
};

type CanvasTheme = {
  bgMain: string;
  surface: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  primary: string;
  danger: string;
  warn: string;
  warnBg: string;
  dangerBg: string;
  shadow: string;
  noteColors: string[];
  columnBgs: string[];
};

type DragState = {
  issueId: number;
  start: { x: number; y: number };
  current: { x: number; y: number };
  origin: { statusId: number; laneId: string | number };
  dragging: boolean;
  targetCellKey: string | null;
};

type HitResult =
  | { kind: 'card'; issueId: number }
  | { kind: 'add'; statusId: number; laneId: string | number }
  | { kind: 'delete'; issueId: number }
  | { kind: 'edit'; issueId: number }
  | { kind: 'cell'; statusId: number; laneId: string | number }
  | { kind: 'empty' };

type Props = {
  data: BoardData;
  state: BoardState;
  canMove: boolean;
  canCreate: boolean;
  onCommand: (command: BoardCommand) => void;
  onCreate: (ctx: { statusId: number; laneId?: string | number }) => void;
  onCardOpen: (issueId: number) => void;
  onDelete: (issueId: number) => void;
  onEditClick: (editUrl: string) => void;
  labels: Record<string, string>;
};

export function CanvasBoard({
  data,
  state,
  canMove,
  canCreate,
  onCommand,
  onCreate,
  onCardOpen,
  onDelete,
  onEditClick,
  labels,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rectMapRef = useRef<RectMap>({
    cards: new Map(),
    cells: new Map(),
    addButtons: new Map(),
    deleteButtons: new Map(),
    editButtons: new Map(),
  });
  const scrollRef = useRef({ x: 0, y: 0 });
  const boardSizeRef = useRef({ width: 0, height: 0 });
  const dragRef = useRef<DragState | null>(null);
  const renderHandle = useRef<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [cursor, setCursor] = useState('default');

  const laneType = data.meta.lane_type;

  const layout = useMemo(() => computeLayout(state, data, canCreate), [state, data, canCreate]);

  const theme = useMemo(() => readTheme(containerRef.current), [size.width, size.height]);


  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const next = {
          width: Math.floor(entry.contentRect.width),
          height: Math.floor(entry.contentRect.height),
        };
        setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    scheduleRender();
    return () => {
      if (renderHandle.current !== null) {
        cancelAnimationFrame(renderHandle.current);
        renderHandle.current = null;
      }
    };
  }, [size, state, data.meta, canCreate, canMove, theme]);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.style.cursor = cursor;
  }, [cursor]);

  useEffect(() => {
    // Re-render when fonts are loaded (important for Canvas icons)
    void document.fonts.ready.then(() => {
      scheduleRender();
    });
  }, []);

  const scheduleRender = () => {
    if (renderHandle.current !== null) return;
    renderHandle.current = requestAnimationFrame(() => {
      renderHandle.current = null;
      draw();
    });
  };

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, size.width, size.height);
    ctx.fillStyle = theme.bgMain;
    ctx.fillRect(0, 0, size.width, size.height);

    const scroll = scrollRef.current;
    const viewRect = { x: scroll.x, y: scroll.y, width: size.width, height: size.height };
    // use memoized layout
    boardSizeRef.current = { width: layout.boardWidth, height: layout.boardHeight };

    rectMapRef.current = {
      cards: new Map(),
      cells: new Map(),
      addButtons: new Map(),
      deleteButtons: new Map(),
      editButtons: new Map(),
    };

    ctx.save();
    ctx.translate(-scroll.x, -scroll.y);
    const layoutLabels = { stagnation: labels.stagnation, add: labels.add };

    drawHeaders(ctx, layout, state.columns, theme, data.meta);

    drawCells(
      ctx,
      layout,
      state,
      data,
      viewRect,
      theme,
      canCreate,
      canMove,
      rectMapRef.current,
      dragRef.current,
      labels
    );

    if (laneType !== 'none') {
      drawLaneLabels(ctx, layout, state.lanes, theme, canCreate, state.columns[0]?.id, rectMapRef.current, labels);
    }

    drawDragOverlay(ctx, state, data, theme, dragRef.current, labels);

    ctx.restore();
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const deltaX = event.shiftKey ? event.deltaY : event.deltaX;
    const deltaY = event.shiftKey ? 0 : event.deltaY;
    const nextX = scrollRef.current.x + deltaX;
    const nextY = scrollRef.current.y + deltaY;
    updateScroll(nextX, nextY);
  };

  const updateScroll = (x: number, y: number) => {
    const board = boardSizeRef.current;
    const maxX = Math.max(0, board.width - size.width);
    const maxY = Math.max(0, board.height - size.height);
    scrollRef.current = {
      x: clamp(x, 0, maxX),
      y: clamp(y, 0, maxY),
    };
    scheduleRender();
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = toBoardPoint(event, scrollRef.current, canvasRef.current);
    const hit = hitTest(point, rectMapRef.current, state, data);

    if (hit.kind === 'add') {
      onCreate({ statusId: hit.statusId, laneId: hit.laneId });
      return;
    }

    if (hit.kind === 'delete') {
      onDelete(hit.issueId);
      return;
    }

    if (hit.kind === 'edit') {
      const issue = state.cardsById.get(hit.issueId);
      if (issue) onEditClick(issue.urls.issue_edit);
      return;
    }

    if (hit.kind === 'card') {
      const issue = state.cardsById.get(hit.issueId);
      if (!issue) return;
      const originLaneId = resolveLaneId(data, issue);
      dragRef.current = {
        issueId: hit.issueId,
        start: point,
        current: point,
        origin: { statusId: issue.status_id, laneId: originLaneId },
        dragging: false,
        targetCellKey: null,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    dragRef.current = null;
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = toBoardPoint(event, scrollRef.current, canvasRef.current);
    const drag = dragRef.current;

    if (!drag) {
      const hit = hitTest(point, rectMapRef.current, state, data);
      if (hit.kind === 'card') {
        setCursor(canMove ? 'grab' : 'pointer');
      } else if (hit.kind === 'add' || hit.kind === 'delete' || hit.kind === 'edit') {
        setCursor('pointer');
      } else {
        setCursor('default');
      }
      return;
    }

    drag.current = point;
    if (!drag.dragging) {
      const dx = Math.abs(point.x - drag.start.x);
      const dy = Math.abs(point.y - drag.start.y);
      if (dx + dy >= dragThreshold) {
        drag.dragging = true;
      }
    }

    if (drag.dragging) {
      const hit = hitTestCell(point, rectMapRef.current, data);
      drag.targetCellKey = hit ? cellKey(hit.statusId, hit.laneId) : null;
      setCursor('grabbing');
    }

    scheduleRender();
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = toBoardPoint(event, scrollRef.current, canvasRef.current);
    const drag = dragRef.current;
    if (!drag) return;

    if (drag.dragging) {
      const hit = hitTestCell(point, rectMapRef.current, data);
      if (hit && canMove) {
        const assignedToId = laneIdToAssignee(data, hit.laneId);
        onCommand({
          type: 'move_issue',
          issueId: drag.issueId,
          statusId: hit.statusId,
          laneId: hit.laneId,
          assignedToId,
        });
      }
    } else {
      onCardOpen(drag.issueId);
    }

    dragRef.current = null;
    setCursor('default');
    scheduleRender();
  };

  return (
    <div
      ref={containerRef}
      className="rk-canvas-board"
      onWheel={handleWheel}
      role="region"
      aria-label={labels.board || 'かんばんボード'}
    >
      <canvas
        ref={canvasRef}
        className="rk-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          dragRef.current = null;
          setCursor('default');
        }}
      />
    </div>
  );
}

function computeLayout(state: BoardState, data: BoardData, canCreate: boolean) {
  const columnCount = state.columnOrder.length;
  const gridStartX = data.meta.lane_type === 'none' ? 0 : metrics.laneHeaderWidth;
  const gridWidth =
    columnCount * metrics.columnWidth + Math.max(0, columnCount - 1) * metrics.columnGap;
  const headerHeight = metrics.headerHeight;
  const lanes = data.meta.lane_type === 'none' ? ['none'] : state.laneOrder;

  let currentY = headerHeight;
  const laneLayouts = lanes.map((laneId) => {
    const laneHeight = computeLaneHeight(state, data, laneId, canCreate);
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
  };
}

function computeLaneHeight(
  state: BoardState,
  data: BoardData,
  laneId: string | number,
  canCreate: boolean
) {
  let maxCellHeight = 0;

  for (const statusId of state.columnOrder) {
    const key = cellKey(statusId, laneId);
    const count = state.cardsByCell.get(key)?.length ?? 0;
    const height = cellContentHeight(count, canCreate);
    maxCellHeight = Math.max(maxCellHeight, height);
  }

  if (data.meta.lane_type === 'none') return maxCellHeight;
  return Math.max(maxCellHeight, metrics.laneTitleHeight);
}

function cellContentHeight(cardCount: number, _canCreate: boolean) {
  // const createHeight = canCreate ? metrics.addButtonHeight + metrics.addButtonGap : 0;
  const cardsHeight =
    cardCount === 0
      ? 0
      : cardCount * metrics.cardHeight + Math.max(0, cardCount - 1) * metrics.cardGap;
  return metrics.cellPadding * 2 + cardsHeight;
}

function drawHeaders(
  ctx: CanvasRenderingContext2D,
  layout: ReturnType<typeof computeLayout>,
  columns: Column[],
  theme: CanvasTheme,
  meta: BoardData['meta']
) {
  ctx.save();
  ctx.fillStyle = theme.surface;
  ctx.fillRect(0, 0, layout.gridStartX + layout.gridWidth, layout.headerHeight);
  ctx.strokeStyle = theme.border;
  ctx.beginPath();
  ctx.moveTo(0, layout.headerHeight + 0.5);
  ctx.lineTo(layout.gridStartX + layout.gridWidth, layout.headerHeight + 0.5);
  ctx.stroke();

  ctx.font = '600 14px Inter, sans-serif';
  ctx.textBaseline = 'middle';
  columns.forEach((column, index) => {
    const x = layout.gridStartX + index * metrics.columnWidth;
    const colBg = theme.columnBgs[index % theme.columnBgs.length];
    ctx.fillStyle = colBg;
    ctx.fillRect(x, 0, metrics.columnWidth, layout.headerHeight);
    const limit = column.wip_limit ?? null;
    const count = column.count ?? 0;
    const over = limit && count > limit;

    const icon = getStatusIcon(column.name);
    let currentX = x + 12;

    // Icon
    ctx.font = '16px "Material Symbols Outlined", sans-serif';
    ctx.fillStyle = theme.textSecondary;
    ctx.fillText(icon, currentX, layout.headerHeight / 2);
    currentX += 24;

    // Column Name
    ctx.font = '600 14px Inter, sans-serif';
    ctx.fillStyle = theme.textPrimary;
    ctx.fillText(column.name, currentX, layout.headerHeight / 2);

    // WIP Badge
    ctx.font = '500 11px Inter, sans-serif';
    const badgeText = limit ? `${count} / ${limit}` : String(count);
    const badgeWidth = ctx.measureText(badgeText).width + 10;
    const badgeHeight = 18;
    const badgeX = x + metrics.columnWidth - badgeWidth - 12;
    const badgeY = (layout.headerHeight - badgeHeight) / 2;
    ctx.fillStyle = over ? theme.dangerBg : 'rgba(255, 255, 255, 0.5)';
    ctx.strokeStyle = over ? theme.danger : theme.border;
    roundedRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = over ? theme.danger : theme.textSecondary;
    ctx.textAlign = 'center';
    ctx.fillText(badgeText, badgeX + badgeWidth / 2, badgeY + badgeHeight / 2);
    ctx.textAlign = 'left';

    // Vertical boundary line
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + metrics.columnWidth, 0);
    ctx.lineTo(x + metrics.columnWidth, layout.headerHeight);
    ctx.stroke();
  });
  ctx.restore();
}

function drawLaneLabels(
  ctx: CanvasRenderingContext2D,
  layout: ReturnType<typeof computeLayout>,
  lanes: Lane[],
  theme: CanvasTheme,
  canCreate: boolean,
  defaultStatusId: number | undefined,
  rectMap: RectMap | undefined,
  labels: Record<string, string>
) {
  ctx.save();
  ctx.font = '600 13px Inter, sans-serif';
  ctx.textBaseline = 'middle';
  lanes.forEach((lane, index) => {
    const laneLayout = layout.laneLayouts[index];
    if (!laneLayout) return;
    ctx.fillStyle = theme.surface;
    ctx.fillRect(0, laneLayout.y, metrics.laneHeaderWidth, laneLayout.height);
    ctx.fillStyle = theme.textPrimary;
    ctx.fillText(lane.name, 12, laneLayout.y + metrics.laneTitleHeight / 2);
    ctx.strokeStyle = theme.border;
    ctx.beginPath();
    ctx.moveTo(metrics.laneHeaderWidth + 0.5, laneLayout.y);
    ctx.lineTo(metrics.laneHeaderWidth + 0.5, laneLayout.y + laneLayout.height);
    // Draw bottom border
    ctx.moveTo(0, laneLayout.y + laneLayout.height);
    ctx.lineTo(metrics.laneHeaderWidth, laneLayout.y + laneLayout.height);
    ctx.stroke();

    if (canCreate && defaultStatusId !== undefined) {
      const buttonWidth = 24;
      const buttonHeight = 24;
      const buttonX = metrics.laneHeaderWidth - buttonWidth - 8; // Right aligned
      const buttonY = laneLayout.y + (metrics.laneTitleHeight - buttonHeight) / 2;
      const addRect = { x: buttonX, y: buttonY, width: buttonWidth, height: buttonHeight };
      const key = cellKey(defaultStatusId, lane.id); // Use default status (first column)
      if (rectMap) rectMap.addButtons.set(key, addRect);

      drawIconBox(ctx, addRect, theme.textSecondary, '+');
    }
  });
  ctx.restore();
}

function drawCells(
  ctx: CanvasRenderingContext2D,
  layout: ReturnType<typeof computeLayout>,
  state: BoardState,
  data: BoardData,
  viewRect: Rect,
  theme: CanvasTheme,
  canCreate: boolean,
  canMove: boolean,
  rectMap: RectMap,
  drag: DragState | null,
  labels: Record<string, string>
) {
  const columns = state.columnOrder;

  ctx.save();
  ctx.font = '500 12px Inter, sans-serif';
  ctx.textBaseline = 'top';

  layout.laneLayouts.forEach((laneLayout) => {
    const laneId = laneLayout.laneId;
    const laneContentY = laneLayout.y;
    const laneHeight = laneLayout.height;

    if (!rectIntersects({ x: 0, y: laneLayout.y, width: layout.gridStartX + layout.gridWidth, height: laneLayout.height }, viewRect)) {
      return;
    }

    columns.forEach((statusId, colIndex) => {
      const colX = layout.gridStartX + colIndex * (metrics.columnWidth + metrics.columnGap);
      const cellRect = {
        x: colX,
        y: laneContentY,
        width: metrics.columnWidth,
        height: laneHeight,
      };

      if (!rectIntersects(cellRect, viewRect)) return;

      const key = cellKey(statusId, laneId);
      rectMap.cells.set(key, cellRect);

      const colBg = theme.columnBgs[colIndex % theme.columnBgs.length];
      const isTarget = drag?.dragging && drag.targetCellKey === key;
      ctx.fillStyle = isTarget ? '#e0f2fe' : colBg;
      ctx.fillRect(cellRect.x, cellRect.y, cellRect.width, cellRect.height);

      // Grid lines (stronger)
      ctx.strokeStyle = theme.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      // Right border
      ctx.moveTo(cellRect.x + cellRect.width, cellRect.y);
      ctx.lineTo(cellRect.x + cellRect.width, cellRect.y + cellRect.height);
      // Bottom border
      ctx.moveTo(cellRect.x, cellRect.y + cellRect.height);
      ctx.lineTo(cellRect.x + cellRect.width, cellRect.y + cellRect.height);
      ctx.stroke();

      let cursorY = cellRect.y + metrics.cellPadding;

      // Removed Add Button loop for cells

      const cardIds = state.cardsByCell.get(key) ?? [];
      const cardStartY = cursorY;
      const cardStride = metrics.cardHeight + metrics.cardGap;
      const visibleStart = Math.max(0, Math.floor((viewRect.y - cardStartY) / cardStride));
      const visibleEnd = Math.min(
        cardIds.length,
        Math.ceil((viewRect.y + viewRect.height - cardStartY) / cardStride)
      );

      for (let index = visibleStart; index < visibleEnd; index += 1) {
        const cardId = cardIds[index];
        const issue = state.cardsById.get(cardId);
        if (!issue) continue;
        const cardY = cardStartY + index * cardStride;
        const cardRect = {
          x: cellRect.x + metrics.cellPadding,
          y: cardY,
          width: cellRect.width - metrics.cellPadding * 2,
          height: metrics.cardHeight,
        };
        rectMap.cards.set(issue.id, cardRect);
        drawCard(ctx, cardRect, issue, data, theme, canMove, labels, rectMap);
      }
    });
  });

  ctx.restore();
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  issue: Issue,
  data: BoardData,
  theme: CanvasTheme,
  canMove: boolean,
  labels: Record<string, string>,
  rectMap?: RectMap
) {
  const column = data.columns.find((c) => c.id === issue.status_id);
  const isClosed = !!column?.is_closed;
  const agingEnabled = !(data.meta.aging_exclude_closed && isClosed);
  const agingDays = issue.aging_days ?? 0;
  const agingClass = agingEnabled
    ? agingDays >= data.meta.aging_danger_days
      ? 'danger'
      : agingDays >= data.meta.aging_warn_days
        ? 'warn'
        : 'none'
    : 'none';

  ctx.save();
  const radius = 2;
  const curlSize = 15;
  const x = rect.x;
  const y = rect.y;
  const w = rect.width;
  const h = rect.height;

  // 1. Draw Card Shadow (Pronounced)
  ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 3;

  // 2. Draw Main Body (with corner cut for curl)
  ctx.fillStyle = getCardColor(issue.tracker_id, theme);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - curlSize);
  ctx.lineTo(x + w - curlSize, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();

  // Reset shadow for drawing on top of card
  ctx.shadowColor = 'transparent';

  // 3. Draw Curled Corner
  // Shadow under the curl flap
  ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
  ctx.beginPath();
  ctx.moveTo(x + w - curlSize, y + h);
  ctx.lineTo(x + w, y + h - curlSize);
  ctx.lineTo(x + w - curlSize, y + h - curlSize);
  ctx.closePath();
  ctx.fill();

  // The curled flap itself
  ctx.fillStyle = getCardColor(issue.tracker_id, theme);
  ctx.beginPath();
  ctx.moveTo(x + w - curlSize, y + h);
  ctx.bezierCurveTo(x + w - curlSize / 2, y + h - curlSize / 4, x + w - curlSize / 4, y + h - curlSize / 2, x + w, y + h - curlSize);
  ctx.lineTo(x + w - radius, y + h - radius); // Slight overlap
  ctx.closePath();
  ctx.fill();

  // Highlight on curl
  ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.fill();

  // 4. Draw Tape at the top center
  const tapeW = 40;
  const tapeH = 12;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)'; // Semi-transparent tape
  ctx.fillRect(x + (w - tapeW) / 2, y - tapeH / 2, tapeW, tapeH);
  // Tape texture
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 1;
  for (let i = 0; i < tapeW; i += 4) {
    ctx.beginPath();
    ctx.moveTo(x + (w - tapeW) / 2 + i, y - tapeH / 2);
    ctx.lineTo(x + (w - tapeW) / 2 + i, y + tapeH / 2);
    ctx.stroke();
  }

  const title = `#${issue.id} ${issue.subject}`;
  ctx.fillStyle = theme.textPrimary;
  ctx.font = '600 13px Inter, sans-serif';
  ctx.fillText(truncateText(ctx, title, rect.width - 16), rect.x + 8, rect.y + 8);

  ctx.font = '500 12px Inter, sans-serif';
  ctx.fillStyle = theme.textSecondary;
  const dueLabel = issue.due_date ?? labels.not_set;
  ctx.fillText(`${labels.issue_due_date}: ${dueLabel}`, rect.x + 8, rect.y + 32);

  const agingLabel = `${agingDays}d`;
  ctx.fillStyle = agingClass === 'danger' ? theme.danger : agingClass === 'warn' ? theme.warn : theme.textSecondary;
  ctx.fillText(`${labels.stagnation}: ${agingLabel}`, rect.x + 8, rect.y + 50);

  if (issue.priority_name) {
    ctx.fillStyle = theme.textSecondary;
    ctx.fillText(`${labels.issue_priority}: ${issue.priority_name}`, rect.x + 8, rect.y + 66);
  }

  const editRect = {
    x: rect.x + rect.width - 42,
    y: rect.y + 8,
    width: 16,
    height: 16,
  };
  if (rectMap) rectMap.editButtons.set(issue.id, editRect);
  drawIconBox(ctx, editRect, theme.primary, '✎');

  if (data.meta.can_delete) {
    const deleteRect = {
      x: rect.x + rect.width - 20,
      y: rect.y + 8,
      width: 16,
      height: 16,
    };
    if (rectMap) rectMap.deleteButtons.set(issue.id, deleteRect);
    drawIconBox(ctx, deleteRect, theme.danger, '×');
  }

  if (canMove) {
    ctx.strokeStyle = theme.border;
  }

  ctx.restore();
}

function drawAddButton(ctx: CanvasRenderingContext2D, rect: Rect, theme: CanvasTheme, label: string) {
  ctx.save();
  ctx.strokeStyle = theme.border;
  ctx.fillStyle = '#f8fafc';
  roundedRect(ctx, rect.x, rect.y, rect.width, rect.height, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = theme.textSecondary;
  ctx.font = '600 12px Inter, sans-serif';
  ctx.textBaseline = 'middle';
  const textWidth = ctx.measureText(label).width;
  ctx.fillText(label, rect.x + (rect.width - textWidth) / 2, rect.y + rect.height / 2);
  ctx.restore();
}

function drawIconBox(ctx: CanvasRenderingContext2D, rect: Rect, color: string, label: string) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = color;
  roundedRect(ctx, rect.x, rect.y, rect.width, rect.height, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = '700 10px Inter, sans-serif';
  ctx.textBaseline = 'middle';
  const textWidth = ctx.measureText(label).width;
  ctx.fillText(label, rect.x + (rect.width - textWidth) / 2, rect.y + rect.height / 2 + 0.5);
  ctx.restore();
}

function drawDragOverlay(
  ctx: CanvasRenderingContext2D,
  state: BoardState,
  data: BoardData,
  theme: CanvasTheme,
  drag: DragState | null,
  labels: Record<string, string>
) {
  if (!drag || !drag.dragging) return;
  const issue = state.cardsById.get(drag.issueId);
  if (!issue) return;
  const offsetX = 20;
  const offsetY = 20;
  const rect = {
    x: drag.current.x - offsetX,
    y: drag.current.y - offsetY,
    width: metrics.columnWidth - metrics.cellPadding * 2,
    height: metrics.cardHeight,
  };
  ctx.save();
  ctx.globalAlpha = 0.9;
  drawCard(ctx, rect, issue, data, theme, true, labels);
  ctx.restore();
}

function hitTest(
  point: { x: number; y: number },
  rectMap: RectMap,
  state: BoardState,
  data: BoardData
): HitResult {
  for (const [issueId, rect] of rectMap.deleteButtons) {
    if (pointInRect(point, rect)) return { kind: 'delete', issueId };
  }
  for (const [issueId, rect] of rectMap.editButtons) {
    if (pointInRect(point, rect)) return { kind: 'edit', issueId };
  }
  for (const [issueId, rect] of rectMap.cards) {
    if (pointInRect(point, rect)) return { kind: 'card', issueId };
  }
  for (const [key, rect] of rectMap.addButtons) {
    if (pointInRect(point, rect)) {
      const [statusId, laneId] = parseCellKey(key, data);
      return { kind: 'add', statusId, laneId };
    }
  }
  for (const [key, rect] of rectMap.cells) {
    if (pointInRect(point, rect)) {
      const [statusId, laneId] = parseCellKey(key, data);
      return { kind: 'cell', statusId, laneId };
    }
  }
  return { kind: 'empty' };
}

function hitTestCell(
  point: { x: number; y: number },
  rectMap: RectMap,
  data: BoardData
): { statusId: number; laneId: string | number } | null {
  for (const [key, rect] of rectMap.cells) {
    if (pointInRect(point, rect)) {
      const [statusId, laneId] = parseCellKey(key, data);
      return { statusId, laneId };
    }
  }
  return null;
}

function getStatusIcon(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('新') || n.includes('todo') || n.includes('未')) return '\ue8b6'; // search/check_circle -> using search as placeholder for "new/find"
  if (n.includes('進') || n.includes('作業') || n.includes('doing')) return '\ue869'; // build
  if (n.includes('認') || n.includes('レビュー')) return '\ue877'; // visibility
  if (n.includes('終') || n.includes('完了') || n.includes('done')) return '\ue86c'; // check_circle
  if (n.includes('却') || n.includes('却下')) return '\ue14b'; // cancel
  if (n.includes('留') || n.includes('保留')) return '\ue034'; // pause
  return '\ue8d2'; // description (default)
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && ctx.measureText(t + '...').width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + '...';
}

function parseCellKey(key: string, data: BoardData): [number, string | number] {
  const [status, lane] = key.split(':');
  const statusId = Number(status);
  if (data.meta.lane_type === 'none') return [statusId, 'none'];
  if (lane === 'unassigned') return [statusId, 'unassigned'];
  const parsedLane = Number(lane);
  return [statusId, Number.isFinite(parsedLane) ? parsedLane : lane];
}

function resolveLaneId(data: BoardData, issue: Issue): string | number {
  if (data.meta.lane_type === 'assignee') return issue.assigned_to_id ?? 'unassigned';
  return 'none';
}

function laneIdToAssignee(data: BoardData, laneId: string | number): number | null {
  if (data.meta.lane_type !== 'assignee') return null;
  if (laneId === 'unassigned') return null;
  const parsed = Number(laneId);
  return Number.isFinite(parsed) ? parsed : null;
}

function pointInRect(point: { x: number; y: number }, rect: Rect) {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function rectIntersects(a: Rect, b: Rect) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function toBoardPoint(
  event: React.PointerEvent,
  scroll: { x: number; y: number },
  canvas: HTMLCanvasElement | null
) {
  const rect = canvas?.getBoundingClientRect();
  const offsetX = rect ? event.clientX - rect.left : event.clientX;
  const offsetY = rect ? event.clientY - rect.top : event.clientY;
  return {
    x: offsetX + scroll.x,
    y: offsetY + scroll.y,
  };
}

// Helper to get consistent color for tracker
function getCardColor(trackerId: number, theme: CanvasTheme): string {
  // Simple module hash to pick a color
  const index = trackerId % theme.noteColors.length;
  return theme.noteColors[index];
}

function readTheme(container: HTMLDivElement | null): CanvasTheme {
  const fallback = {
    bgMain: '#f8fafc',
    surface: '#ffffff',
    border: '#e2e8f0',
    textPrimary: '#1e293b',
    textSecondary: '#64748b',
    primary: '#4f46e5',
    danger: '#ef4444',
    warn: '#f59e0b',
    warnBg: '#fffbeb',
    dangerBg: '#fef2f2',
    shadow: 'rgba(15, 23, 42, 0.12)',
    noteColors: ['#bef264', '#fdba74', '#93c5fd', '#f9a8d4', '#fde047', '#d8b4fe', '#5eead4'],
    columnBgs: ['#f1f5f9', '#eff6ff', '#fefce8', '#f0fdf4', '#faf5ff', '#fff7ed', '#fdf2f8'],
  };
  if (!container) return fallback;
  const styles = getComputedStyle(container);
  return {
    bgMain: styles.getPropertyValue('--rk-bg-main').trim() || fallback.bgMain,
    surface: styles.getPropertyValue('--rk-bg-surface').trim() || fallback.surface,
    border: styles.getPropertyValue('--rk-border').trim() || fallback.border,
    textPrimary: styles.getPropertyValue('--rk-text-primary').trim() || fallback.textPrimary,
    textSecondary: styles.getPropertyValue('--rk-text-secondary').trim() || fallback.textSecondary,
    primary: styles.getPropertyValue('--rk-primary').trim() || fallback.primary,
    danger: styles.getPropertyValue('--rk-danger').trim() || fallback.danger,
    warn: styles.getPropertyValue('--rk-warn').trim() || fallback.warn,
    warnBg: styles.getPropertyValue('--rk-warn-bg').trim() || fallback.warnBg,
    dangerBg: styles.getPropertyValue('--rk-danger-bg').trim() || fallback.dangerBg,
    shadow: fallback.shadow,
    noteColors: [
      styles.getPropertyValue('--rk-note-lime').trim() || '#bef264',
      styles.getPropertyValue('--rk-note-orange').trim() || '#fdba74',
      styles.getPropertyValue('--rk-note-blue').trim() || '#93c5fd',
      styles.getPropertyValue('--rk-note-pink').trim() || '#f9a8d4',
      styles.getPropertyValue('--rk-note-yellow').trim() || '#fde047',
      styles.getPropertyValue('--rk-note-purple').trim() || '#d8b4fe',
      styles.getPropertyValue('--rk-note-teal').trim() || '#5eead4',
    ],
    columnBgs: [
      styles.getPropertyValue('--rk-col-bg-1').trim() || '#f1f5f9',
      styles.getPropertyValue('--rk-col-bg-2').trim() || '#eff6ff',
      styles.getPropertyValue('--rk-col-bg-3').trim() || '#fefce8',
      styles.getPropertyValue('--rk-col-bg-4').trim() || '#f0fdf4',
      styles.getPropertyValue('--rk-col-bg-5').trim() || '#faf5ff',
      styles.getPropertyValue('--rk-col-bg-6').trim() || '#fff7ed',
      styles.getPropertyValue('--rk-col-bg-7').trim() || '#fdf2f8',
    ],
  };
}
