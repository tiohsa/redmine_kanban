import React, { useRef, useEffect, useState, useCallback } from 'react';
import { BoardStore } from '../../store/BoardStore';
import { LayoutService } from '../../services/LayoutService';
import { RenderService } from '../../services/RenderService';
import { HitTestService } from '../../services/HitTestService';
import { ViewState } from '../../domain/model';
import { BoardData } from '../types';
import { OverlayManager } from '../overlays/OverlayManager';

interface CanvasBoardProps {
  initialData?: BoardData;
  baseUrl?: string;
}

export const CanvasBoard: React.FC<CanvasBoardProps> = ({ initialData, baseUrl }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Overlay State
  const [activeCardId, setActiveCardId] = useState<number | null>(null);

  // Store Instance
  // In a real app, this might come from Context or a Hook.
  // Since we are minimizing libs, we instantiate here or in a parent.
  // For persistence across re-renders without Context, useRef or global.
  const [store] = useState(() => new BoardStore(initialData, baseUrl));

  // Sync initialData prop to store (Handling updates from parent)
  useEffect(() => {
    if (initialData) {
      store.execute({
        type: 'RELOAD_BOARD',
        timestamp: Date.now(),
        payload: { data: initialData }
      });
    }
  }, [initialData, store]);

  // We use React state to trigger re-renders of the Overlay,
  // but Canvas renders are driven by requestAnimationFrame or subscription.
  // Actually, for a hybrid app, we might want to sync React state with Store for overlays.
  // For now, let's keep Canvas independent.

  // View State (Mutable Ref to avoid React Render Cycle on every scroll/drag)
  const viewState = useRef<ViewState>({
    scrollX: 0,
    scrollY: 0,
    viewportW: 0,
    viewportH: 0,
    isDragging: false,
    draggedCardId: null,
    dragStartX: 0,
    dragStartY: 0,
    dragCurrentX: 0,
    dragCurrentY: 0
  });

  const rectMapRef = useRef(LayoutService.calculateLayout(store.getState()));

  // Setup Resize Observer
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current && canvasRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        canvasRef.current.width = width;
        canvasRef.current.height = height;
        viewState.current.viewportW = width;
        viewState.current.viewportH = height;

        // Trigger redraw
        draw();
      }
    };

    window.addEventListener('resize', updateSize);
    updateSize(); // Initial
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Subscribe to Store
  useEffect(() => {
    const unsub = store.subscribe((newState) => {
      // Recalculate Layout on State Change
      rectMapRef.current = LayoutService.calculateLayout(newState);
      draw();
    });
    return unsub;
  }, [store]);

  const draw = useCallback(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    const renderService = new RenderService(ctx);
    renderService.render(store.getState(), rectMapRef.current, viewState.current);
  }, [store]);

  // Interaction Handlers
  const handleDoubleClick = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left + viewState.current.scrollX;
    const y = e.clientY - rect.top + viewState.current.scrollY;

    const hit = HitTestService.hitTest(rectMapRef.current, x, y);
    if (hit.type === 'CARD' && typeof hit.id === 'number') {
      setActiveCardId(hit.id);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left + viewState.current.scrollX;
    const y = e.clientY - rect.top + viewState.current.scrollY;

    const hit = HitTestService.hitTest(rectMapRef.current, x, y);

    if (hit.type === 'CARD' && typeof hit.id === 'number') {
       viewState.current.isDragging = true;
       viewState.current.draggedCardId = hit.id;
       viewState.current.dragStartX = e.clientX - rect.left; // Screen coords for drag delta
       viewState.current.dragStartY = e.clientY - rect.top;
       viewState.current.dragCurrentX = viewState.current.dragStartX;
       viewState.current.dragCurrentY = viewState.current.dragStartY;
       draw();
    } else if (hit.type === 'BOARD_BACKGROUND' || hit.type === 'CELL_BACKGROUND') {
       // Start Panning? Or Selection?
       // For now, let's implement Panning
       // viewState.current.isPanning = true;
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (viewState.current.isDragging) {
      const rect = canvasRef.current!.getBoundingClientRect();
      viewState.current.dragCurrentX = e.clientX - rect.left;
      viewState.current.dragCurrentY = e.clientY - rect.top;

      // Auto-scroll logic could go here

      requestAnimationFrame(draw);
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (viewState.current.isDragging && viewState.current.draggedCardId !== null) {
      // Commit Drop
      const rect = canvasRef.current!.getBoundingClientRect();
      // Drop location logic (Hit Test on "Lifted" coordinates?)
      // Actually we need to hit test where the center of the card is now.

      // Calculate dropped position in logical space
      const deltaX = viewState.current.dragCurrentX - viewState.current.dragStartX;
      const deltaY = viewState.current.dragCurrentY - viewState.current.dragStartY;

      const originalRect = rectMapRef.current.cards[viewState.current.draggedCardId];
      if (originalRect) {
        const dropX = originalRect.x + deltaX + originalRect.w / 2;
        const dropY = originalRect.y + deltaY + originalRect.h / 2;

        // Find drop target
        const hit = HitTestService.hitTest(rectMapRef.current, dropX, dropY);

        if (hit.context && typeof hit.context.columnId === 'number') {
           // Move Card Command
           store.execute({
             type: 'MOVE_CARD',
             timestamp: Date.now(),
             payload: {
               cardId: viewState.current.draggedCardId,
               fromColumnId: 0, // Need to lookup from state or HitTest origin
               fromLaneId: 0,
               toColumnId: hit.context.columnId,
               toLaneId: hit.context.laneId || 0,
               newIndex: 0 // Simplistic: Insert at top or calculate index based on Y
             }
           });
        }
      }

      viewState.current.isDragging = false;
      viewState.current.draggedCardId = null;
      draw();
    }
  };

  // Wheel (Scroll)
  const handleWheel = (e: React.WheelEvent) => {
    viewState.current.scrollX = Math.max(0, viewState.current.scrollX + e.deltaX);
    viewState.current.scrollY = Math.max(0, viewState.current.scrollY + e.deltaY);
    draw();
  };

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
        style={{ display: 'block' }}
      />
      <OverlayManager
        store={store}
        activeCardId={activeCardId}
        onClose={() => setActiveCardId(null)}
      />
    </div>
  );
};
