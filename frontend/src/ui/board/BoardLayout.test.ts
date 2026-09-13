import { describe, expect, it, vi } from 'vitest';
import type { BoardData, Issue } from '../types';
import {
  computeLayout,
  makeCardHeightCacheKey,
  makeSubtaskSignature,
  measureCardHeight,
  measureCardHeightCached,
} from './BoardLayout';
import { getMetrics } from './metrics';
import { cellKey, type BoardState } from './state';

function makeIssue(id: number, attrs: Partial<Issue> = {}): Issue {
  return {
    id, subject: `Issue ${id}`, status_id: 1, tracker_id: 1,
    description: '', assigned_to_id: null,
    urls: { issue: `/issues/${id}`, issue_edit: `/issues/${id}/edit` },
    ...attrs,
  };
}

function makeBoard(laneType: BoardData['meta']['lane_type'] = 'none') {
  const data: BoardData = {
    ok: true,
    meta: {
      project_id: 1, current_user_id: 10, can_move: true, can_create: true,
      can_delete: true, lane_type: laneType, aging_warn_days: 3,
      aging_danger_days: 7, aging_exclude_closed: true,
    },
    columns: [], lanes: [], issues: [], labels: {},
    lists: { assignees: [], trackers: [], priorities: [], projects: [], viewable_projects: [], creatable_projects: [] },
  };
  const state: BoardState = {
    columns: [], lanes: [], columnOrder: [1, 2], laneOrder: ['none'],
    cardsById: new Map(), cardsByCell: new Map(),
  };
  return { data, state };
}

describe('BoardLayout geometry', () => {
  const metrics = getMetrics(14);

  it('keeps the exact empty no-lane layout and ignores laneOrder', () => {
    const { data, state } = makeBoard();
    state.laneOrder = [9, 4];
    expect(computeLayout(state, data, true, metrics)).toEqual({
      gridStartX: 0, gridWidth: 520, headerHeight: 40,
      laneLayouts: [{ laneId: 'none', y: 40, height: 24 }],
      boardWidth: 520, boardHeight: 88, columnWidth: 260,
    });
  });

  it.each([
    ['none', 803, 'width', 398, 803],
    ['category', 803, 'width', 338, 803],
    ['category', 300, 'width', 200, 527],
    ['category', 0, 'width', 260, 647],
    ['category', -1, 'width', 260, 647],
    ['category', 803, 'none', 260, 647],
  ] as const)('preserves column rounding/gaps: %s, %s, %s', (laneType, width, fitMode, columnWidth, boardWidth) => {
    const { data, state } = makeBoard(laneType);
    const layout = computeLayout(state, data, false, { ...metrics, columnGap: 7 }, width, fitMode);
    expect(layout.columnWidth).toBe(columnWidth);
    expect(layout.boardWidth).toBe(boardWidth);
  });

  it.each(['none', 'category'] as const)('handles zero columns and zero lanes for %s', (laneType) => {
    const { data, state } = makeBoard(laneType);
    state.columnOrder = [];
    state.laneOrder = [];
    const layout = computeLayout(state, data, true, metrics, 800, 'width');
    expect(layout).toEqual({
      gridStartX: laneType === 'none' ? 0 : 120, gridWidth: 0,
      headerHeight: 40, columnWidth: 260,
      laneLayouts: laneType === 'none' ? [{ laneId: 'none', y: 40, height: 0 }] : [],
      boardWidth: laneType === 'none' ? 0 : 120, boardHeight: 64,
    });
  });

  it.each(['category', 'priority', 'assignee'] as const)('preserves %s lane order, tallest cell, missing-card gaps and empty-lane minimum', (laneType) => {
    const { data, state } = makeBoard(laneType);
    state.laneOrder = [7, 'unassigned', 3];
    state.cardsById.set(1, makeIssue(1));
    state.cardsById.set(2, makeIssue(2));
    state.cardsByCell.set(cellKey(1, 7), [1, 999, 2]);
    state.cardsByCell.set(cellKey(2, 7), [1]);
    state.cardsByCell.set(cellKey(1, 3), [2]);
    const before = structuredClone(state);
    const layout = computeLayout(state, data, false, metrics);
    expect(layout.laneLayouts).toEqual([
      { laneId: 7, y: 40, height: 200 },
      { laneId: 'unassigned', y: 240, height: 32 },
      { laneId: 3, y: 272, height: 102 },
    ]);
    expect(layout.boardHeight).toBe(398);
    expect(computeLayout(state, data, true, metrics)).toEqual(layout);
    expect(state).toEqual(before);
  });

  it('uses fitted column width for measurement and keeps metrics unchanged', () => {
    const { data, state } = makeBoard();
    state.cardsById.set(1, makeIssue(1));
    state.cardsByCell.set(cellKey(1, 'none'), [1]);
    const measureLines = vi.fn((_text: string, width: number) => width < 250 ? 2 : 1);
    const fixed = computeLayout(state, data, false, metrics, 800, 'none', measureLines, 14);
    const fitted = computeLayout(state, data, false, metrics, 800, 'width', measureLines, 14);
    expect(measureLines.mock.calls).toEqual([['Issue 1', 215, 14], ['Issue 1', 355, 14]]);
    expect(fixed.laneLayouts[0].height).toBe(119);
    expect(fitted.laneLayouts[0].height).toBe(102);
    expect(metrics.columnWidth).toBe(260);
  });
});

describe('BoardLayout card height', () => {
  const metrics = getMetrics(14);

  it('accounts for project rows, nested subtasks and measured subject lines', () => {
    const issue = makeIssue(1, {
      project: { id: 2, name: 'External' },
      subtasks: [{ id: 2, subject: 'Child', status_id: 1, is_closed: false,
        subtasks: [{ id: 3, subject: 'Grandchild', status_id: 1, is_closed: true }] }],
    });
    expect(measureCardHeight(issue, metrics, () => 2, 14, 260, 1)).toBe(186);
    expect(measureCardHeight(issue, metrics, () => 1, 14, 260, 2)).toBe(150);
    expect(measureCardHeight(issue, metrics, undefined, undefined, undefined, 1)).toBe(168);
    expect(makeSubtaskSignature(issue)).toBe('2:3:1');
  });

  it.each([0, 1, 2])('uses %s measured subject lines', (lines) => {
    expect(measureCardHeight(makeIssue(1), metrics, () => lines, 14, 260)).toBe(lines > 1 ? 95 : 78);
  });

  it('does not measure text without a usable font size or width', () => {
    const measureLines = vi.fn(() => 2);
    for (const [fontSize, width] of [[undefined, 260], [14, undefined], [0, 260], [14, 0]]) {
      expect(measureCardHeight(makeIssue(1), metrics, measureLines, fontSize, width)).toBe(78);
    }
    expect(measureLines).not.toHaveBeenCalled();
  });

  it('retains cache keys, hits, caller invalidation and uncached measurement', () => {
    const issue = makeIssue(1);
    const cache = new Map<string, number>();
    const measureLines = vi.fn(() => 2);
    const height = () => measureCardHeightCached(issue, metrics, cache, measureLines, 14, 260, 1);
    expect(makeCardHeightCacheKey(issue, undefined, undefined)).toBe('1|Issue 1|0:0:0|default|default|default');
    expect(height()).toBe(95);
    expect(height()).toBe(95);
    expect(measureLines).toHaveBeenCalledTimes(1);
    cache.clear();
    expect(height()).toBe(95);
    expect(measureLines).toHaveBeenCalledTimes(2);
    expect(measureCardHeightCached(issue, metrics, undefined, measureLines, 14, 260, 1)).toBe(95);
    expect(measureLines).toHaveBeenCalledTimes(3);
  });

  it('separates cache entries for subject, subtasks, font, width and project scope', () => {
    const issue = makeIssue(1);
    const cache = new Map<string, number>();
    const measureLines = vi.fn(() => 2);
    const variants: [Issue, number, number, number][] = [
      [issue, 14, 260, 1],
      [{ ...issue, subject: 'Changed' }, 14, 260, 1],
      [{ ...issue, subtasks: [{ id: 2, subject: 'Child', status_id: 1, is_closed: false }] }, 14, 260, 1],
      [{ ...issue, subtasks: [{ id: 2, subject: 'Child', status_id: 1, is_closed: true }] }, 14, 260, 1],
      [issue, 15, 260, 1], [issue, 14, 400, 1], [issue, 14, 260, 2],
    ];
    for (const [card, font, width, project] of variants) {
      const expected = measureCardHeight(card, metrics, () => 2, font, width, project);
      expect(measureCardHeightCached(card, metrics, cache, measureLines, font, width, project)).toBe(expected);
    }
    expect(measureLines).toHaveBeenCalledTimes(variants.length);
    expect(cache.size).toBe(variants.length);
  });
});
