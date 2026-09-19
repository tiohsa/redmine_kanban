import { describe, expect, it } from 'vitest';
import type { Issue } from '../types';
import { normalizeSortConfig, parseSortConfig, sortIssues } from './sort';

function makeIssue(
  id: number,
  attrs: Partial<Issue> = {}
): Issue {
  return {
    id,
    subject: `Issue ${id}`,
    status_id: 1,
    tracker_id: 1,
    description: '',
    assigned_to_id: null,
    urls: { issue: `/issues/${id}`, issue_edit: `/issues/${id}/edit` },
    ...attrs,
  };
}

describe('sortIssues', () => {
  it('sorts by due date ascending with nulls at the end', () => {
    const issues = [
      makeIssue(1, { due_date: null }),
      makeIssue(2, { due_date: '2026-02-10' }),
      makeIssue(3, { due_date: '2026-02-09' }),
    ];

    const sorted = sortIssues(issues, [{ field: 'due', direction: 'asc' }], new Map());
    expect(sorted.map((i) => i.id)).toEqual([3, 2, 1]);
  });

  it('sorts by priority descending using rank map', () => {
    const issues = [
      makeIssue(1, { priority_id: 3 }),
      makeIssue(2, { priority_id: 1 }),
      makeIssue(3, { priority_id: 2 }),
      makeIssue(4, { priority_id: null }),
    ];
    const rank = new Map<number, number>([
      [1, 0],
      [2, 1],
      [3, 2],
    ]);

    const sorted = sortIssues(issues, [{ field: 'priority', direction: 'desc' }], rank);
    expect(sorted.map((i) => i.id)).toEqual([1, 3, 2, 4]);
  });

  it('sorts by due date descending with nulls at the end', () => {
    const issues = [
      makeIssue(1, { due_date: '2026-09-20' }),
      makeIssue(2, { due_date: '2026-09-21' }),
      makeIssue(3, { due_date: null }),
    ];

    expect(sortIssues(issues, [{ field: 'due', direction: 'desc' }], new Map()).map((i) => i.id)).toEqual([2, 1, 3]);
  });

  it('sorts by priority ascending using rank map', () => {
    const issues = [
      makeIssue(1, { priority_id: 3 }),
      makeIssue(2, { priority_id: 1 }),
      makeIssue(3, { priority_id: 2 }),
      makeIssue(4, { priority_id: null }),
    ];
    const rank = new Map<number, number>([[1, 0], [2, 1], [3, 2]]);

    expect(sortIssues(issues, [{ field: 'priority', direction: 'asc' }], rank).map((i) => i.id)).toEqual([2, 3, 1, 4]);
  });

  it('sorts by updated date ascending with nulls at the end', () => {
    const issues = [
      makeIssue(1, { updated_on: '2026-09-21T00:00:00Z' }),
      makeIssue(2, { updated_on: '2026-09-20T00:00:00Z' }),
      makeIssue(3, { updated_on: null }),
    ];

    expect(sortIssues(issues, [{ field: 'updated', direction: 'asc' }], new Map()).map((i) => i.id)).toEqual([2, 1, 3]);
  });

  it('uses issue id tie-breaker when values are equal', () => {
    const issues = [
      makeIssue(8, { updated_on: '2026-02-01T10:00:00Z' }),
      makeIssue(3, { updated_on: '2026-02-01T10:00:00Z' }),
    ];

    const sorted = sortIssues(issues, [{ field: 'updated', direction: 'desc' }], new Map());
    expect(sorted.map((i) => i.id)).toEqual([3, 8]);
  });

  it('evaluates the next criterion when the previous one is equal', () => {
    const issues = [
      makeIssue(1, { due_date: '2026-09-20', priority_id: 1 }),
      makeIssue(2, { due_date: '2026-09-20', priority_id: 3 }),
      makeIssue(3, { due_date: '2026-09-21', priority_id: 3 }),
    ];
    const rank = new Map<number, number>([[1, 0], [3, 2]]);

    const sorted = sortIssues(issues, [
      { field: 'due', direction: 'asc' },
      { field: 'priority', direction: 'desc' },
    ], rank);

    expect(sorted.map((i) => i.id)).toEqual([2, 1, 3]);
  });

  it('evaluates three criteria in order before using the id tie-breaker', () => {
    const issues = [
      makeIssue(8, { due_date: '2026-09-20', priority_id: 1, updated_on: '2026-09-20T09:00:00Z' }),
      makeIssue(3, { due_date: '2026-09-20', priority_id: 1, updated_on: '2026-09-20T09:00:00Z' }),
      makeIssue(5, { due_date: '2026-09-20', priority_id: 1, updated_on: '2026-09-20T10:00:00Z' }),
    ];

    const sorted = sortIssues(issues, [
      { field: 'due', direction: 'asc' },
      { field: 'priority', direction: 'desc' },
      { field: 'updated', direction: 'desc' },
    ], new Map([[1, 0]]));

    expect(sorted.map((i) => i.id)).toEqual([5, 3, 8]);
  });

  it('keeps null and invalid values last for both directions', () => {
    const issues = [
      makeIssue(1, { due_date: null }),
      makeIssue(2, { due_date: 'not-a-date' }),
      makeIssue(3, { due_date: '2026-09-20' }),
    ];

    expect(sortIssues(issues, [{ field: 'due', direction: 'asc' }], new Map()).map((i) => i.id)).toEqual([3, 1, 2]);
    expect(sortIssues(issues, [{ field: 'due', direction: 'desc' }], new Map()).map((i) => i.id)).toEqual([3, 1, 2]);
  });

  it('keeps null priority and updated values last regardless of direction', () => {
    const priorityIssues = [
      makeIssue(1, { priority_id: null }),
      makeIssue(2, { priority_id: 1 }),
      makeIssue(3, { priority_id: 99 }),
    ];
    const updatedIssues = [
      makeIssue(4, { updated_on: null }),
      makeIssue(5, { updated_on: '2026-09-20T00:00:00Z' }),
      makeIssue(6, { updated_on: 'invalid' }),
    ];

    expect(sortIssues(priorityIssues, [{ field: 'priority', direction: 'asc' }], new Map([[1, 0]])).map((i) => i.id)).toEqual([2, 1, 3]);
    expect(sortIssues(priorityIssues, [{ field: 'priority', direction: 'desc' }], new Map([[1, 0]])).map((i) => i.id)).toEqual([2, 1, 3]);
    expect(sortIssues(updatedIssues, [{ field: 'updated', direction: 'asc' }], new Map()).map((i) => i.id)).toEqual([5, 4, 6]);
    expect(sortIssues(updatedIssues, [{ field: 'updated', direction: 'desc' }], new Map()).map((i) => i.id)).toEqual([5, 4, 6]);
  });
});

describe('sort configuration', () => {
  it.each(['due_asc', 'due_desc', 'priority_asc', 'priority_desc', 'updated_asc', 'updated_desc'])('migrates legacy key %s', (key) => {
    const config = parseSortConfig(key);
    expect(config).toHaveLength(1);
    expect(config[0].field).toBe(key.split('_')[0]);
    expect(config[0].direction).toBe(key.endsWith('_asc') ? 'asc' : 'desc');
  });

  const invalidConfigs: unknown[] = [
    [{ field: 'unknown', direction: 'asc' }],
    [{ field: 'due', direction: 'sideways' }],
    [{ field: 'due', direction: 'asc' }, { field: 'due', direction: 'desc' }],
    [{ field: 'due', direction: 'asc' }, { field: 'priority', direction: 'desc' }, { field: 'updated', direction: 'asc' }, { field: 'unknown', direction: 'desc' }],
  ];

  it.each(invalidConfigs)('falls back for invalid config %j', (value) => {
    expect(normalizeSortConfig(value)).toEqual([{ field: 'updated', direction: 'desc' }]);
  });
});
