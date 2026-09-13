import { describe, expect, it } from 'vitest';
import type { BoardData } from '../types';
import { createRectMap, hitTest, hitTestCell } from './HitTestIndex';

const data = { meta: { lane_type: 'category' } } as BoardData;
const rect = { x: 10, y: 20, width: 30, height: 40 };

describe('HitTestIndex', () => {
  it('keeps interactive controls ahead of card and cell regions', () => {
    const index = createRectMap();
    index.cards.set(7, rect);
    index.cells.set('3:9', rect);
    index.subtaskAreas.set(7, rect);
    index.subtaskSubjects.set('7:8', rect);

    expect(hitTest({ x: 20, y: 30 }, index, data)).toEqual({
      kind: 'subtask_subject', issueId: 7, subtaskId: 8,
    });
  });

  it('returns subtask area before its parent card', () => {
    const index = createRectMap();
    index.cards.set(7, rect);
    index.subtaskAreas.set(7, rect);

    expect(hitTest({ x: 20, y: 30 }, index, data)).toEqual({ kind: 'subtask_area', issueId: 7 });
  });

  it('parses cell keys using the board lane semantics', () => {
    const index = createRectMap();
    index.cells.set('3:9', rect);
    index.addButtons.set('4:no_category', rect);

    expect(hitTestCell({ x: 20, y: 30 }, index, data)).toEqual({ statusId: 3, laneId: 9 });
    expect(hitTest({ x: 20, y: 30 }, index, data)).toEqual({ kind: 'add', statusId: 4, laneId: 'no_category' });
  });
});
