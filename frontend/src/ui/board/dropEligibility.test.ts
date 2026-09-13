import { describe, expect, it } from 'vitest';
import { assessDrop, getDropHintVisual, shouldDispatchDrop } from './canvasInteraction';

describe('drop assessment', () => {
  it('returns noop for the same status and lane', () => {
    expect(assessDrop(1, 'a', 1, 'a', [1, 2])).toEqual({ action: 'noop', workflowHint: 'allowed' });
  });

  it('returns allowed when the target status is in the issue workflow hint', () => {
    expect(assessDrop(1, 'a', 2, 'b', [1, 2])).toEqual({ action: 'dispatch', workflowHint: 'allowed' });
  });

  it('allows a status move within the same category lane', () => {
    expect(assessDrop(1, 10, 2, 10, [1, 2], 'category')).toEqual({ action: 'dispatch', workflowHint: 'allowed' });
  });

  it.each([
    ['category A to category B', 10, 20],
    ['category A to no category', 10, 'no_category'],
    ['no category to category A', 'no_category', 10],
  ])('forbids %s', (_description, originLaneId, targetLaneId) => {
    expect(assessDrop(1, originLaneId, 2, targetLaneId, [1, 2], 'category')).toEqual({
      action: 'forbidden',
      workflowHint: 'allowed',
    });
    expect(shouldDispatchDrop(assessDrop(1, originLaneId, 2, targetLaneId, [1, 2], 'category'))).toBe(false);
  });

  it('keeps non-category lane moves on the existing dispatch path', () => {
    expect(assessDrop(1, 10, 2, 20, [1, 2], 'priority')).toEqual({ action: 'dispatch', workflowHint: 'allowed' });
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

  it('does not provide a drop highlight for forbidden targets', () => {
    expect(getDropHintVisual({ action: 'forbidden', workflowHint: 'allowed' })).toEqual({ glyph: '', tone: 'forbidden' });
  });
});
