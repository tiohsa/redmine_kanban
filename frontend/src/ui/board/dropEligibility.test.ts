import { describe, expect, it } from 'vitest';
import { assessDrop, getDropHintVisual, shouldDispatchDrop } from './canvasInteraction';

describe('drop assessment', () => {
  it('returns noop for the same status and lane', () => {
    expect(assessDrop(1, 'a', 1, 'a', [1, 2])).toEqual({ action: 'noop', workflowHint: 'allowed' });
  });

  it('returns allowed when the target status is in the issue workflow hint', () => {
    expect(assessDrop(1, 'a', 2, 'b', [1, 2])).toEqual({ action: 'dispatch', workflowHint: 'allowed' });
  });

  it('returns denied without blocking the command path', () => {
    const assessment = assessDrop(1, 'a', 3, 'b', [1, 2]);
    expect(assessment).toEqual({ action: 'dispatch', workflowHint: 'denied' });
    expect(shouldDispatchDrop(assessment)).toBe(true);
  });

  it('returns unknown when workflow metadata is unavailable', () => {
    expect(assessDrop(1, 'a', 2, 'b', undefined)).toEqual({ action: 'dispatch', workflowHint: 'unknown' });
  });

  it('dispatches only dispatch actions and keeps denied as advisory', () => {
    expect(shouldDispatchDrop({ action: 'dispatch', workflowHint: 'unknown' })).toBe(true);
    expect(shouldDispatchDrop({ action: 'noop', workflowHint: 'unknown' })).toBe(false);
  });

  it('uses advisory and neutral visuals instead of a hard-denial cross', () => {
    expect(getDropHintVisual({ action: 'dispatch', workflowHint: 'denied' })).toMatchObject({ glyph: '!', tone: 'advisory' });
    expect(getDropHintVisual({ action: 'dispatch', workflowHint: 'denied' }).glyph).not.toBe('×');
    expect(getDropHintVisual({ action: 'dispatch', workflowHint: 'unknown' })).toMatchObject({ glyph: '?', tone: 'neutral' });
    expect(getDropHintVisual({ action: 'noop', workflowHint: 'unknown' })).toMatchObject({ glyph: '', tone: 'noop' });
  });
});
