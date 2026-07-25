import { describe, expect, it } from 'vitest';
import { togglePriorityFilter } from './toolbarOptions';

describe('togglePriorityFilter', () => {
  it('normalizes selecting all priority options to a disabled filter', () => {
    expect(togglePriorityFilter(['1', '2'], 2)).toEqual({
      priority: [],
      priorityFilterEnabled: false,
    });
  });

  it('preserves a partial selection as an enabled filter', () => {
    expect(togglePriorityFilter(['2'], 2)).toEqual({
      priority: ['2'],
      priorityFilterEnabled: true,
    });
  });
});
