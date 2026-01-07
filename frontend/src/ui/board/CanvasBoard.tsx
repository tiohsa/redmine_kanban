import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { BoardData, Column, Issue, Lane, Subtask } from '../types';
import type { BoardCommand } from './commands';
import type { BoardState } from './state';
import { cellKey } from './state';

// Base metrics that are not affected by font size
const baseMetrics = {
  columnWidth: 260,
  columnGap: 0,
  laneHeaderWidth: 120,
  headerHeight: 40,
  laneTitleHeight: 32,
  laneGap: 0,
  cellPadding: 12,
  cardGap: 10,
  boardPaddingBottom: 24,
};

function getMetrics(fontSize: number) {
  // cardBaseHeight needs to accommodate:
  // - 8px top padding
  // - fontSize for subject
  // - 9px gap
  // - metaFontSize for row1 (ID, assignee)
  // - 7px gap
  // - metaFontSize for row2 (priority, due date)
  // - 12px bottom padding
  const metaFontSize = Math.max(10, fontSize - 2);
  const cardBaseHeight = 8 + fontSize + 9 + metaFontSize + 7 + metaFontSize + 16;
  return {
    ...baseMetrics,
    cardBaseHeight,
    subtaskHeight: fontSize + 12,    // Dynamic based on font size
  };
}

const dragThreshold = 4;

type Rect = { x: number; y: number; width: number; height: number };

type RectMap = {
  cards: Map<number, Rect>;
  cells: Map<string, Rect>;
  addButtons: Map<string, Rect>;
  deleteButtons: Map<number, Rect>;

  subtaskChecks: Map<string, Rect>; // key: "issueId:subtaskId"
  subtaskSubjects: Map<string, Rect>; // key: "issueId:subtaskId"
  subtaskAreas: Map<number, Rect>; // key: issueId - entire subtask area for hit exclusion
  cardSubjects: Map<number, Rect>; // key: issueId
  infoButtons: Map<number, Rect>;
  editButtons: Map<number, Rect>;
  visibilityButtons: Map<number, Rect>; // key: statusId
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

  | { kind: 'subtask_check'; issueId: number; subtaskId: number }
  | { kind: 'subtask_subject'; issueId: number; subtaskId: number }
  | { kind: 'subtask_area'; issueId: number }
  | { kind: 'card_subject'; issueId: number }
  | { kind: 'info'; issueId: number }
  | { kind: 'edit'; issueId: number }
  | { kind: 'cell'; statusId: number; laneId: string | number }
  | { kind: 'visibility'; statusId: number }
  | { kind: 'empty' };

type Props = {
  data: BoardData;
  state: BoardState;
  canMove: boolean;
  canCreate: boolean;
  onCommand: (command: BoardCommand) => void;
  onCreate: (ctx: { statusId: number; laneId?: string | number }) => void;
  onEdit: (issueId: number) => void;
  onView: (issueId: number) => void;
  onDelete: (issueId: number) => void;
  onEditClick: (editUrl: string) => void;
  onSubtaskToggle?: (subtaskId: number, currentClosed: boolean) => void;

  labels: Record<string, string>;
  busyIssueIds?: Set<number>;
  fitMode?: 'none' | 'width';
  hiddenStatusIds?: Set<number>;
  onToggleStatusVisibility?: (statusId: number) => void;
  fontSize?: number;
};

export function CanvasBoard({
  data,
  state,
  canMove,
  canCreate,
  onCommand,
  onCreate,
  onEdit,
  onView,
  onDelete,
  onEditClick,
  onSubtaskToggle,

  labels,
  busyIssueIds,
  fitMode = 'none',
  hiddenStatusIds,
  onToggleStatusVisibility,
  fontSize = 13,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rectMapRef = useRef<RectMap>({
    cards: new Map(),
    cells: new Map(),
    addButtons: new Map(),
    deleteButtons: new Map(),

    subtaskChecks: new Map(),
    subtaskSubjects: new Map(),
    subtaskAreas: new Map(),
    cardSubjects: new Map(),
    infoButtons: new Map(),
    editButtons: new Map(),
    visibilityButtons: new Map(),
  });
  const scrollRef = useRef({ x: 0, y: 0 });
  const boardSizeRef = useRef({ width: 0, height: 0 });
  const dragRef = useRef<DragState | null>(null);
  const renderHandle = useRef<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [cursor, setCursor] = useState('default');
  const scaleRef = useRef(1);
  const hoverRef = useRef<{ kind: 'card_subject' | 'subtask_subject'; id: string } | null>(null);
  const drawRef = useRef<() => void>(() => { });
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

  const measureCtx = useMemo(() => {
    const canvas = document.createElement('canvas');
    return canvas.getContext('2d');
  }, []);

  const laneType = data.meta.lane_type;

  const metrics = useMemo(() => getMetrics(fontSize), [fontSize]);

  const layout = useMemo(
    () => computeLayout(state, data, canCreate, metrics, size.width, fitMode, measureCtx, fontSize),
    [state, data, canCreate, metrics, size.width, fitMode, measureCtx, fontSize]
  );

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
  }, [size, state, data.meta, canCreate, canMove, theme, fontSize]);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.style.cursor = cursor;
  }, [cursor]);

  useEffect(() => {
    void document.fonts.ready.then(() => {
      scheduleRender();
    });
  }, []);

  // Register wheel event listener with { passive: false } to allow preventDefault
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const deltaX = event.shiftKey ? event.deltaY : event.deltaX;
      const deltaY = event.shiftKey ? 0 : event.deltaY;
      const nextX = scrollRef.current.x + deltaX;
      const nextY = scrollRef.current.y + deltaY;
      updateScroll(nextX, nextY);
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, []);

  const scheduleRender = () => {
    if (renderHandle.current !== null) return;
    renderHandle.current = requestAnimationFrame(() => {
      renderHandle.current = null;
      drawRef.current();
    });
  };

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // サイズが設定されていない場合は描画をスキップ
    if (size.width <= 0 || size.height <= 0) return;
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

      subtaskChecks: new Map(),
      subtaskSubjects: new Map(),
      subtaskAreas: new Map(),
      cardSubjects: new Map(),
      infoButtons: new Map(),
      editButtons: new Map(),
      visibilityButtons: new Map(),
    };

    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(-scroll.x, -scroll.y);

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
      metrics,
      fontSize,
      busyIssueIds
    );

    if (laneType !== 'none') {
      drawLaneLabels(ctx, layout, state.lanes, theme, canCreate, state.columns[0]?.id, rectMapRef.current, labels, metrics);
    }

    drawDragOverlay(ctx, state, data, theme, dragRef.current, labels, metrics, fontSize, layout);

    // Draw header last so it appears on top (sticky header)
    ctx.save();
    ctx.translate(0, scroll.y); // Sticky header: counteract vertical translation
    drawHeaders(ctx, layout, state.columns, theme, data.meta, metrics, hiddenStatusIds, rectMapRef.current, scroll.y);
    ctx.restore();

    ctx.restore();
  };

  drawRef.current = draw;

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
    const isBusy = (issueId: number) => busyIssueIds?.has(issueId) ?? false;

    if (hit.kind === 'subtask_check') {
      if (isBusy(hit.subtaskId)) return;
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
      if (isBusy(hit.subtaskId)) return;
      onView(hit.subtaskId);
      return;
    }

    if (hit.kind === 'card_subject') {
      if (isBusy(hit.issueId)) return;
      onView(hit.issueId);
      return;
    }

    if (hit.kind === 'info') {
      if (isBusy(hit.issueId)) return;
      onView(hit.issueId);
      return;
    }

    if (hit.kind === 'edit') {
      if (isBusy(hit.issueId)) return;
      onEdit(hit.issueId);
      return;
    }

    if (hit.kind === 'add') {
      onCreate({ statusId: hit.statusId, laneId: hit.laneId });
      return;
    }

    if (hit.kind === 'visibility') {
      onToggleStatusVisibility?.(hit.statusId);
      return;
    }

    if (hit.kind === 'delete') {
      if (isBusy(hit.issueId)) return;
      onDelete(hit.issueId);
      return;
    }


    if (hit.kind === 'card' || hit.kind === 'subtask_area') {
      if (isBusy(hit.issueId)) return;
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
      let nextCursor = 'default';
      const hit = hitTest(point, rectMapRef.current, state, data);
      let newHover: { kind: 'card_subject' | 'subtask_subject'; id: string } | null = null;

      if (hit.kind === 'card_subject') {
        nextCursor = 'pointer';
        newHover = { kind: 'card_subject', id: String(hit.issueId) };
      } else if (hit.kind === 'subtask_subject') {
        nextCursor = 'pointer';
        newHover = { kind: 'subtask_subject', id: `${hit.issueId}:${hit.subtaskId}` };
      } else if (hit.kind === 'card') {
        nextCursor = canMove ? 'grab' : 'default';
      } else if (hit.kind === 'add' || hit.kind === 'delete' || hit.kind === 'subtask_check' || hit.kind === 'info' || hit.kind === 'edit' || hit.kind === 'visibility') {
        nextCursor = 'pointer';
      }

      if (newHover) {
        const issue = state.cardsById.get(Number(newHover.kind === 'card_subject' ? newHover.id : newHover.id.split(':')[0]));
        if (issue) {
          const text = newHover.kind === 'card_subject'
            ? issue.subject
            : issue.subtasks?.find(s => `${issue.id}:${s.id}` === newHover.id)?.subject;

          if (text) {
            setTooltip({ text, x: Math.min(event.clientX, window.innerWidth - 320), y: event.clientY + 16 });
          }
        }
      } else {
        setTooltip(null);
      }

      setCursor(nextCursor);

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
      // If we released on the same card and didn't drag, open the dialog
      // except for subtask checkbox area which is already handled in handlePointerDown
      const hit = hitTest(point, rectMapRef.current, state, data);
      if (hit.kind === 'subtask_subject') {
        onView(hit.subtaskId);
      } else if (hit.kind === 'card_subject') {
        // Open dialog when clicking on subject (but not on the rest of the card)
        onView(hit.issueId);
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
      role="region"
      aria-label={labels.board_aria || 'Kanban Board'}
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
      {tooltip && (
        <div
          style={{
            position: 'fixed',
            left: tooltip.x,
            top: tooltip.y,
            background: 'rgba(30, 41, 59, 0.95)',
            color: '#fff',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '12px',
            maxWidth: '300px',
            zIndex: 1000,
            pointerEvents: 'none',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            lineHeight: 1.4,
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
          }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}

function computeLayout(
  state: BoardState,
  data: BoardData,
  canCreate: boolean,
  metrics: ReturnType<typeof getMetrics>,
  containerWidth: number = 0,
  fitMode: 'none' | 'width' = 'none',
  measureCtx?: CanvasRenderingContext2D | null,
  fontSize?: number
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
    const laneHeight = computeLaneHeight(state, data, laneId, canCreate, adjustedMetrics, measureCtx, fontSize);
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

function measureCardHeight(
  issue: Issue,
  metrics: ReturnType<typeof getMetrics>,
  ctx?: CanvasRenderingContext2D | null,
  fontSize?: number,
  cardWidth?: number
): number {
  let h = metrics.cardBaseHeight;

  if (ctx && fontSize && cardWidth) {
    ctx.font = `400 ${fontSize}px Inter, sans-serif`;
    const stripWidth = 5;
    const contentW = cardWidth - metrics.cellPadding * 2 - stripWidth - 16;
    const buttonAreaWidth = 52;
    const subjectW = contentW - buttonAreaWidth;
    const lines = truncateTextLines(ctx, issue.subject, subjectW, 2);
    if (lines.length > 1) {
      h += (fontSize + 3) * (lines.length - 1);
    }
  }

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
  canCreate: boolean,
  metrics: ReturnType<typeof getMetrics>,
  measureCtx?: CanvasRenderingContext2D | null,
  fontSize?: number
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
          height += measureCardHeight(issue, metrics, measureCtx, fontSize, metrics.columnWidth);
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
  meta: BoardData['meta'],
  metrics: ReturnType<typeof getMetrics>,
  hiddenStatusIds?: Set<number>,
  rectMap?: RectMap,
  offsetY: number = 0
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
    const x = layout.gridStartX + index * layout.columnWidth;

    ctx.font = '600 13px Inter, sans-serif';
    const limit = column.wip_limit ?? null;
    const count = column.count ?? 0;
    const over = limit && count > limit;

    const badgeText = (limit || count > 0) ? (limit ? `${count} / ${limit}` : String(count)) : '';
    ctx.font = '500 11px Inter, sans-serif';
    const badgeWidth = badgeText ? ctx.measureText(badgeText).width + 10 : 0;
    const visIconWidth = 24;

    ctx.font = '600 13px Inter, sans-serif';
    const maxNameWidth = layout.columnWidth - 12 - (badgeWidth ? badgeWidth + 24 : 12) - visIconWidth;
    const displayName = truncateText(ctx, column.name, maxNameWidth);

    ctx.fillStyle = theme.textPrimary;
    ctx.fillText(displayName, x + 12, layout.headerHeight / 2);
    const nameWidth = ctx.measureText(displayName).width;

    if (badgeText) {
      const badgeHeight = 18;
      const badgeX = x + layout.columnWidth - badgeWidth - 12;
      const badgeY = (layout.headerHeight - badgeHeight) / 2;

      ctx.fillStyle = over ? theme.dangerBg : '#e2e8f0';
      ctx.strokeStyle = over ? theme.danger : 'transparent';
      if (over) ctx.lineWidth = 1;

      roundedRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 4);
      ctx.fill();
      if (over) ctx.stroke();

      ctx.font = '500 11px Inter, sans-serif';
      ctx.fillStyle = over ? theme.danger : theme.textSecondary;
      ctx.textAlign = 'center';
      ctx.fillText(badgeText, badgeX + badgeWidth / 2, badgeY + badgeHeight / 2);
      ctx.textAlign = 'left';
    }



    // Visibility Toggle
    const isHidden = hiddenStatusIds?.has(column.id);
    const visX = x + 12 + nameWidth + 8;
    const visY = (layout.headerHeight - 16) / 2;
    // Add offsetY to the rect coordinates because the header is sticky but pointer events are in global coordinates
    const visRect = { x: visX - 4, y: visY - 4 + offsetY, width: 24, height: 24 };
    if (rectMap) rectMap.visibilityButtons.set(column.id, visRect);

    drawIcon(ctx, isHidden ? 'visibility_off' : 'visibility', visX, visY + 2, 16, isHidden ? theme.textSecondary : theme.primary);

    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + layout.columnWidth, 0);
    ctx.lineTo(x + layout.columnWidth, layout.headerHeight);
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
  labels: Record<string, string>,
  metrics: ReturnType<typeof getMetrics>
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
  metrics: ReturnType<typeof getMetrics>,
  fontSize: number,
  busyIssueIds?: Set<number>
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
      const colX = layout.gridStartX + colIndex * (layout.columnWidth + metrics.columnGap);
      const cellRect = {
        x: colX,
        y: laneLayout.y,
        width: layout.columnWidth,
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

        const cardH = measureCardHeight(issue, metrics, ctx, fontSize, layout.columnWidth);
        const cardRect = {
          x: cellRect.x + metrics.cellPadding,
          y: currentY,
          width: cellRect.width - metrics.cellPadding * 2,
          height: cardH,
        };

        currentY += cardH + metrics.cardGap;

        const isUpdating = busyIssueIds?.has(issue.id) ?? false;
        rectMap.cards.set(issue.id, cardRect);
        drawCard(ctx, cardRect, issue, data, theme, canMove, labels, metrics, fontSize, rectMap, hover, isUpdating);
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
  metrics: ReturnType<typeof getMetrics>,
  fontSize: number,
  rectMap?: RectMap,
  hover?: { kind: 'card_subject' | 'subtask_subject'; id: string } | null,
  isUpdating?: boolean
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
  ctx.font = `400 ${fontSize}px Inter, sans-serif`;
  ctx.textBaseline = 'top';

  const subjectY = y + 8;
  const subject = issue.subject;
  const idText = `#${issue.id}`;
  const buttonAreaWidth = 52;
  const subjectLines = truncateTextLines(ctx, subject, contentW - buttonAreaWidth, 2);

  // Register subject area for hit testing
  const subjectTotalHeight = subjectLines.length * (fontSize + 3);
  const subjectRect = { x: contentX, y: subjectY, width: contentW - buttonAreaWidth, height: subjectTotalHeight };
  if (rectMap) {
    rectMap.cardSubjects.set(issue.id, subjectRect);
  }

  // Draw subject with underline if hovered
  const isSubjectHovered = hover?.kind === 'card_subject' && hover.id === String(issue.id);

  subjectLines.forEach((line, index) => {
    ctx.fillText(line, contentX, subjectY + index * (fontSize + 3));
    if (isSubjectHovered) {
      const lineWidth = ctx.measureText(line).width;
      ctx.beginPath();
      ctx.strokeStyle = theme.textPrimary;
      ctx.lineWidth = 1;
      const currentY = subjectY + index * (fontSize + 3);
      ctx.moveTo(contentX, currentY + fontSize + 1);
      ctx.lineTo(contentX + lineWidth, currentY + fontSize + 1);
      ctx.stroke();
    }
  });

  const metaFontSize = Math.max(10, fontSize - 2);

  // 5. Metadata Row 1: ID | Assignee
  // Adjust rowY based on subject lines
  const row1Y = subjectY + subjectTotalHeight + 6;
  ctx.font = `400 ${metaFontSize}px Inter, sans-serif`;
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
  const row2Y = row1Y + metaFontSize + 7;
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
      const width = drawBadge(ctx, issue.priority_name || '', currentX, row2Y - 1, bg, fg, metaFontSize);
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
      const width = drawBadge(ctx, text, currentX, row2Y - 1, bg, fg, metaFontSize, 'calendar_today');
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
    const subtaskFontSize = Math.max(10, fontSize - 1);
    const subtaskAreaY = y + metrics.cardBaseHeight - 4;
    const subtaskStartY = subtaskAreaY + 16;

    // Register subtask area for hit exclusion (from separator line to bottom of card)
    if (rectMap) {
      const subtaskAreaRect = {
        x: x,
        y: subtaskAreaY,
        width: w,
        height: h - (subtaskAreaY - y),
      };
      rectMap.subtaskAreas.set(issue.id, subtaskAreaRect);
    }

    // Draw separator line
    ctx.beginPath();
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.moveTo(x + 5, subtaskAreaY);
    ctx.lineTo(x + w, subtaskAreaY);
    ctx.stroke();

    // info icon in subtask area
    const iconSize = 20;
    const infoRect = {
      x: x + w - iconSize - 6,
      y: subtaskAreaY + 4,
      width: iconSize,
      height: iconSize,
    };
    if (rectMap) rectMap.infoButtons.set(issue.id, infoRect);

    ctx.save();
    ctx.font = `${iconSize}px "Material Symbols Outlined"`;
    ctx.fillStyle = theme.textSecondary;
    ctx.textBaseline = 'top';
    ctx.fillText('info', infoRect.x, infoRect.y);
    ctx.restore();

    issue.subtasks.forEach((subtask, idx) => {
      const sy = subtaskStartY + idx * metrics.subtaskHeight;
      const sx = contentX;

      // Checkbox
      const checkSize = Math.max(12, fontSize);
      const checkRect = { x: sx, y: sy, width: checkSize, height: checkSize };

      // Store hit rect
      if (rectMap) {
        rectMap.subtaskChecks.set(`${issue.id}:${subtask.id}`, checkRect);
      }

      ctx.save();
      const isStClosed = subtask.is_closed;
      if (isStClosed) {
        ctx.fillStyle = theme.primary;
        roundedRect(ctx, sx, sy, checkSize, checkSize, 3);
        ctx.fill();

        // Tick mark
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const offset = checkSize / 4;
        ctx.moveTo(sx + offset, sy + checkSize / 2);
        ctx.lineTo(sx + checkSize / 2, sy + checkSize - offset);
        ctx.lineTo(sx + checkSize - offset, sy + offset);
        ctx.stroke();
      } else {
        ctx.strokeStyle = theme.borderStrong;
        ctx.lineWidth = 1.5;
        roundedRect(ctx, sx, sy, checkSize, checkSize, 3);
        ctx.stroke();
      }
      ctx.restore();

      // Text
      ctx.fillStyle = isStClosed ? theme.textSecondary : theme.textPrimary;
      ctx.font = `${isStClosed ? '400' : '500'} ${subtaskFontSize}px Inter, sans-serif`;
      const subjectText = truncateText(ctx, subtask.subject, contentW - checkSize - 8);
      const textMetrics = ctx.measureText(subjectText);

      const subjectRect = {
        x: sx + checkSize + 8,
        y: sy,
        width: textMetrics.width,
        height: checkSize
      };

      if (rectMap) {
        rectMap.subtaskSubjects.set(`${issue.id}:${subtask.id}`, subjectRect);
      }

      // Draw subtask subject with underline if hovered
      const isSubtaskHovered = hover?.kind === 'subtask_subject' && hover.id === `${issue.id}:${subtask.id}`;
      ctx.fillText(subjectText, sx + checkSize + 8, sy);
      if (isSubtaskHovered) {
        ctx.beginPath();
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1;
        ctx.moveTo(sx + checkSize + 8, sy + subtaskFontSize + 1);
        ctx.lineTo(sx + checkSize + 8 + textMetrics.width, sy + subtaskFontSize + 1);
        ctx.stroke();
      }
    });
  }

  // 9. Delete Button & Edit Button
  ctx.save();
  ctx.font = '20px "Material Symbols Outlined"';
  ctx.textBaseline = 'top';

  if (rectMap) {
    const actionIconSize = 24;
    let buttonRightX = x + w - 4;

    // Delete Button
    if (data.meta.can_delete) {
      const deleteRect = {
        x: buttonRightX - actionIconSize,
        y: y + 4,
        width: actionIconSize,
        height: actionIconSize,
      };
      rectMap.deleteButtons.set(issue.id, deleteRect);
      ctx.fillStyle = theme.danger;
      ctx.fillText('delete', deleteRect.x, deleteRect.y);
      buttonRightX -= actionIconSize;
    }

    // Edit Button (Always visible if editable?)
    // Assuming can_edit is true implicitly or we check
    // If not check editable, just show it? Usually Kanban board is for editable.
    // Let's assume always visible like delete or subject click.
    const editRect = {
      x: buttonRightX - actionIconSize,
      y: y + 4,
      width: actionIconSize,
      height: actionIconSize,
    };
    rectMap.editButtons.set(issue.id, editRect);
    ctx.fillStyle = theme.textSecondary;
    ctx.fillText('edit', editRect.x, editRect.y);
  }
  ctx.restore();

  ctx.restore();

  // No visual indicator for isUpdating to avoid "flash" effect after drop.
  // The logic to block interaction while updating is still active in hit testing.
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
  labels: Record<string, string>,
  metrics: ReturnType<typeof getMetrics>,
  fontSize: number,
  layout: ReturnType<typeof computeLayout>
) {
  if (!drag || !drag.dragging) return;
  const issue = state.cardsById.get(drag.issueId);
  if (!issue) return;
  const offsetX = 20;
  const offsetY = 20;
  const rect = {
    x: drag.current.x - offsetX,
    y: drag.current.y - offsetY,
    width: layout.columnWidth - metrics.cellPadding * 2,
    height: measureCardHeight(issue, metrics),
  };
  ctx.save();
  ctx.globalAlpha = 0.9;
  drawCard(ctx, rect, issue, data, theme, true, labels, metrics, fontSize, undefined, undefined, false);
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
  for (const [issueId, rect] of rectMap.editButtons) {
    if (pointInRect(point, rect)) {
      return { kind: 'edit', issueId };
    }
  }
  for (const [issueId, rect] of rectMap.deleteButtons) {
    if (pointInRect(point, rect)) return { kind: 'delete', issueId };
  }
  for (const [statusId, rect] of rectMap.visibilityButtons) {
    if (pointInRect(point, rect)) {
      return { kind: 'visibility', statusId };
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

  // Check subtask area before card - clicking on subtask area should not open dialog
  for (const [issueId, rect] of rectMap.subtaskAreas) {
    if (pointInRect(point, rect)) return { kind: 'subtask_area', issueId };
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

function truncateTextLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  const chars = Array.from(text);
  let currentLine = '';

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    const test = currentLine + char;
    const w = ctx.measureText(test).width;

    if (w > maxWidth) {
      if (currentLine) lines.push(currentLine);
      currentLine = char;
    } else {
      currentLine = test;
    }
  }
  if (currentLine) lines.push(currentLine);

  if (lines.length <= maxLines) return lines;

  // Truncate
  const result = lines.slice(0, maxLines - 1);
  // Reconstruct last line content from lines[maxLines-1] onwards
  // Since we don't have indexes easy, let's just use truncateText on the combined text of remaining lines? 
  // A bit complex to get exact text.
  // Instead, let's just take lines[maxLines-1] AND force '...' on it if there are more lines
  // But lines[maxLines-1] might already be full width. Adding ... will overflow.

  const lastLineCandidate = lines[maxLines - 1];
  let lastLine = lastLineCandidate;
  while (lastLine.length > 0 && ctx.measureText(lastLine + '...').width > maxWidth) {
    lastLine = lastLine.slice(0, -1);
  }
  result.push(lastLine + '...');

  return result;
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
  fontSize: number = 11,
  icon?: string
): number {
  ctx.save();
  ctx.font = `500 ${fontSize}px Inter, sans-serif`;
  const textWidth = ctx.measureText(text).width;
  const paddingX = Math.max(4, Math.round(fontSize * 0.5));
  const paddingY = Math.max(2, Math.round(fontSize * 0.2));
  const iconSize = icon ? fontSize + 2 : 0;
  const iconGap = icon ? 4 : 0;
  const totalWidth = paddingX * 2 + textWidth + iconSize + iconGap;
  const height = fontSize + paddingY * 2 + 4;

  ctx.fillStyle = bgColor;
  roundedRect(ctx, x, y, totalWidth, height, 4);
  ctx.fill();

  ctx.fillStyle = textColor;
  let textX = x + paddingX;
  if (icon) {
    drawIcon(ctx, icon, x + paddingX, y + paddingY, iconSize, textColor);
    textX += iconSize + iconGap;
  }

  ctx.textBaseline = 'middle';
  ctx.fillText(text, textX, y + height / 2 + 1);
  ctx.restore();

  return totalWidth;
}
