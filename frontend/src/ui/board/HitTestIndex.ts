import type { BoardData } from '../types';
import { pointInRect, type Rect } from './canvasGeometry';
import type { HitResult } from './canvasInteraction';
import { parseCellKey, parseSubtaskKey } from './keys';

/** Interactive regions produced while rendering a board. */
export type RectMap = {
  cards: Map<number, Rect>;
  cells: Map<string, Rect>;
  addButtons: Map<string, Rect>;
  deleteButtons: Map<number, Rect>;
  workTimerButtons: Map<number, Rect>;
  subtaskRows: Map<string, Rect>;
  subtaskChecks: Map<string, Rect>;
  subtaskSubjects: Map<string, Rect>;
  subtaskWorkTimerButtons: Map<string, Rect>;
  subtaskEditButtons: Map<string, Rect>;
  subtaskDeleteButtons: Map<string, Rect>;
  subtaskAreas: Map<number, Rect>;
  cardSubjects: Map<number, Rect>;
  editButtons: Map<number, Rect>;
  visibilityButtons: Map<number, Rect>;
  priorityBadges: Map<number, Rect>;
  dateBadges: Map<number, Rect>;
  progressDonuts: Map<number, Rect>;
  laneHeaders: Map<string | number, Rect>;
};

export function createRectMap(): RectMap {
  return {
    cards: new Map(),
    cells: new Map(),
    addButtons: new Map(),
    deleteButtons: new Map(),
    workTimerButtons: new Map(),
    subtaskRows: new Map(),
    subtaskChecks: new Map(),
    subtaskSubjects: new Map(),
    subtaskWorkTimerButtons: new Map(),
    subtaskEditButtons: new Map(),
    subtaskDeleteButtons: new Map(),
    subtaskAreas: new Map(),
    cardSubjects: new Map(),
    editButtons: new Map(),
    visibilityButtons: new Map(),
    priorityBadges: new Map(),
    dateBadges: new Map(),
    progressDonuts: new Map(),
    laneHeaders: new Map(),
  };
}

export function hitTest(
  point: { x: number; y: number },
  rectMap: RectMap,
  data: BoardData,
): HitResult {
  for (const [issueId, rect] of rectMap.workTimerButtons) {
    if (pointInRect(point, rect)) return { kind: 'work_timer', issueId };
  }
  for (const [key, rect] of rectMap.subtaskWorkTimerButtons) {
    if (pointInRect(point, rect)) {
      const { issueId, subtaskId } = parseSubtaskKey(key);
      return { kind: 'subtask_work_timer', issueId, subtaskId };
    }
  }
  for (const [key, rect] of rectMap.subtaskEditButtons) {
    if (pointInRect(point, rect)) {
      const { issueId, subtaskId } = parseSubtaskKey(key);
      return { kind: 'subtask_edit', issueId, subtaskId };
    }
  }
  for (const [key, rect] of rectMap.subtaskDeleteButtons) {
    if (pointInRect(point, rect)) {
      const { issueId, subtaskId } = parseSubtaskKey(key);
      return { kind: 'subtask_delete', issueId, subtaskId };
    }
  }
  for (const [key, rect] of rectMap.subtaskChecks) {
    if (pointInRect(point, rect)) {
      const { issueId, subtaskId } = parseSubtaskKey(key);
      return { kind: 'subtask_check', issueId, subtaskId };
    }
  }
  for (const [key, rect] of rectMap.subtaskSubjects) {
    if (pointInRect(point, rect)) {
      const { issueId, subtaskId } = parseSubtaskKey(key);
      return { kind: 'subtask_subject', issueId, subtaskId };
    }
  }
  for (const [key, rect] of rectMap.subtaskRows) {
    if (pointInRect(point, rect)) {
      const { issueId, subtaskId } = parseSubtaskKey(key);
      return { kind: 'subtask_row', issueId, subtaskId };
    }
  }
  for (const [issueId, rect] of rectMap.editButtons) {
    if (pointInRect(point, rect)) return { kind: 'edit', issueId };
  }
  for (const [issueId, rect] of rectMap.deleteButtons) {
    if (pointInRect(point, rect)) return { kind: 'delete', issueId };
  }
  for (const [statusId, rect] of rectMap.visibilityButtons) {
    if (pointInRect(point, rect)) return { kind: 'visibility', statusId };
  }
  for (const [issueId, rect] of rectMap.priorityBadges) {
    if (pointInRect(point, rect)) return { kind: 'priority', issueId };
  }
  for (const [issueId, rect] of rectMap.dateBadges) {
    if (pointInRect(point, rect)) return { kind: 'date', issueId };
  }
  for (const [issueId, rect] of rectMap.progressDonuts) {
    if (pointInRect(point, rect)) return { kind: 'progress', issueId };
  }
  for (const [issueId, rect] of rectMap.cardSubjects) {
    if (pointInRect(point, rect)) return { kind: 'card_subject', issueId };
  }
  // Keep the existing duplicate check so this extraction does not alter the
  // established hit priority or iteration behavior.
  for (const [issueId, rect] of rectMap.deleteButtons) {
    if (pointInRect(point, rect)) return { kind: 'delete', issueId };
  }
  // A subtask area wins over its parent card and prevents opening the parent.
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
  for (const [laneId, rect] of rectMap.laneHeaders) {
    if (pointInRect(point, rect)) return { kind: 'lane_header', laneId };
  }
  for (const [key, rect] of rectMap.cells) {
    if (pointInRect(point, rect)) {
      const [statusId, laneId] = parseCellKey(key, data);
      return { kind: 'cell', statusId, laneId };
    }
  }
  return { kind: 'empty' };
}

export function hitTestCell(
  point: { x: number; y: number },
  rectMap: RectMap,
  data: BoardData,
): { statusId: number; laneId: string | number } | null {
  for (const [key, rect] of rectMap.cells) {
    if (pointInRect(point, rect)) {
      const [statusId, laneId] = parseCellKey(key, data);
      return { statusId, laneId };
    }
  }
  return null;
}
