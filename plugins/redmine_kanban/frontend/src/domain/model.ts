import { Issue, Column, Lane, Meta, Lists } from '../ui/types';

// Re-export basic types
export type { Issue, Column, Lane, Meta, Lists };

// Normalized Domain Entities
export interface Card extends Issue {
  // Add any frontend-specific transient flags here if needed,
  // though we should try to keep it pure.
  _isDirty?: boolean;
}

// Normalized State Root
export interface BoardState {
  // Database Entities (Normalized)
  entities: {
    cards: Record<number, Card>;
    columns: Record<number, Column>;
    lanes: Record<string | number, Lane>;
  };

  // Order & Structure
  structure: {
    columnIds: number[]; // Ordered list of column IDs
    laneIds: (string | number)[]; // Ordered list of lane IDs
    // Map: `${columnId}:${laneId}` -> cardId[]
    board: Record<string, number[]>;
  };

  meta: Meta;
  lists: Lists; // For dropdowns etc.

  // Conflict Detection
  version: number; // specific to this client session or synced
  lastSyncTime: number;
}

// Layout / Geometry Types
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// The 'RectMap' is the single source of truth for HIT TESTING and RENDERING positions.
// It is derived from BoardState + View settings (but view settings like scroll might be separate).
// The prompt says: "Logical position... and screen position separate".
// "All rendering/judgment based on RectMap".
export interface RectMap {
  columns: Record<number, Rect>; // columnId -> Rect (header area or full column?)
  lanes: Record<string | number, Rect>; // laneId -> Rect (row header)
  // intersection cells (Column X Lane) background area
  cells: Record<string, Rect>; // key: `${columnId}:${laneId}`
  // Cards
  cards: Record<number, Rect>; // cardId -> Rect

  // Board dimensions
  boardWidth: number;
  boardHeight: number;
}

// View State (Scroll, Zoom, etc) - managed separately from Domain State?
// The prompt says "UI Shell: Routing, Auth, Filter".
// "Canvas Board: Draw, HitTest, DnD, Scroll".
// Scroll is likely a View transform.
export interface ViewState {
  scrollX: number;
  scrollY: number;
  viewportW: number;
  viewportH: number;
  isDragging: boolean;
  draggedCardId: number | null;
  dragStartX: number;
  dragStartY: number;
  dragCurrentX: number;
  dragCurrentY: number;
}
