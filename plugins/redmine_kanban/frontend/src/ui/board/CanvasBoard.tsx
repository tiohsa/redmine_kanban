import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { BoardData, Column, Issue, Lane, Subtask } from '../types';
import type { BoardCommand } from './commands';
import type { BoardState } from './state';
import { cellKey } from './state';

const metrics = {
  columnWidth: 260,
  columnGap: 0,
  laneHeaderWidth: 120, // 160 -> 120
  headerHeight: 40,    // 56 -> 40
  laneTitleHeight: 32, // 40 -> 32
  laneGap: 0,
  cellPadding: 12,
  cardBaseHeight: 84, // Changed from cardHeight to cardBaseHeight
  subtaskHeight: 24,  // Height per subtask
  cardGap: 10,        // 8 -> 10, More breathing room
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
  subtaskChecks: Map<string, Rect>; // key: "issueId:subtaskId"
  subtaskSubjects: Map<string, Rect>; // key: "issueId:subtaskId"
  cardSubjects: Map<number, Rect>; // key: issueId
  infoButtons: Map<number, Rect>;
};

type CanvasTheme = {
  bgMain: string;
  surface: string;
  border: string;
  borderStrong: string;
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
  badgeBg: string;
  badgeText: string;
  badgeLowBg: string;
  badgeLowColor: string;
  badgeHighBg: string; // Yellow
  badgeHighColor: string;
  badgeUrgentBg: string; // Orange
  badgeUrgentColor: string;
  badgeImmediateBg: string; // Red
  badgeImmediateColor: string;
  badgeOverdueBg: string;
  badgeOverdueColor: string;
  badgeWarnBg: string;
  badgeWarnColor: string;
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
  | { kind: 'subtask_check'; issueId: number; subtaskId: number }
  | { kind: 'subtask_subject'; issueId: number; subtaskId: number }
  | { kind: 'card_subject'; issueId: number }
  | { kind: 'info'; issueId: number }
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
  onSubtaskToggle?: (subtaskId: number, currentClosed: boolean) => void;
  labels: Record<string, string>;
  fitMode?: 'none' | 'width';
  updatingIssueIds?: Set<number>;
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
  onSubtaskToggle,
  labels,
  fitMode = 'none',
  updatingIssueIds,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rectMapRef = useRef<RectMap>({
    cards: new Map(),
    cells: new Map(),
    addButtons: new Map(),
    deleteButtons: new Map(),
    editButtons: new Map(),
    subtaskChecks: new Map(),
    subtaskSubjects: new Map(),
    cardSubjects: new Map(),
    infoButtons: new Map(),
  });
  const scrollRef = useRef({ x: 0, y: 0 });
  const boardSizeRef = useRef({ width: 0, height: 0 });
  const dragRef = useRef<DragState | null>(null);
  const renderHandle = useRef<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [cursor, setCursor] = useState('default');
  const scaleRef = useRef(1);
  const hoverRef = useRef<{ kind: 'card_subject' | 'subtask_subject'; id: string } | null>(null);

  const laneType = data.meta.lane_type;

  const layout = useMemo(() => computeLayout(state, data, canCreate), [state, data, canCreate]);

  const theme = useMemo(() => readTheme(containerRef.current), [size.width, size.height]);

  // Scale calculation is now handled directly in draw() to ensure it's always in sync with the latest layout and size.
  useEffect(() => {
    scheduleRender();
  }, [fitMode]);

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
  }, [size, state, data.meta, canCreate, canMove, theme, updatingIssueIds]);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.style.cursor = cursor;
  }, [cursor]);

  useEffect(() => {
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

    boardSizeRef.current = { width: layout.boardWidth, height: layout.boardHeight };

    // Update scale before drawing
    if (fitMode === 'width' && size.width > 0 && layout.boardWidth > 0) {
      const nextScale = Math.min(size.width / layout.boardWidth, 1);
      if (isFinite(nextScale) && nextScale > 0) {
        scaleRef.current = nextScale;
      }
      scrollRef.current.x = 0;
    } else if (fitMode === 'none') {
      scaleRef.current = 1;
    }

    const scale = scaleRef.current;
    const scroll = scrollRef.current;

    const viewRect = {
      x: scroll.x / scale,
      y: scroll.y / scale,
      width: size.width / scale,
      height: size.height / scale
    };

    rectMapRef.current = {
      cards: new Map(),
      cells: new Map(),
      addButtons: new Map(),
      deleteButtons: new Map(),
      editButtons: new Map(),
      subtaskChecks: new Map(),
      subtaskSubjects: new Map(),
      cardSubjects: new Map(),
      infoButtons: new Map(),
    };

    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(-scroll.x, -scroll.y);

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
      labels,
      hoverRef.current,
      updatingIssueIds
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
    const scale = scaleRef.current;
    const visibleW = size.width / scale;
    const visibleH = size.height / scale;
    const maxX = Math.max(0, board.width - visibleW);
    const maxY = Math.max(0, board.height - visibleH);

    scrollRef.current = {
      x: clamp(x, 0, maxX),
      y: clamp(y, 0, maxY),
    };
    scheduleRender();
  };

  function toBoardPoint(
    event: React.PointerEvent,
    scroll: { x: number; y: number },
    canvas: HTMLCanvasElement | null,
    scale: number = 1
  ) {
    const rect = canvas?.getBoundingClientRect();
    const clientX = event.clientX;
    const clientY = event.clientY;
    const offsetX = rect ? clientX - rect.left : clientX;
    const offsetY = rect ? clientY - rect.top : clientY;

    return {
      x: offsetX / scale + scroll.x,
      y: offsetY / scale + scroll.y,
    };
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = toBoardPoint(event, scrollRef.current, canvasRef.current, scaleRef.current);
    const hit = hitTest(point, rectMapRef.current, state, data);

    if (hit.kind === 'subtask_check') {
      // Prevent toggling if parent issue is updating
      if (updatingIssueIds?.has(hit.issueId)) return;

      const issue = state.cardsById.get(hit.issueId);
      if (issue && onSubtaskToggle) {
        const subtask = issue.subtasks?.find(s => s.id === hit.subtaskId);
        if (subtask) {
          onSubtaskToggle(hit.subtaskId, subtask.is_closed);
        }
      }
      return;
    }

    if (hit.kind === 'subtask_subject') {
      onCardOpen(hit.subtaskId);
      return;
    }

    if (hit.kind === 'card_subject') {
      onCardOpen(hit.issueId);
      return;
    }

    if (hit.kind === 'info') {
      const issue = state.cardsById.get(hit.issueId);
      if (issue) {
        if (issue.parent_id) {
          const parentUrl = issue.urls.issue.replace(/\/\d+$/, `/${issue.parent_id}`);
          onEditClick(parentUrl);
        } else {
          onEditClick(issue.urls.issue);
        }
      }
      return;
    }

    if (hit.kind === 'add') {
      onCreate({ statusId: hit.statusId, laneId: hit.laneId });
      return;
    }

    if (hit.kind === 'delete') {
      if (updatingIssueIds?.has(hit.issueId)) return;
      onDelete(hit.issueId);
      return;
    }

    if (hit.kind === 'edit') {
      if (updatingIssueIds?.has(hit.issueId)) return;
      const issue = state.cardsById.get(hit.issueId);
      if (issue) onEditClick(issue.urls.issue_edit);
      return;
    }

    if (hit.kind === 'card') {
      if (updatingIssueIds?.has(hit.issueId)) return;
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
    const point = toBoardPoint(event, scrollRef.current, canvasRef.current, scaleRef.current);
    const drag = dragRef.current;

    if (!drag) {
      const hit = hitTest(point, rectMapRef.current, state, data);
      let newHover: { kind: 'card_subject' | 'subtask_subject'; id: string } | null = null;

      if (hit.kind === 'card_subject') {
        setCursor('pointer');
        newHover = { kind: 'card_subject', id: String(hit.issueId) };
      } else if (hit.kind === 'subtask_subject') {
        setCursor('pointer');
        newHover = { kind: 'subtask_subject', id: `${hit.issueId}:${hit.subtaskId}` };
      } else if (hit.kind === 'card') {
        if (updatingIssueIds?.has(hit.issueId)) {
            setCursor('not-allowed');
        } else {
            setCursor(canMove ? 'grab' : 'pointer');
        }
      } else if (hit.kind === 'add' || hit.kind === 'delete' || hit.kind === 'edit' || hit.kind === 'subtask_check' || hit.kind === 'info') {
        setCursor('pointer');
      } else {
        setCursor('default');
      }

      // Update hover state and re-render if changed
      const currentHover = hoverRef.current;
      const hoverChanged = (currentHover?.kind !== newHover?.kind) || (currentHover?.id !== newHover?.id);
      if (hoverChanged) {
        hoverRef.current = newHover;
        scheduleRender();
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
    const point = toBoardPoint(event, scrollRef.current, canvasRef.current, scaleRef.current);
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
      // If we released on the same card and didn't drag, open it.
      // But check if we were clicking a button.
      // Since buttons are checked in PointerDown, this is fine.
      // But we should re-check hit to ensure we are still on the card.
      const hit = hitTest(point, rectMapRef.current, state, data);
      if (hit.kind === 'subtask_subject') {
        onCardOpen(hit.subtaskId);
      } else if (hit.kind === 'card' && hit.issueId === drag.issueId) {
        if (!updatingIssueIds?.has(drag.issueId)) {
            onCardOpen(drag.issueId);
        }
      }
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

function measureCardHeight(issue: Issue): number {
  let h = metrics.cardBaseHeight;
  if (issue.subtasks && issue.subtasks.length > 0) {
    h += 20; // Padding before subtasks (increased from 8)
    h += issue.subtasks.length * metrics.subtaskHeight;
  }
  return h;
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
    const cardIds = state.cardsByCell.get(key) ?? [];

    let height = metrics.cellPadding * 2;
    if (cardIds.length > 0) {
      for (const cardId of cardIds) {
        const issue = state.cardsById.get(cardId);
        if (issue) {
          height += measureCardHeight(issue);
        }
      }
      height += (cardIds.length - 1) * metrics.cardGap;
    }

    maxCellHeight = Math.max(maxCellHeight, height);
  }

  if (data.meta.lane_type === 'none') return maxCellHeight;
  return Math.max(maxCellHeight, metrics.laneTitleHeight);
}


function drawHeaders(
  ctx: CanvasRenderingContext2D,
  layout: ReturnType<typeof computeLayout>,
  columns: Column[],
  theme: CanvasTheme,
  meta: BoardData['meta']
) {
  ctx.save();
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, layout.gridStartX + layout.gridWidth, layout.headerHeight);

  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, layout.headerHeight - 0.5);
  ctx.lineTo(layout.gridStartX + layout.gridWidth, layout.headerHeight - 0.5);
  ctx.stroke();

  if (layout.gridStartX > 0) {
    ctx.beginPath();
    ctx.moveTo(layout.gridStartX, 0);
    ctx.lineTo(layout.gridStartX, layout.headerHeight);
    ctx.stroke();
  }

  ctx.font = '600 14px Inter, sans-serif';
  ctx.textBaseline = 'middle';

  columns.forEach((column, index) => {
    const x = layout.gridStartX + index * metrics.columnWidth;

    ctx.font = '600 13px Inter, sans-serif';
    ctx.fillStyle = theme.textPrimary;
    ctx.fillText(column.name, x + 12, layout.headerHeight / 2);

    const limit = column.wip_limit ?? null;
    const count = column.count ?? 0;
    const over = limit && count > limit;

    if (limit || count > 0) {
      ctx.font = '500 11px Inter, sans-serif';
      const badgeText = limit ? `${count} / ${limit}` : String(count);
      const badgeWidth = ctx.measureText(badgeText).width + 10;
      const badgeHeight = 18;
      const badgeX = x + metrics.columnWidth - badgeWidth - 12;
      const badgeY = (layout.headerHeight - badgeHeight) / 2;

      ctx.fillStyle = over ? theme.dangerBg : '#e2e8f0';
      ctx.strokeStyle = over ? theme.danger : 'transparent';
      if (over) ctx.lineWidth = 1;

      roundedRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 4);
      ctx.fill();
      if (over) ctx.stroke();

      ctx.fillStyle = over ? theme.danger : theme.textSecondary;
      ctx.textAlign = 'center';
      ctx.fillText(badgeText, badgeX + badgeWidth / 2, badgeY + badgeHeight / 2);
      ctx.textAlign = 'left';
    }

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
    ctx.font = '600 12px Inter, sans-serif'; // Slightly smaller font for narrower width
    ctx.fillText(lane.name, 8, laneLayout.y + metrics.laneTitleHeight / 2);

    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(metrics.laneHeaderWidth + 0.5, laneLayout.y);
    ctx.lineTo(metrics.laneHeaderWidth + 0.5, laneLayout.y + laneLayout.height);
    ctx.stroke();

    ctx.strokeStyle = theme.borderStrong;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, laneLayout.y + laneLayout.height);
    ctx.lineTo(metrics.laneHeaderWidth, laneLayout.y + laneLayout.height);
    ctx.stroke();
    ctx.lineWidth = 1;

    if (canCreate && defaultStatusId !== undefined) {
      const buttonWidth = 20;
      const buttonHeight = 20;
      const buttonX = metrics.laneHeaderWidth - buttonWidth - 6;
      const buttonY = laneLayout.y + (metrics.laneTitleHeight - buttonHeight) / 2;
      const addRect = { x: buttonX, y: buttonY, width: buttonWidth, height: buttonHeight };
      const key = cellKey(defaultStatusId, lane.id);
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
  labels: Record<string, string>,
  hover: { kind: 'card_subject' | 'subtask_subject'; id: string } | null,
  updatingIssueIds?: Set<number>
) {
  const columns = state.columnOrder;

  ctx.save();
  ctx.font = '500 12px Inter, sans-serif';
  ctx.textBaseline = 'top';

  layout.laneLayouts.forEach((laneLayout) => {
    if (!rectIntersects({ x: 0, y: laneLayout.y, width: layout.gridStartX + layout.gridWidth, height: laneLayout.height }, viewRect)) {
      return;
    }

    columns.forEach((statusId, colIndex) => {
      const colX = layout.gridStartX + colIndex * (metrics.columnWidth + metrics.columnGap);
      const cellRect = {
        x: colX,
        y: laneLayout.y,
        width: metrics.columnWidth,
        height: laneLayout.height,
      };

      if (!rectIntersects(cellRect, viewRect)) return;

      const key = cellKey(statusId, laneLayout.laneId);
      rectMap.cells.set(key, cellRect);

      const colBg = theme.columnBgs[colIndex % theme.columnBgs.length];
      const isTarget = drag?.dragging && drag.targetCellKey === key;
      ctx.fillStyle = isTarget ? '#e0f2fe' : colBg;
      ctx.fillRect(cellRect.x, cellRect.y, cellRect.width, cellRect.height);

      ctx.strokeStyle = theme.borderStrong;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cellRect.x, cellRect.y + cellRect.height);
      ctx.lineTo(cellRect.x + cellRect.width, cellRect.y + cellRect.height);
      ctx.stroke();

      ctx.strokeStyle = theme.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cellRect.x + cellRect.width, cellRect.y);
      ctx.lineTo(cellRect.x + cellRect.width, cellRect.y + cellRect.height);
      ctx.stroke();

      const cardIds = state.cardsByCell.get(key) ?? [];
      let currentY = cellRect.y + metrics.cellPadding;

      for (let index = 0; index < cardIds.length; index += 1) {
        const cardId = cardIds[index];
        const issue = state.cardsById.get(cardId);
        if (!issue) continue;

        const cardH = measureCardHeight(issue);
        const cardRect = {
          x: cellRect.x + metrics.cellPadding,
          y: currentY,
          width: cellRect.width - metrics.cellPadding * 2,
          height: cardH,
        };

        currentY += cardH + metrics.cardGap;

        if (rectIntersects(cardRect, viewRect)) {
          rectMap.cards.set(issue.id, cardRect);
          drawCard(
            ctx,
            cardRect,
            issue,
            data,
            theme,
            canMove,
            labels,
            rectMap,
            hover,
            updatingIssueIds
          );
        }
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
  rectMap?: RectMap,
  hover?: { kind: 'card_subject' | 'subtask_subject'; id: string } | null,
  updatingIssueIds?: Set<number>
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
  const radius = 6;
  const x = rect.x;
  const y = rect.y;
  const w = rect.width;
  const h = rect.height;

  // 1. Draw Card Shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.08)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;

  // 2. Draw Card Body
  ctx.fillStyle = theme.surface;
  roundedRect(ctx, x, y, w, h, radius);
  ctx.fill();

  ctx.shadowColor = 'transparent';

  // 3. Left Strip
  const stripWidth = 5;
  const trackerColor = getCardColor(issue.tracker_id, theme);
  ctx.fillStyle = trackerColor;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + stripWidth, y);
  ctx.lineTo(x + stripWidth, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.fill();

  const contentX = x + stripWidth + 8;
  const contentW = w - stripWidth - 16;

  // 4. Subject
  ctx.fillStyle = theme.textPrimary;
  ctx.font = '600 13px Inter, sans-serif';
  ctx.textBaseline = 'top';

  const subjectY = y + 8;
  const subject = issue.subject;
  const idText = `#${issue.id}`;
  const buttonAreaWidth = 52;
  const subjectText = truncateText(ctx, subject, contentW - buttonAreaWidth);
  const subjectTextWidth = ctx.measureText(subjectText).width;

  // Register subject area for hit testing
  const subjectRect = { x: contentX, y: subjectY, width: subjectTextWidth, height: 16 };
  if (rectMap) {
    rectMap.cardSubjects.set(issue.id, subjectRect);
  }

  // Draw subject with underline if hovered
  const isSubjectHovered = hover?.kind === 'card_subject' && hover.id === String(issue.id);
  ctx.fillText(subjectText, contentX, subjectY);
  if (isSubjectHovered) {
    ctx.beginPath();
    ctx.strokeStyle = theme.textPrimary;
    ctx.lineWidth = 1;
    ctx.moveTo(contentX, subjectY + 14);
    ctx.lineTo(contentX + subjectTextWidth, subjectY + 14);
    ctx.stroke();
  }

  // 5. Metadata Row 1: ID | Assignee
  const row1Y = y + 30;
  ctx.font = '400 11px Inter, sans-serif';
  ctx.fillStyle = theme.textSecondary;

  ctx.fillText(idText, contentX, row1Y);
  let currentX = contentX + ctx.measureText(idText).width + 12;

  if (issue.assigned_to_name) {
    drawIcon(ctx, 'person', currentX, row1Y, 14, theme.textSecondary);
    currentX += 16;
    const nameText = truncateText(ctx, issue.assigned_to_name, 80);
    ctx.fillText(nameText, currentX, row1Y);
    currentX += ctx.measureText(nameText).width + 12;
  }

  if (issue.project && issue.project.id !== data.meta.project_id) {
    drawIcon(ctx, 'folder', currentX, row1Y, 14, theme.textSecondary);
    currentX += 16;
    const projectName = truncateText(ctx, issue.project.name, 120);
    ctx.fillText(projectName, currentX, row1Y);
  }

  // 6. Metadata Row 2: Due Date | Priority | Aging
  const row2Y = y + 48;
  currentX = contentX;

  if (issue.priority_id) {
    let bg = theme.badgeBg;
    let fg = theme.badgeText;
    let icon = '';

    // Priority Colors
    if (issue.priority_id >= 5) { // Immediate
      bg = theme.badgeImmediateBg;
      fg = theme.badgeImmediateColor;
    } else if (issue.priority_id === 4) { // Urgent
      bg = theme.badgeUrgentBg;
      fg = theme.badgeUrgentColor;
    } else if (issue.priority_id === 3) { // High
      bg = theme.badgeHighBg;
      fg = theme.badgeHighColor;
    } else if (issue.priority_id === 1) { // Low
      bg = theme.badgeLowBg;
      fg = theme.badgeLowColor;
    }

    if (issue.priority_id !== 2) { // Only draw non-normal
      const width = drawBadge(ctx, issue.priority_name || '', currentX, row2Y - 1, bg, fg);
      currentX += width + 8;
    }
  }

  if (issue.due_date) {
    const dueState = calculateDueDateState(issue.due_date);
    let bg = theme.badgeBg;
    let fg = theme.badgeText;

    if (dueState === 'overdue') {
      bg = theme.badgeOverdueBg;
      fg = theme.badgeOverdueColor;
    } else if (dueState === 'near') {
      bg = theme.badgeHighBg; // Reusing high/warn color
      fg = theme.badgeHighColor;
    }

    // Only draw badge if special state, otherwise standard icon
    if (dueState !== 'normal') {
      let text = issue.due_date;
      if (dueState === 'overdue') {
        text = '!' + text;
      }
      const width = drawBadge(ctx, text, currentX, row2Y - 1, bg, fg, 'calendar_today');
      currentX += width + 8;
    } else {
      drawIcon(ctx, 'calendar_today', currentX, row2Y, 14, theme.textSecondary);
      currentX += 16;
      ctx.fillStyle = theme.textSecondary;
      ctx.fillText(issue.due_date, currentX, row2Y);
      currentX += ctx.measureText(issue.due_date).width + 12;
    }
  }

  if (agingEnabled && agingDays > 0) {
    const ageColor = agingClass === 'danger' ? theme.danger : agingClass === 'warn' ? theme.warn : theme.textSecondary;
    drawIcon(ctx, 'history', currentX, row2Y, 14, ageColor);
    currentX += 16;
    ctx.fillStyle = ageColor;
    ctx.fillText(`${agingDays}d`, currentX, row2Y);
  }

  // 7. Progress Donut (New)
  if (issue.done_ratio !== undefined) {
    const donutX = x + w - 24;
    const donutY = y + h - 24; // Bottom right corner if not obstructed by subtasks.
    // Actually, if we have subtasks, h is taller.
    // If we want it in metadata line, we can put it there.
    // Let's put it at row 1 right side?
    // User requested "Information display", usually with metadata.
    // Let's place it to the right of Row 1.

    // Let's calculate free space.
    // Row 1 starts at Y+30.
    const donutSize = 14;
    const donutRadius = donutSize / 2;
    // Let's put it after Assignee or at the end of Row 1.
    // Or maybe near the top right?

    // Let's try to put it next to assignee.
    // But we are drawing sequentially.
    // Let's draw it at the end of Row 1, right aligned?
    // Row 1 contains ID + Assignee.
    // There is usually space.

    // Better: Right aligned on Row 2 (Metadata).
    const donutRightX = x + w - 16; // Aligned with the center of the edit button above
    drawProgressDonut(ctx, donutRightX, row2Y + 6, donutRadius, issue.done_ratio, theme);
  }

  // 8. Subtasks (New)
  if (issue.subtasks && issue.subtasks.length > 0) {
    const subtaskStartY = y + metrics.cardBaseHeight + 12; // Consistent with h += 24 (12px top, 12px bottom roughly)

    // Draw separator line
    ctx.beginPath();
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.moveTo(x, subtaskStartY - 20); // Move separator to the start of subtask area
    ctx.lineTo(x + w, subtaskStartY - 20);
    ctx.stroke();

    // info icon in subtask area
    const iconSize = 24;
    const infoRect = {
      x: x + w - iconSize - 4,
      y: subtaskStartY - 16,
      width: iconSize,
      height: iconSize,
    };
    if (rectMap) rectMap.infoButtons.set(issue.id, infoRect);

    ctx.save();
    ctx.font = '20px "Material Symbols Outlined"';
    ctx.fillStyle = theme.textSecondary;
    ctx.textBaseline = 'top';
    ctx.fillText('info', infoRect.x, infoRect.y);
    ctx.restore();

    issue.subtasks.forEach((subtask, idx) => {
      const sy = subtaskStartY + idx * metrics.subtaskHeight;
      const sx = x + 12;

      // Checkbox
      const checkSize = 14;
      const checkRect = { x: sx, y: sy, width: checkSize, height: checkSize };

      // Store hit rect
      if (rectMap) {
        rectMap.subtaskChecks.set(`${issue.id}:${subtask.id}`, checkRect);
      }

      ctx.save();
      if (subtask.is_closed) {
        ctx.fillStyle = theme.primary; // or green
        roundedRect(ctx, sx, sy, checkSize, checkSize, 3);
        ctx.fill();

        // Tick mark
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx + 3, sy + 7);
        ctx.lineTo(sx + 6, sy + 10);
        ctx.lineTo(sx + 11, sy + 4);
        ctx.stroke();
      } else {
        ctx.strokeStyle = theme.borderStrong;
        ctx.lineWidth = 1.5;
        roundedRect(ctx, sx, sy, checkSize, checkSize, 3);
        ctx.stroke();
      }
      ctx.restore();

      // Text
      ctx.fillStyle = subtask.is_closed ? theme.textSecondary : theme.textPrimary;
      ctx.font = '12px Inter, sans-serif';
      const subjectText = truncateText(ctx, subtask.subject, w - 40);
      const textMetrics = ctx.measureText(subjectText);

      const subjectRect = {
        x: sx + 20,
        y: sy,
        width: textMetrics.width,
        height: metrics.subtaskHeight
      };

      if (rectMap) {
        rectMap.subtaskSubjects.set(`${issue.id}:${subtask.id}`, subjectRect);
      }

      // Draw subtask subject with underline if hovered
      const isSubtaskHovered = hover?.kind === 'subtask_subject' && hover.id === `${issue.id}:${subtask.id}`;
      ctx.fillText(subjectText, sx + 20, sy + 1);
      if (isSubtaskHovered) {
        ctx.beginPath();
        ctx.strokeStyle = subtask.is_closed ? theme.textSecondary : theme.textPrimary;
        ctx.lineWidth = 1;
        ctx.moveTo(sx + 20, sy + 13);
        ctx.lineTo(sx + 20 + textMetrics.width, sy + 13);
        ctx.stroke();
      }
    });
  }

  // Draw overlay if updating
  if (updatingIssueIds?.has(issue.id)) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    roundedRect(ctx, x, y, w, h, radius);
    ctx.fill();
    ctx.font = '600 12px Inter, sans-serif';
    ctx.fillStyle = theme.textPrimary;
    ctx.textAlign = 'center';
    ctx.fillText('Updating...', x + w / 2, y + h / 2);
    ctx.textAlign = 'left';
  }

  // 9. Buttons (Edit/Delete)
  const actionIconSize = 24;
  const editRect = {
    x: x + w - actionIconSize - 4,
    y: y + 4,
    width: actionIconSize,
    height: actionIconSize,
  };
  if (rectMap) rectMap.editButtons.set(issue.id, editRect);

  ctx.save();
  ctx.font = '20px "Material Symbols Outlined"';
  ctx.fillStyle = theme.textSecondary;
  ctx.textBaseline = 'top';
  ctx.fillText('edit', editRect.x, editRect.y);

  if (data.meta.can_delete && rectMap) {
    const deleteRect = {
      x: editRect.x - actionIconSize - 4,
      y: y + 4,
      width: actionIconSize,
      height: actionIconSize,
    };
    rectMap.deleteButtons.set(issue.id, deleteRect);
    ctx.fillStyle = theme.danger;
    ctx.fillText('delete', deleteRect.x, deleteRect.y);
  }
  ctx.restore();

  ctx.restore();
}

function drawProgressDonut(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  percent: number,
  theme: CanvasTheme
) {
  ctx.save();
  // Background circle
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = theme.border;
  ctx.stroke();

  // Progress arc
  const startAngle = -Math.PI / 2;
  const endAngle = startAngle + (Math.PI * 2 * percent) / 100;

  ctx.beginPath();
  ctx.arc(cx, cy, radius, startAngle, endAngle);
  ctx.strokeStyle = percent === 100 ? '#22c55e' : theme.primary; // Green if done, else primary
  ctx.stroke();

  // Text inside? Too small. Donut is enough indication.
  ctx.restore();
}

function drawIcon(ctx: CanvasRenderingContext2D, icon: string, x: number, y: number, size: number, color: string) {
  ctx.save();
  ctx.font = `${size}px "Material Symbols Outlined"`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  ctx.fillText(icon, x, y - 2);
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
    height: measureCardHeight(issue),
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
  for (const [key, rect] of rectMap.subtaskChecks) {
    if (pointInRect(point, rect)) {
      const [issueIdStr, subtaskIdStr] = key.split(':');
      return { kind: 'subtask_check', issueId: parseInt(issueIdStr), subtaskId: parseInt(subtaskIdStr) };
    }
  }
  for (const [key, rect] of rectMap.subtaskSubjects) {
    if (pointInRect(point, rect)) {
      const [issueIdStr, subtaskIdStr] = key.split(':');
      return { kind: 'subtask_subject', issueId: parseInt(issueIdStr), subtaskId: parseInt(subtaskIdStr) };
    }
  }
  for (const [issueId, rect] of rectMap.infoButtons) {
    if (pointInRect(point, rect)) {
      return { kind: 'info', issueId };
    }
  }
  for (const [issueId, rect] of rectMap.cardSubjects) {
    if (pointInRect(point, rect)) {
      return { kind: 'card_subject', issueId };
    }
  }
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

function getCardColor(trackerId: number, theme: CanvasTheme): string {
  const index = trackerId % theme.noteColors.length;
  return theme.noteColors[index];
}

function readTheme(container: HTMLDivElement | null): CanvasTheme {
  const fallback = {
    bgMain: '#f1f5f9', // Slate 100
    surface: '#ffffff',
    border: '#e2e8f0',
    borderStrong: '#cbd5e1',
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
    badgeBg: '#f1f5f9',
    badgeText: '#64748b',
    badgeLowBg: '#dcfce7',
    badgeLowColor: '#15803d',
    badgeHighBg: '#fef9c3', // Yellow-100
    badgeHighColor: '#a16207', // Yellow-700
    badgeUrgentBg: '#ffedd5', // Orange-100
    badgeUrgentColor: '#c2410c', // Orange-700
    badgeImmediateBg: '#fee2e2', // Red-100
    badgeImmediateColor: '#b91c1c', // Red-700
    badgeOverdueBg: '#fee2e2', // Red-100
    badgeOverdueColor: '#b91c1c', // Red-700
    badgeWarnBg: '#fef9c3',
    badgeWarnColor: '#a16207',
  };
  if (!container) return fallback;
  const styles = getComputedStyle(container);
  return {
    bgMain: styles.getPropertyValue('--rk-bg-main').trim() || fallback.bgMain,
    surface: styles.getPropertyValue('--rk-bg-surface').trim() || fallback.surface,
    border: styles.getPropertyValue('--rk-border').trim() || fallback.border,
    borderStrong: styles.getPropertyValue('--rk-border-strong').trim() || fallback.borderStrong,
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
    badgeBg: '#f1f5f9',
    badgeText: '#64748b',
    badgeLowBg: '#dcfce7',
    badgeLowColor: '#15803d',
    badgeHighBg: '#fef9c3', // Yellow-100
    badgeHighColor: '#a16207', // Yellow-700
    badgeUrgentBg: '#ffedd5', // Orange-100
    badgeUrgentColor: '#c2410c', // Orange-700
    badgeImmediateBg: '#fee2e2', // Red-100
    badgeImmediateColor: '#b91c1c', // Red-700
    badgeOverdueBg: '#fee2e2', // Red-100
    badgeOverdueColor: '#b91c1c', // Red-700
    badgeWarnBg: '#fef9c3',
    badgeWarnColor: '#a16207',
  };
}

function calculateDueDateState(dateStr: string): 'overdue' | 'near' | 'normal' {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr);
  due.setHours(0, 0, 0, 0);

  if (due < today) return 'overdue';

  const diffTime = due.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays <= 3) return 'near';

  return 'normal';
}

function drawBadge(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  bgColor: string,
  textColor: string,
  icon?: string
): number {
  ctx.save();
  ctx.font = '500 11px Inter, sans-serif';
  const textWidth = ctx.measureText(text).width;
  const paddingX = 6;
  const paddingY = 2;
  const iconSize = icon ? 14 : 0;
  const iconGap = icon ? 4 : 0;
  const totalWidth = paddingX * 2 + textWidth + iconSize + iconGap;
  const height = 18;

  ctx.fillStyle = bgColor;
  roundedRect(ctx, x, y, totalWidth, height, 4);
  ctx.fill();

  ctx.fillStyle = textColor;
  let textX = x + paddingX;
  if (icon) {
    drawIcon(ctx, icon, x + paddingX, y + 2, iconSize, textColor);
    textX += iconSize + iconGap;
  }

  ctx.textBaseline = 'middle';
  ctx.fillText(text, textX, y + height / 2 + 1); // +1 for visual centering
  ctx.restore();

  return totalWidth;
}
