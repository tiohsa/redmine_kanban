import { describe, expect, it } from 'vitest';
import { normalizeAssigneeIds, normalizeProjectIds, normalizeTrackerIds, resolveDefaultCreateProjectId } from './App';

describe('App board scope helpers', () => {
  it('keeps only allowed project, assignee, and tracker selections', () => {
    expect(normalizeProjectIds([1, 2, 3], new Set([1, 3]))).toEqual([1, 3]);
    expect(normalizeAssigneeIds(['unassigned', '2', '9'], new Set(['2']))).toEqual(['unassigned', '2']);
    expect(normalizeTrackerIds([1, 2, 3], new Set([2]))).toEqual([2]);
  });

  it('selects a creatable project with the board project as fallback', () => {
    expect(resolveDefaultCreateProjectId([2, 1], new Set([1]), 1)).toBe(1);
    expect(resolveDefaultCreateProjectId([2], new Set(), 1)).toBeNull();
  });
});
