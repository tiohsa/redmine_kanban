import { describe, expect, it } from 'vitest';
import { normalizeMaximumBoardEntityCount, parseMaximumBoardEntityCount } from './useKanbanPreferences';

describe('snapshot admission preference state machine', () => {
  it.each(['0', '-1', '1.5', '1e5', 'NaN', 'Infinity'])('rejects non-positive, fractional, or non-finite input %s', (value) => {
    expect(parseMaximumBoardEntityCount(value)).toBeNull();
  });

  it('normalizes missing and blank values to the product default', () => {
    expect(normalizeMaximumBoardEntityCount(undefined)).toBe(1500);
    expect(normalizeMaximumBoardEntityCount('')).toBe(1500);
    expect(normalizeMaximumBoardEntityCount(' 1500 ')).toBe(1500);
  });

  it('accepts positive integer values only', () => {
    expect(parseMaximumBoardEntityCount('1')).toBe(1);
    expect(parseMaximumBoardEntityCount('5000')).toBe(5000);
  });
});
