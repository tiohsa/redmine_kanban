import { describe, expect, it } from 'vitest';
import type { Issue } from '../types';
import { sortIssues } from './sort';

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

    const sorted = sortIssues(issues, 'due_asc', new Map());
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

    const sorted = sortIssues(issues, 'priority_desc', rank);
    expect(sorted.map((i) => i.id)).toEqual([1, 3, 2, 4]);
  });

  it('uses issue id tie-breaker when values are equal', () => {
    const issues = [
      makeIssue(8, { updated_on: '2026-02-01T10:00:00Z' }),
      makeIssue(3, { updated_on: '2026-02-01T10:00:00Z' }),
    ];

    const sorted = sortIssues(issues, 'updated_desc', new Map());
    expect(sorted.map((i) => i.id)).toEqual([3, 8]);
  });
});
