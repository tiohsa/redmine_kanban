import React, { useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import type { BoardData } from '../types';
import type { CardDisplayMode } from '../useKanbanPreferences';
import type { BoardCommand } from './commands';
import { getBoardCursor } from './cursor';
import { clamp } from './canvasGeometry';
import {
  canDeleteIssue,
  canEditIssue,
  canMoveIssue,
  assessDrop,
  getHoverSnapshot,
  getIssueFromHover,
  getTooltipTextFromHover,
  shouldDispatchDrop,
  subtaskPermissions,
} from './canvasInteraction';
import { transitionDragPhase, type DragLifecycleEvent, type DragPhase } from './dragInteraction';
import { laneIdToAssignee, laneIdToPriority, resolveBoardLaneId } from './keys';
import { getMetrics } from './metrics';
import type { BoardState } from './state';
import { cellKey } from './state';
import { findSubtaskInTree } from '../subtasksTree';
import { buildTrackerCatalog } from '../../model/issue/issue';
import {
  computeLayout,
  type CardHeightCache,
} from './BoardLayout';
import { createRectMap, hitTest, type RectMap } from './HitTestIndex';
import { renderCanvasScene } from './CanvasRenderer';
import { createSubjectLineMeasurer, drawCells, drawDragOverlay, drawHeaders, drawLaneLabels, readTheme } from './CanvasDrawing';
import {
  advanceDragState,
  createDragState,
  resolveDropTarget,
  toBoardPoint,
  type DragState,
} from './CanvasPointerController';

export { makeSubtaskSignature, makeCardHeightCacheKey } from './BoardLayout';
export { measureCardHeightCached } from './CanvasDrawing';

type CanvasBackingStoreState = { width: number; height: number; dpr: number };

export type CanvasBoardHandle = {
  scrollToTop: () => void;
  dateAnchorPosition: (point: { x: number; y: number }) => { x: number; y: number } | null;
};

type Props = {
  data: BoardData;
  state: BoardState;
  canMove: boolean;
  canCreate: boolean;
  onCommand: (command: BoardCommand) => boolean;
  onCreate: (ctx: { statusId: number; laneId?: string | number; projectId?: number }) => void;
  onEdit: (issueId: number) => void;
  onView: (issueId: number) => void;
  onDelete: (issueId: number) => void;
  onEditClick: (editUrl: string) => void;
  onWorkTimer?: (issueId: number) => void;
  timerSession?: { sessionId?: string; issueId: number | string; state: 'running' | 'expired' | 'stopped_pending_record' } | null;
  onSubtaskToggle?: (subtaskId: number, currentClosed: boolean) => void;
  onPriorityClick?: (issueId: number, currentPriorityId: number, x: number, y: number) => void;
  onDateClick?: (issueId: number, currentDate: string | null, x: number, y: number, boardPoint: { x: number; y: number }) => void;
  onViewportChange?: () => void;
  onProgressClick?: (issueId: number, currentDoneRatio: number, x: number, y: number) => void;

  labels: Record<string, string>;
  busyIssueIds?: Set<number>;
  fitMode?: 'none' | 'width';
  hiddenStatusIds?: Set<number>;
  onToggleStatusVisibility?: (statusId: number) => void;
  fontSize?: number;
  cardDisplayMode?: CardDisplayMode;
  defaultCreateStatusId?: number;
};

export const CanvasBoard = forwardRef<CanvasBoardHandle, Props>(function CanvasBoard({
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
  onWorkTimer,
  timerSession,
  onSubtaskToggle,
  onPriorityClick,
  onDateClick,
  onViewportChange,
  onProgressClick,

  labels,
  busyIssueIds,
  fitMode = 'none',
  hiddenStatusIds,
  onToggleStatusVisibility,
  fontSize = 13,
  cardDisplayMode = 'standard',
  defaultCreateStatusId,
}: Props, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rectMapRef = useRef<RectMap>(createRectMap());
  const cardHeightCacheRef = useRef<CardHeightCache>(new Map());
  const scrollRef = useRef({ x: 0, y: 0 });
  const boardSizeRef = useRef({ width: 0, height: 0 });
  const dragRef = useRef<DragState | null>(null);
  const pendingDropTimeoutRef = useRef<number | null>(null);
  const renderHandle = useRef<number | null>(null);
  const backingStoreRef = useRef<CanvasBackingStoreState>({ width: 0, height: 0, dpr: 1 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [cursor, setCursor] = useState('default');
  const scaleRef = useRef(1);
  const anchorGeometryRef = useRef<{ left: number; top: number; width: number; height: number; scale: number } | null>(null);
  const hoverRef = useRef<{ kind: 'card_subject' | 'subtask_subject'; id: string } | null>(null);
  const hoveredCardIssueIdRef = useRef<number | null>(null);
  const hoveredSubtaskKeyRef = useRef<string | null>(null);
  const drawRef = useRef<() => void>(() => { });
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

  const scheduleRender = React.useCallback(() => {
    if (renderHandle.current !== null) return;
    renderHandle.current = requestAnimationFrame(() => {
      renderHandle.current = null;
      drawRef.current();
    });
  }, []);

  useEffect(() => {
    return () => {
      if (renderHandle.current !== null) {
        cancelAnimationFrame(renderHandle.current);
        renderHandle.current = null;
      }
      if (pendingDropTimeoutRef.current !== null) {
        window.clearTimeout(pendingDropTimeoutRef.current);
        pendingDropTimeoutRef.current = null;
      }
    };
  }, []);

  const clearHoverState = React.useCallback(() => {
    hoverRef.current = null;
    hoveredCardIssueIdRef.current = null;
    hoveredSubtaskKeyRef.current = null;
    setTooltip(null);
  }, []);

  const clearDragState = React.useCallback(() => {
    if (pendingDropTimeoutRef.current !== null) {
      window.clearTimeout(pendingDropTimeoutRef.current);
      pendingDropTimeoutRef.current = null;
    }
    dragRef.current = null;
    setCursor(getBoardCursor({ phase: 'idle' }));
    scheduleRender();
  }, [scheduleRender]);

  const transitionDragState = React.useCallback((event: DragLifecycleEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const nextPhase = transitionDragPhase(drag.phase, event);
    if (nextPhase === 'idle') {
      clearDragState();
      return;
    }
    drag.phase = nextPhase as Exclude<DragPhase, 'idle'>;
    setCursor(getBoardCursor({ phase: drag.phase === 'pending-drop' ? 'pending-drop' : 'dragging' }));
    scheduleRender();
  }, [clearDragState, scheduleRender]);

  const schedulePendingDropFallback = React.useCallback(() => {
    if (pendingDropTimeoutRef.current !== null) {
      window.clearTimeout(pendingDropTimeoutRef.current);
    }
    pendingDropTimeoutRef.current = window.setTimeout(() => {
      pendingDropTimeoutRef.current = null;
      transitionDragState('fallback-timeout');
    }, 2000);
  }, [transitionDragState]);

  const measureCtx = useMemo(() => {
    const canvas = document.createElement('canvas');
    return canvas.getContext('2d');
  }, []);

  const measureSubjectLines = useMemo(() => createSubjectLineMeasurer(measureCtx), [measureCtx]);

  const laneType = data.meta.lane_type;

  const metrics = useMemo(() => getMetrics(fontSize), [fontSize]);

  const layout = useMemo(
    () => computeLayout(state, data, canCreate, metrics, size.width, fitMode, measureSubjectLines, fontSize, cardHeightCacheRef.current, cardDisplayMode),
    [state, data, canCreate, metrics, size.width, fitMode, measureSubjectLines, fontSize, cardDisplayMode]
  );

  const trackerCatalog = useMemo(() => buildTrackerCatalog(data.lists.trackers), [data.lists.trackers]);

  const theme = useMemo(() => readTheme(containerRef.current), []);

  // Scale calculation is now handled directly in draw() to ensure it's always in sync with the latest layout and size.
  useEffect(() => {
    scheduleRender();
  }, [fitMode, scheduleRender]);

  useEffect(() => {
    cardHeightCacheRef.current.clear();
  }, [data]);

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
  }, [size, state, data.meta, trackerCatalog, canCreate, canMove, theme, fontSize, cardDisplayMode, defaultCreateStatusId, timerSession?.sessionId, timerSession?.issueId, timerSession?.state, scheduleRender]);

  useEffect(() => {
    const onViewportChange = () => {
      scheduleRender();
    };
    window.addEventListener('resize', onViewportChange);
    window.visualViewport?.addEventListener('resize', onViewportChange);
    return () => {
      window.removeEventListener('resize', onViewportChange);
      window.visualViewport?.removeEventListener('resize', onViewportChange);
    };
  }, [scheduleRender]);

  useEffect(() => {
    const drag = dragRef.current;
    if (drag?.phase !== 'pending-drop' || !drag.dropTargetCellKey) return;

    const issue = state.cardsById.get(drag.issueId);
    if (issue) {
      const currentCell = cellKey(issue.status_id, resolveBoardLaneId(data, issue));
      if (currentCell === drag.dropTargetCellKey) {
        transitionDragState('target-observed');
        return;
      }
    }

  }, [state, data, busyIssueIds, transitionDragState]);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.style.cursor = cursor;
  }, [cursor]);

  const updateScroll = React.useCallback((x: number, y: number) => {
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
    onViewportChange?.();
    scheduleRender();
  }, [size.height, size.width, onViewportChange, scheduleRender]);

  useEffect(() => {
    if (!document.fonts?.ready) {
      scheduleRender();
      return;
    }

    void document.fonts.ready.then(() => {
      scheduleRender();
    });
  }, [scheduleRender]);

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
  }, [updateScroll]);

  useImperativeHandle(ref, () => ({
    scrollToTop: () => {
      updateScroll(0, 0);
    },
    dateAnchorPosition: (point) => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return null;
      const rect = canvas.getBoundingClientRect();
      const bounds = container.getBoundingClientRect();
      const scale = scaleRef.current;
      const x = rect.left + (point.x - scrollRef.current.x) * scale;
      const y = rect.top + (point.y - scrollRef.current.y) * scale;
      const left = Math.max(0, rect.left, bounds.left);
      const top = Math.max(0, rect.top, bounds.top);
      const right = Math.min(window.innerWidth, rect.right, bounds.right);
      const bottom = Math.min(window.innerHeight, rect.bottom, bounds.bottom);
      return x >= left && x <= right && y >= top && y <= bottom ? { x, y } : null;
    },
  }), [updateScroll]);

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // サイズが設定されていない場合は描画をスキップ
    if (size.width <= 0 || size.height <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = getCanvasDevicePixelRatio();
    resizeCanvasBackingStoreIfNeeded(canvas, backingStoreRef.current, size.width, size.height, dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

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

    rectMapRef.current = createRectMap();

    renderCanvasScene({
      ctx,
      scale,
      scroll,
      drawCells: () => drawCells(
        ctx,
        layout,
        state,
        data,
        trackerCatalog,
        viewRect,
        theme,
        canCreate,
        canMove,
        rectMapRef.current,
        dragRef.current,
        labels,
        hoverRef.current,
        hoveredCardIssueIdRef.current,
        hoveredSubtaskKeyRef.current,
        metrics,
        fontSize,
        cardDisplayMode,
        cardHeightCacheRef.current,
        busyIssueIds,
        timerSession,
      ),
      drawLaneLabels: laneType !== 'none'
        ? () => drawLaneLabels(
          ctx,
          layout,
          state.lanes,
          theme,
          canCreate,
          defaultCreateStatusId ?? state.columns[0]?.id,
          rectMapRef.current,
          labels,
          metrics,
        )
        : undefined,
      drawDragOverlay: () => drawDragOverlay(
        ctx,
        state,
        data,
        trackerCatalog,
        theme,
        dragRef.current,
        labels,
        metrics,
        fontSize,
        layout,
        cardDisplayMode,
      ),
      drawHeaders: () => drawHeaders(
        ctx,
        layout,
        state.columns,
        theme,
        data.meta,
        metrics,
        hiddenStatusIds,
        rectMapRef.current,
        scroll.y,
      ),
    });

    const rect = canvas.getBoundingClientRect();
    const geometry = { left: rect.left, top: rect.top, width: rect.width, height: rect.height, scale };
    const previousGeometry = anchorGeometryRef.current;
    if (!previousGeometry
      || geometry.left !== previousGeometry.left
      || geometry.top !== previousGeometry.top
      || geometry.width !== previousGeometry.width
      || geometry.height !== previousGeometry.height
      || geometry.scale !== previousGeometry.scale) {
      anchorGeometryRef.current = geometry;
      onViewportChange?.();
    }
  };

  drawRef.current = draw;

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.phase === 'pending-drop') return;
    const point = toBoardPoint(event, scrollRef.current, canvasRef.current, scaleRef.current);
    const hit = hitTest(point, rectMapRef.current, data);
    const isBusy = (issueId: number) => busyIssueIds?.has(issueId) ?? false;
    switch (hit.kind) {
      case 'subtask_check': {
        if (isBusy(hit.subtaskId)) return;
        const issue = state.cardsById.get(hit.issueId);
        if (!subtaskPermissions(issue, hit.subtaskId)?.can_move) return;
        if (!issue || !onSubtaskToggle) return;
        const subtask = findSubtaskInTree(issue.subtasks, hit.subtaskId);
        if (!subtask) return;
        onSubtaskToggle(hit.subtaskId, subtask.is_closed ?? false);
        return;
      }
      case 'subtask_subject':
        if (isBusy(hit.subtaskId)) return;
        onView(hit.subtaskId);
        return;
      case 'subtask_work_timer': {
        if (isBusy(hit.subtaskId)) return;
        const issue = state.cardsById.get(hit.issueId);
        const subtask = findSubtaskInTree(issue?.subtasks, hit.subtaskId);
        if (subtask?.can_log_time !== true || !onWorkTimer) return;
        onWorkTimer(hit.subtaskId);
        return;
      }
      case 'subtask_edit': {
        if (isBusy(hit.subtaskId)) return;
        const issue = state.cardsById.get(hit.issueId);
        if (!subtaskPermissions(issue, hit.subtaskId)?.can_edit) return;
        onEdit(hit.subtaskId);
        return;
      }
      case 'subtask_delete': {
        if (isBusy(hit.subtaskId)) return;
        const issue = state.cardsById.get(hit.issueId);
        if (!subtaskPermissions(issue, hit.subtaskId)?.can_delete) return;
        onDelete(hit.subtaskId);
        return;
      }
      case 'card_subject':
        if (isBusy(hit.issueId)) return;
        onView(hit.issueId);
        return;
      case 'edit': {
        if (isBusy(hit.issueId)) return;
        const issue = state.cardsById.get(hit.issueId);
        if (!canEditIssue(issue)) return;
        onEdit(hit.issueId);
        return;
      }
      case 'work_timer': {
        if (isBusy(hit.issueId)) return;
        const issue = state.cardsById.get(hit.issueId);
        if (!issue?.can_log_time || !onWorkTimer) return;
        onWorkTimer(hit.issueId);
        return;
      }
      case 'add':
        onCreate({ statusId: hit.statusId, laneId: hit.laneId });
        return;
      case 'visibility':
        onToggleStatusVisibility?.(hit.statusId);
        return;
      case 'delete': {
        if (isBusy(hit.issueId)) return;
        const issue = state.cardsById.get(hit.issueId);
        if (!canDeleteIssue(issue)) return;
        onDelete(hit.issueId);
        return;
      }
      case 'priority': {
        if (isBusy(hit.issueId)) return;
        event.preventDefault();
        const issue = state.cardsById.get(hit.issueId);
        if (!canEditIssue(issue) || !issue || !onPriorityClick) return;
        onPriorityClick(hit.issueId, issue.priority_id ?? 2, event.clientX, event.clientY);
        return;
      }
      case 'date': {
        if (isBusy(hit.issueId)) return;
        event.preventDefault();
        const issue = state.cardsById.get(hit.issueId);
        if (!canEditIssue(issue) || !issue || !onDateClick) return;
        onDateClick(hit.issueId, issue.due_date ?? null, event.clientX, event.clientY, point);
        return;
      }
      case 'progress': {
        if (isBusy(hit.issueId)) return;
        event.preventDefault();
        const issue = state.cardsById.get(hit.issueId);
        if (!canEditIssue(issue) || !issue || !onProgressClick) return;
        onProgressClick(hit.issueId, issue.done_ratio ?? 0, event.clientX, event.clientY);
        return;
      }
      case 'card':
      case 'subtask_area':
      case 'subtask_row': {
        if (isBusy(hit.issueId)) return;
        const issue = state.cardsById.get(hit.issueId);
        if (!issue || !canMoveIssue(issue)) return;
        dragRef.current = createDragState(issue, point, data);
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      default:
        dragRef.current = null;
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = toBoardPoint(event, scrollRef.current, canvasRef.current, scaleRef.current);
    const drag = dragRef.current;

    if (!drag) {
      const hit = hitTest(point, rectMapRef.current, data);
      const hoverSnapshot = getHoverSnapshot(hit);
      const issue = getIssueFromHover(state.cardsById, hoverSnapshot.hover);
      const tooltipText = issue ? getTooltipTextFromHover(issue, hoverSnapshot.hover) : undefined;
      if (tooltipText) {
        setTooltip({ text: tooltipText, x: Math.min(event.clientX, window.innerWidth - 320), y: event.clientY + 16 });
      } else {
        setTooltip(null);
      }

      setCursor(getBoardCursor({ phase: 'idle', hitKind: hit.kind }));

      // Update hover state and re-render if changed
      const currentHover = hoverRef.current;
      const hoverChanged =
        currentHover?.kind !== hoverSnapshot.hover?.kind || currentHover?.id !== hoverSnapshot.hover?.id;
      const cardHoverChanged = hoveredCardIssueIdRef.current !== hoverSnapshot.hoveredCardIssueId;
      const subtaskHoverChanged = hoveredSubtaskKeyRef.current !== hoverSnapshot.hoveredSubtaskKey;
      if (hoverChanged || cardHoverChanged || subtaskHoverChanged) {
        hoverRef.current = hoverSnapshot.hover;
        hoveredCardIssueIdRef.current = hoverSnapshot.hoveredCardIssueId;
        hoveredSubtaskKeyRef.current = hoverSnapshot.hoveredSubtaskKey;
        scheduleRender();
      }
      return;
    }

    if (drag.phase === 'pending-drop') {
      setCursor(getBoardCursor({ phase: 'pending-drop' }));
      return;
    }

    dragRef.current = advanceDragState(drag, point, rectMapRef.current, data);
    const nextDrag = dragRef.current;

    if (nextDrag?.phase === 'dragging') {
      setCursor(getBoardCursor({ phase: 'dragging', dropAssessment: nextDrag.targetAssessment }));
    }

    scheduleRender();
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = toBoardPoint(event, scrollRef.current, canvasRef.current, scaleRef.current);
    const drag = dragRef.current;
    if (!drag) return;

    if (drag.phase === 'pending-drop') return;

    if (drag.phase !== 'dragging') {
      // If we released on the same card and didn't drag, open the dialog
      // except for subtask checkbox area which is already handled in handlePointerDown
      const hit = hitTest(point, rectMapRef.current, data);
      if (hit.kind === 'subtask_subject') onView(hit.subtaskId);
      if (hit.kind === 'card_subject') onView(hit.issueId);
      transitionDragState('pointerup-cancel');
      return;
    }

    const target = resolveDropTarget(point, rectMapRef.current, data);
    const draggedIssue = state.cardsById.get(drag.issueId);
    if (!target || !canMove || !canMoveIssue(draggedIssue)) {
      transitionDragState('pointerup-cancel');
      return;
    }

    const issue = state.cardsById.get(drag.issueId);
    const assignedToId = laneIdToAssignee(data, target.laneId, issue?.assigned_to_id ?? null);
    const priorityId = laneIdToPriority(data, target.laneId, issue?.priority_id ?? null);
    const assessment = drag.targetCellKey === target.cellKey && drag.targetAssessment
      ? drag.targetAssessment
      : assessDrop(
        drag.origin.statusId,
        drag.origin.laneId,
        target.statusId,
        target.laneId,
        drag.allowedStatusIds,
        data.meta.lane_type,
      );
    if (!shouldDispatchDrop(assessment)) {
      transitionDragState('pointerup-cancel');
      return;
    }
    const accepted = onCommand({
      type: 'move_issue',
      issueId: drag.issueId,
      statusId: target.statusId,
      laneId: target.laneId,
      assignedToId,
      priorityId,
    });
    if (!accepted) {
      transitionDragState('pointerup-rejected');
      return;
    }

    transitionDragState('pointerup-dispatch');
    drag.dropTargetCellKey = target.cellKey;
    setCursor(getBoardCursor({ phase: 'pending-drop' }));
    schedulePendingDropFallback();
    scheduleRender();
    return;
  };

  const handlePointerLifecycle = (event: 'pointercancel' | 'lostpointercapture' | 'pointerleave') => {
    clearHoverState();
    const drag = dragRef.current;
    if (!drag) return;
    transitionDragState(event);
  };

  const handlePointerCancel = () => handlePointerLifecycle('pointercancel');

  const handleLostPointerCapture = () => handlePointerLifecycle('lostpointercapture');

  const handlePointerLeave = () => handlePointerLifecycle('pointerleave');

  return (
    <div
      ref={containerRef}
      className="rk-canvas-board"
      role="region"
aria-label={labels.board_aria}
    >
      <canvas
        ref={canvasRef}
        className="rk-canvas"
        tabIndex={-1}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handleLostPointerCapture}
        onPointerLeave={handlePointerLeave}
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
);

function getCanvasDevicePixelRatio() {
  if (typeof window === 'undefined') return 1;
  return Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
}

function resizeCanvasBackingStoreIfNeeded(
  canvas: HTMLCanvasElement,
  backingStore: CanvasBackingStoreState,
  cssWidth: number,
  cssHeight: number,
  dpr: number
) {
  const backingWidth = Math.round(cssWidth * dpr);
  const backingHeight = Math.round(cssHeight * dpr);
  if (
    backingStore.width === backingWidth &&
    backingStore.height === backingHeight &&
    backingStore.dpr === dpr
  ) {
    return;
  }

  canvas.width = backingWidth;
  canvas.height = backingHeight;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  backingStore.width = backingWidth;
  backingStore.height = backingHeight;
  backingStore.dpr = dpr;
}
