import { describe, expect, it } from 'vitest';
import { flattenIssueTree, mergeIssueTrees, nestedIssueIds } from './boardTree';
import type { Issue, Subtask } from './types';

function makeIssue(id: number, attrs: Partial<Issue> = {}): Issue {
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

function makeSubtask(id: number, attrs: Partial<Subtask> = {}): Subtask {
  return {
    id,
    subject: `Subtask ${id}`,
    status_id: 1,
    is_closed: false,
    ...attrs,
  };
}

describe('mergeIssueTrees', () => {
  it('keeps an unloaded child root until its parent tree contains it', () => {
    const next = mergeIssueTrees(
      [makeIssue(1)],
      [makeIssue(2, { parent_id: 1 })],
    );

    expect(next.map((issue) => issue.id)).toEqual([1, 2]);
  });

  it('attaches a recovered child only when the subtree page explicitly targets its parent', () => {
    const next = mergeIssueTrees(
      [makeIssue(1)],
      [makeIssue(2, { parent_id: 1 })],
      [1],
    );

    expect(next.map((issue) => issue.id)).toEqual([1]);
    expect(next[0]?.subtasks?.map((subtask) => subtask.id)).toEqual([2]);
  });

  it('converges to the same canonical tree when parent and child pages arrive in either order', () => {
    const parent = makeIssue(1, {
      subtasks: [makeSubtask(2, { tracker_id: 2 })],
    });
    const child = makeIssue(2, { parent_id: 1, tracker_id: 2 });

    const forward = mergeIssueTrees([parent], [child]);
    const reverse = mergeIssueTrees([child], [parent]);

    expect(reverse.map((issue) => issue.id)).toEqual(forward.map((issue) => issue.id));
    expect(reverse[0]?.subtasks?.map((subtask) => subtask.id)).toEqual([2]);
    expect(forward[0]?.subtasks?.[0]?.tracker_id).toBe(2);
    expect(reverse[0]?.subtasks?.[0]?.tracker_id).toBe(2);
  });

  it('does not duplicate an issue represented in both root and nested form', () => {
    const next = mergeIssueTrees([
      makeIssue(1, { subtasks: [makeSubtask(2)] }),
      makeIssue(2, { parent_id: 1 }),
    ], []);

    expect(next.map((issue) => issue.id)).toEqual([1]);
    expect(nestedIssueIds(next)).toEqual(new Set([2]));
  });

  it('breaks a corrupt cycle without dropping the canonical root', () => {
    const next = mergeIssueTrees([
      makeIssue(1, {
        subtasks: [makeSubtask(2, { subtasks: [makeSubtask(1)] })],
      }),
    ], []);

    expect(next.map((issue) => issue.id)).toEqual([1]);
    expect(next[0]?.subtasks?.map((subtask) => subtask.id)).toEqual([2]);
    expect(next[0]?.subtasks?.[0]?.subtasks).toEqual([]);
  });
});

describe('flattenIssueTree', () => {
  it('preserves every canonical issue when subtasks are rendered as separate cards', () => {
    const tree = [makeIssue(1, {
      subtasks: [makeSubtask(2, { subtasks: [makeSubtask(3)] })],
    })];

    const flattened = flattenIssueTree(tree);

    expect(flattened.map((issue) => issue.id)).toEqual([1, 2, 3]);
    expect(flattened.map((issue) => issue.parent_id)).toEqual([null, 1, 2]);
    expect(flattened.every((issue) => issue.subtasks?.length === 0)).toBe(true);
  });

  it('keeps a missing subtask tracker as unknown instead of converting it to a valid id', () => {
    const tree = [makeIssue(1, {
      subtasks: [makeSubtask(2)],
    })];

    const flattened = flattenIssueTree(tree);

    expect(flattened.find((issue) => issue.id === 2)?.tracker_id).toBeNull();
  });
});
