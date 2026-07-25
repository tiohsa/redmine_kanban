// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardData, Issue } from '../types';
import { CanvasBoard, makeSubtaskSignature, measureCardHeightCached } from './CanvasBoard';
import { getMetrics } from './metrics';
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
      { id: 2, name: 'Closed', is_closed: true, count: 0 },
    ],
    lanes: [],
    lists: { assignees: [], trackers: [], priorities: [], projects: [], viewable_projects: [], creatable_projects: [] },
    issues: [issue],
    labels: {},
  };
}

function createCanvasContext(): CanvasRenderingContext2D {
  const noop = () => { };
  return {
    save: noop,
    restore: noop,
    setTransform: noop,
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

function createCanvasContextWithSpies() {
  const noop = vi.fn();
  const context = {
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    measureText: (text: string) => ({ width: text.length * 7 }) as TextMetrics,
    arc: noop,
    closePath: noop,
    quadraticCurveTo: noop,
  } as unknown as CanvasRenderingContext2D & {
    fillText: ReturnType<typeof vi.fn>;
    lineTo: ReturnType<typeof vi.fn>;
    setTransform: ReturnType<typeof vi.fn>;
  };
  return context;
}

function setDevicePixelRatio(value: number) {
  Object.defineProperty(window, 'devicePixelRatio', {
    configurable: true,
    value,
  });
}

class ResizeObserverMock {
  constructor(private readonly callback: ResizeObserverCallback) { }

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

  disconnect() { }
  unobserve() { }
}

describe('CanvasBoard cursor lifecycle', () => {
  beforeEach(() => {
    setDevicePixelRatio(1);
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
      expect(board.style.cursor).toBe('move');
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
      expect(board.style.cursor).toBe('move');
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

  it('draws completed issue and subtask titles in canvas with strikethrough lines', async () => {
    const issue = makeIssue(2, {
      subject: 'Closed issue',
      status_id: 2,
      subtasks: [{ id: 20, subject: 'Closed child', status_id: 2, is_closed: true }],
    });
    const data = makeBoardData(issue);
    const state = buildBoardState(data, data.issues, 'updated_desc', new Map());
    const context = createCanvasContextWithSpies();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context);

    const { container } = render(
      <CanvasBoard
        data={data}
        state={state}
        canMove
        canCreate
        onCommand={vi.fn()}
        onCreate={vi.fn()}
        onEdit={vi.fn()}
        onView={vi.fn()}
        onDelete={vi.fn()}
        onEditClick={vi.fn()}
        labels={data.labels}
      />,
    );

    const canvas = container.querySelector('canvas.rk-canvas') as HTMLCanvasElement;
    await waitFor(() => {
      expect(canvas.width).toBeGreaterThan(0);
      expect(context.fillText).toHaveBeenCalledWith('Closed issue', expect.any(Number), expect.any(Number));
      expect(context.fillText).toHaveBeenCalledWith('Closed child', expect.any(Number), expect.any(Number));
    });

    const issueTextCall = context.fillText.mock.calls.find(([text]) => text === 'Closed issue');
    const subtaskTextCall = context.fillText.mock.calls.find(([text]) => text === 'Closed child');
    expect(issueTextCall).toBeTruthy();
    expect(subtaskTextCall).toBeTruthy();

    const [, issueX, issueY] = issueTextCall as [string, number, number];
    const [, subtaskX, subtaskY] = subtaskTextCall as [string, number, number];
    expect(context.lineTo).toHaveBeenCalledWith(issueX + 'Closed issue'.length * 7, issueY + 13 * 0.58);
    expect(context.lineTo).toHaveBeenCalledWith(subtaskX + 'Closed child'.length * 7, subtaskY + 12 * 0.58);
  });

  it('draws an external project on its own metadata row', async () => {
    const issue = makeIssue(7, {
      assigned_to_name: '担当者',
      due_date: '2026-07-30',
      project: { id: 2, name: '別プロジェクト' },
    });
    const data = makeBoardData(issue);
    const state = buildBoardState(data, data.issues, 'updated_desc', new Map());
    const context = createCanvasContextWithSpies();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context);

    render(
      <CanvasBoard
        data={data}
        state={state}
        canMove
        canCreate
        onCommand={vi.fn()}
        onCreate={vi.fn()}
        onEdit={vi.fn()}
        onView={vi.fn()}
        onDelete={vi.fn()}
        onEditClick={vi.fn()}
        labels={data.labels}
      />,
    );

    await waitFor(() => expect(context.fillText).toHaveBeenCalledWith('別プロジェクト', expect.any(Number), expect.any(Number)));

    const assigneeCall = context.fillText.mock.calls.find(([text]) => text === '担当者');
    const projectCall = context.fillText.mock.calls.find(([text]) => text === '別プロジェクト');
    const dueDateCall = context.fillText.mock.calls.find(([text]) => text === '2026-07-30');
    expect(assigneeCall).toBeTruthy();
    expect(projectCall).toBeTruthy();
    expect(dueDateCall).toBeTruthy();
    expect((projectCall as [string, number, number])[2]).toBeGreaterThan((assigneeCall as [string, number, number])[2]);
    expect((dueDateCall as [string, number, number])[2]).toBeGreaterThan((projectCall as [string, number, number])[2]);
  });

  it('keeps the due-date row compact when the project is current or absent', () => {
    const metrics = getMetrics(14);
    const currentProjectIssue = makeIssue(8, { project: { id: 1, name: 'Current' } });
    const noProjectIssue = makeIssue(9);
    const currentHeight = measureCardHeightCached(currentProjectIssue, metrics, undefined, undefined, 14, 260, 1);
    const noProjectHeight = measureCardHeightCached(noProjectIssue, metrics, undefined, undefined, 14, 260, 1);
    const externalHeight = measureCardHeightCached(
      makeIssue(10, { project: { id: 2, name: 'External' } }),
      metrics,
      undefined,
      undefined,
      14,
      260,
      1,
    );

    expect(currentHeight).toBe(noProjectHeight);
    expect(externalHeight).toBeGreaterThan(currentHeight);
  });

  it('truncates long assignee and project metadata within the card width', async () => {
    const longAssignee = '担当者名'.repeat(40);
    const longProject = '非常に長いプロジェクト名称'.repeat(20);
    const issue = makeIssue(11, {
      assigned_to_name: longAssignee,
      project: { id: 2, name: longProject },
    });
    const data = makeBoardData(issue);
    const state = buildBoardState(data, data.issues, 'updated_desc', new Map());
    const context = createCanvasContextWithSpies();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context);

    render(
      <CanvasBoard
        data={data}
        state={state}
        canMove
        canCreate
        onCommand={vi.fn()}
        onCreate={vi.fn()}
        onEdit={vi.fn()}
        onView={vi.fn()}
        onDelete={vi.fn()}
        onEditClick={vi.fn()}
        labels={data.labels}
      />,
    );

    await waitFor(() => expect(context.fillText.mock.calls.some(([text]) => String(text).startsWith('非常に長いプロジェクト名称'))).toBe(true));
    const assigneeText = context.fillText.mock.calls.find(([text]) => String(text).startsWith('担当者名'))?.[0] as string;
    const projectText = context.fillText.mock.calls.find(([text]) => String(text).startsWith('非常に長いプロジェクト名称'))?.[0] as string;
    expect(assigneeText).not.toBe(longAssignee);
    expect(projectText).not.toBe(longProject);
    expect(context.measureText(assigneeText).width).toBeLessThanOrEqual(80);
    expect(context.measureText(projectText).width).toBeLessThanOrEqual(195);
  });

  it('uses a 2x backing store at DPR 2 while keeping CSS size unchanged', async () => {
    setDevicePixelRatio(2);
    const issue = makeIssue(3);
    const data = makeBoardData(issue);
    const state = buildBoardState(data, data.issues, 'updated_desc', new Map());

    const { container } = render(
      <CanvasBoard
        data={data}
        state={state}
        canMove
        canCreate
        onCommand={vi.fn()}
        onCreate={vi.fn()}
        onEdit={vi.fn()}
        onView={vi.fn()}
        onDelete={vi.fn()}
        onEditClick={vi.fn()}
        labels={data.labels}
      />,
    );

    const canvas = container.querySelector('canvas.rk-canvas') as HTMLCanvasElement;
    await waitFor(() => {
      expect(canvas.width).toBe(1600);
      expect(canvas.height).toBe(1200);
    });
    expect(canvas.style.width).toBe('800px');
    expect(canvas.style.height).toBe('600px');
  });

  it('uses a rounded fractional DPR backing store while keeping CSS size unchanged', async () => {
    setDevicePixelRatio(1.25);
    const issue = makeIssue(4);
    const data = makeBoardData(issue);
    const state = buildBoardState(data, data.issues, 'updated_desc', new Map());

    const { container } = render(
      <CanvasBoard
        data={data}
        state={state}
        canMove
        canCreate
        onCommand={vi.fn()}
        onCreate={vi.fn()}
        onEdit={vi.fn()}
        onView={vi.fn()}
        onDelete={vi.fn()}
        onEditClick={vi.fn()}
        labels={data.labels}
      />,
    );

    const canvas = container.querySelector('canvas.rk-canvas') as HTMLCanvasElement;
    await waitFor(() => {
      expect(canvas.width).toBe(1000);
      expect(canvas.height).toBe(750);
    });
    expect(canvas.style.width).toBe('800px');
    expect(canvas.style.height).toBe('600px');
  });

  it('applies DPR using setTransform before board scale', async () => {
    setDevicePixelRatio(2);
    const issue = makeIssue(5);
    const data = makeBoardData(issue);
    const state = buildBoardState(data, data.issues, 'updated_desc', new Map());
    const context = createCanvasContextWithSpies();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context);

    render(
      <CanvasBoard
        data={data}
        state={state}
        canMove
        canCreate
        onCommand={vi.fn()}
        onCreate={vi.fn()}
        onEdit={vi.fn()}
        onView={vi.fn()}
        onDelete={vi.fn()}
        onEditClick={vi.fn()}
        labels={data.labels}
      />,
    );

    await waitFor(() => {
      expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    });
  });

  it('caps DPR 4 to a 2x backing store', async () => {
    setDevicePixelRatio(4);
    const issue = makeIssue(6);
    const data = makeBoardData(issue);
    const state = buildBoardState(data, data.issues, 'updated_desc', new Map());
    const context = createCanvasContextWithSpies();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context);

    const { container } = render(
      <CanvasBoard
        data={data}
        state={state}
        canMove
        canCreate
        onCommand={vi.fn()}
        onCreate={vi.fn()}
        onEdit={vi.fn()}
        onView={vi.fn()}
        onDelete={vi.fn()}
        onEditClick={vi.fn()}
        labels={data.labels}
      />,
    );

    const canvas = container.querySelector('canvas.rk-canvas') as HTMLCanvasElement;
    await waitFor(() => {
      expect(canvas.width).toBe(1600);
      expect(canvas.height).toBe(1200);
      expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    });
    expect(canvas.style.width).toBe('800px');
    expect(canvas.style.height).toBe('600px');
  });
});

describe('CanvasBoard card height cache', () => {
  it('reuses measured card height for the same issue signature', () => {
    const issue = makeIssue(100, {
      subject: 'A subject that is intentionally long enough to require canvas measurement',
      subtasks: [{ id: 101, subject: 'Child', status_id: 1, is_closed: false }],
    });
    const metrics = getMetrics(14);
    const measureText = vi.fn((text: string) => ({ width: text.length * 7 }) as TextMetrics);
    const ctx = { measureText, font: '' } as unknown as CanvasRenderingContext2D;
    const cache = new Map<string, number>();

    const first = measureCardHeightCached(issue, metrics, cache, ctx, 14, 260);
    const callsAfterFirst = measureText.mock.calls.length;
    const second = measureCardHeightCached(issue, metrics, cache, ctx, 14, 260);

    expect(second).toBe(first);
    expect(measureText).toHaveBeenCalledTimes(callsAfterFirst);
  });

  it('changes subtask signature when completion state changes', () => {
    const open = makeIssue(101, {
      subtasks: [{ id: 201, subject: 'Child', status_id: 1, is_closed: false }],
    });
    const closed = makeIssue(101, {
      subtasks: [{ id: 201, subject: 'Child', status_id: 1, is_closed: true }],
    });

    expect(makeSubtaskSignature(open)).not.toBe(makeSubtaskSignature(closed));
  });
});
