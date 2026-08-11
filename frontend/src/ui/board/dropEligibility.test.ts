import { describe, expect, it } from 'vitest';
import { dropEligibility, shouldDispatchDrop } from './canvasInteraction';

describe('dropEligibility', () => {
  it('returns noop for the same status and lane', () => {
    expect(dropEligibility(1, 'a', 1, 'a', [1, 2])).toBe('noop');
  });

  it('returns allowed when the target status is in the issue workflow hint', () => {
    expect(dropEligibility(1, 'a', 2, 'b', [1, 2])).toBe('allowed');
  });

  it('returns denied without blocking the command path', () => {
    expect(dropEligibility(1, 'a', 3, 'b', [1, 2])).toBe('denied');
  });

  it('returns unknown when workflow metadata is unavailable', () => {
    expect(dropEligibility(1, 'a', 2, 'b', undefined)).toBe('unknown');
  });

  it('dispatches denied and unknown drops but suppresses noop drops', () => {
    expect(shouldDispatchDrop('denied')).toBe(true);
    expect(shouldDispatchDrop('unknown')).toBe(true);
    expect(shouldDispatchDrop('noop')).toBe(false);
  });
});
