import { describe, expect, it } from 'vitest';
import { getBoardCursor } from './cursor';

describe('getBoardCursor', () => {
  it('returns pointer for card and subtask hover areas', () => {
    expect(getBoardCursor({ phase: 'idle', hitKind: 'card' })).toBe('pointer');
    expect(getBoardCursor({ phase: 'idle', hitKind: 'subtask_row' })).toBe('pointer');
    expect(getBoardCursor({ phase: 'idle', hitKind: 'subtask_area' })).toBe('pointer');
  });

  it('returns pointer for subject and action targets', () => {
    expect(getBoardCursor({ phase: 'idle', hitKind: 'card_subject' })).toBe('pointer');
    expect(getBoardCursor({ phase: 'idle', hitKind: 'subtask_subject' })).toBe('pointer');
    expect(getBoardCursor({ phase: 'idle', hitKind: 'edit' })).toBe('pointer');
  });

  it('returns default for empty areas', () => {
    expect(getBoardCursor({ phase: 'idle', hitKind: 'empty' })).toBe('default');
    expect(getBoardCursor({ phase: 'idle', hitKind: 'cell' })).toBe('default');
  });

  it('returns move while dragging', () => {
    expect(getBoardCursor({ phase: 'dragging', hitKind: 'card' })).toBe('move');
  });

  it('returns default during pending drop cleanup', () => {
    expect(getBoardCursor({ phase: 'pending-drop', hitKind: 'card' })).toBe('default');
  });
});
