// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardData, Issue } from '../types';
import { CanvasBoard } from './CanvasBoard';
import { buildBoardState } from './state';

function makeIssue(id: number, attrs: Partial<Issue> = {}): Issue {
  return {
    id,
    subject: `Issue ${id}`,
    status_id: 1,
    tracker_id: 1,
    description: '',
    assigned_to_id: null,
    lock_version: 1,
    permissions: {
      can_move: true,
      can_edit: true,
      can_delete: true,
    },
    urls: { issue: `/issues/${id}`, issue_edit: `/issues/${id}/edit` },
    ...attrs,
  };
}

function makeBoardData(issue: Issue): BoardData {
  return {
    ok: true,
    meta: {
      project_id: 1,
      current_user_id: 10,
      can_move: true,
      can_create: true,
      can_delete: true,
      lane_type: 'none',
      wip_limit_mode: 'column',
      wip_exceed_behavior: 'warn',
      aging_warn_days: 3,
      aging_danger_days: 7,
      aging_exclude_closed: true,
    },
    columns: [
      { id: 1, name: 'Open', is_closed: false, count: 1 },
      { id: 2, name: 'Closed', is_closed: false, count: 0 },
    ],
    lanes: [],
    lists: { assignees: [], trackers: [], priorities: [], projects: [], viewable_projects: [], creatable_projects: [] },
    issues: [issue],
    labels: {},
  };
}

function createCanvasContext(): CanvasRenderingContext2D {
  const noop = () => {};
  return {
    save: noop,
    restore: noop,
    scale: noop,
    translate: noop,
    clearRect: noop,
    fillRect: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    fill: noop,
    fillText: noop,
    measureText: (text: string) => ({ width: text.length * 7 }) as TextMetrics,
    arc: noop,
    closePath: noop,
    quadraticCurveTo: noop,
  } as unknown as CanvasRenderingContext2D;
}

class ResizeObserverMock {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    this.callback(
      [
        {
          target,
          contentRect: {
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: 800,
            bottom: 600,
            width: 800,
            height: 600,
            toJSON: () => ({}),
          } as DOMRectReadOnly,
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }

  disconnect() {}
  unobserve() {}
}

describe('CanvasBoard cursor lifecycle', () => {
  beforeEach(() => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      return window.setTimeout(() => cb(performance.now()), 0);
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      window.clearTimeout(id);
    });

    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { ready: Promise.resolve() },
    });

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => createCanvasContext());

    Object.defineProperty(HTMLCanvasElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value() {
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 800,
          bottom: 600,
          width: 800,
          height: 600,
          toJSON: () => ({}),
        };
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('resets cursor after pointercancel and keeps pending drop cursor default after lost capture', async () => {
    const issue = makeIssue(1, { due_date: '2026-03-20' });
    const data = makeBoardData(issue);
    const state = buildBoardState(data, data.issues, 'updated_desc', new Map());
    const onCommand = vi.fn();

    const { container } = render(
      <CanvasBoard
        data={data}
        state={state}
        canMove
        canCreate
        onCommand={onCommand}
        onCreate={vi.fn()}
        onEdit={vi.fn()}
        onView={vi.fn()}
        onDelete={vi.fn()}
        onEditClick={vi.fn()}
        labels={data.labels}
      />,
    );

    const board = container.querySelector('.rk-canvas-board') as HTMLDivElement;
    const canvas = container.querySelector('canvas.rk-canvas') as HTMLCanvasElement;

    await waitFor(() => {
      expect(board.style.cursor).toBe('default');
    });
    await waitFor(() => {
      expect(canvas.width).toBeGreaterThan(0);
      expect(canvas.height).toBeGreaterThan(0);
    });

    fireEvent.pointerMove(canvas, { clientX: 200, clientY: 100, pointerId: 1 });
    await waitFor(() => {
      expect(board.style.cursor).toBe('pointer');
    });

    fireEvent.pointerDown(canvas, { clientX: 200, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 240, clientY: 100, pointerId: 1 });
    await waitFor(() => {
      expect(board.style.cursor).toBe('move');
    });

    fireEvent.pointerCancel(canvas, { clientX: 240, clientY: 100, pointerId: 1 });
    await waitFor(() => {
      expect(board.style.cursor).toBe('default');
    });

    fireEvent.pointerMove(canvas, { clientX: 200, clientY: 100, pointerId: 2 });
    await waitFor(() => {
      expect(board.style.cursor).toBe('pointer');
    });

    fireEvent.pointerDown(canvas, { clientX: 200, clientY: 100, pointerId: 2 });
    fireEvent.pointerMove(canvas, { clientX: 320, clientY: 100, pointerId: 2 });
    await waitFor(() => {
      expect(board.style.cursor).toBe('move');
    });

    fireEvent.pointerUp(canvas, { clientX: 320, clientY: 100, pointerId: 2 });
    expect(onCommand).toHaveBeenCalledWith({
      type: 'move_issue',
      issueId: 1,
      statusId: 2,
      laneId: 'none',
      assignedToId: null,
      priorityId: null,
    });
    await waitFor(() => {
      expect(board.style.cursor).toBe('default');
    });

    fireEvent(canvas, new Event('lostpointercapture', { bubbles: true }));
    await waitFor(() => {
      expect(board.style.cursor).toBe('default');
    });

    fireEvent.pointerMove(canvas, { clientX: 320, clientY: 100, pointerId: 2 });
    await waitFor(() => {
      expect(board.style.cursor).toBe('default');
    });
  });
});
