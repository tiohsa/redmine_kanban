// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeBoardSnapshot } from '../test/fixtures/boardSnapshot';
import { App } from './App';
import type { CanvasBoard, CanvasBoardHandle } from './board/CanvasBoard';

const { mutateAsync, anchorY } = vi.hoisted(() => ({ mutateAsync: vi.fn(), anchorY: { value: 100 } }));

vi.mock('./board/CanvasBoard', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    CanvasBoard: forwardRef<CanvasBoardHandle, ComponentProps<typeof CanvasBoard>>((props, ref) => {
      useImperativeHandle(ref, () => ({
        scrollToTop: () => {},
        dateAnchorPosition: () => anchorY.value < 0 ? null : { x: 100, y: anchorY.value },
      }));
      return (
      <div>
        <canvas className="rk-canvas" tabIndex={-1} />
        {props.data.issues.map((issue) => (
          <button key={issue.id} type="button" onClick={() => props.onDateClick?.(issue.id, issue.due_date ?? null, 100, 100, { x: 100, y: 100 })}>
            Open calendar {issue.id}
          </button>
        ))}
        <button type="button" onClick={() => { anchorY.value = 60; props.onViewportChange?.(); }}>Scroll board</button>
        <button type="button" onClick={() => { anchorY.value = -10; props.onViewportChange?.(); }}>Scroll away</button>
      </div>
      );
    }),
  };
});

vi.mock('./useKanbanActions', () => ({
  useKanbanActions: () => ({
    busyIssueIds: new Set(), pendingDeleteIssue: null, isRestoring: false,
    updateIssueMutation: { mutateAsync },
    createIssueMutation: { mutateAsync: vi.fn() },
    dismissDeleteNotice: vi.fn(), handleUndo: vi.fn(), requestDelete: vi.fn(),
    moveIssue: vi.fn(), toggleSubtask: vi.fn(),
  }),
}));

vi.mock('./http', () => ({
  getJson: vi.fn((url: string) => Promise.resolve(url.endsWith('/metadata')
    ? { ok: true, board: { id: 4 }, projects: [], viewable_projects: [], statuses: [], server_entity_limit: 5000 }
    : boardSnapshot())),
  isHttpError: vi.fn(() => false),
  postJson: vi.fn(),
}));

function boardSnapshot() {
  const snapshot = makeBoardSnapshot();
  snapshot.entities[0].lock_version = 3;
  snapshot.entities.push({ ...snapshot.entities[0], id: 10, subject: 'Issue B', due_date: '2026-09-20', lock_version: 7,
    urls: { issue: '/redmine/issues/10', issue_edit: '/redmine/issues/10/edit' } });
  snapshot.tree.root_ids = [9, 10];
  snapshot.meta.entity_count = 2;
  snapshot.labels = {
    ...snapshot.labels,
    issue_due_date: 'Due date', calendar_previous_month: 'Previous month', calendar_next_month: 'Next month',
    calendar_year: 'Year', calendar_month: 'Month', calendar_today: 'Today', calendar_clear: 'Clear',
    date_update_failed: 'Date update failed', error: 'Error', update_failed: 'Update failed', close: 'Close',
  };
  return snapshot;
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function clickDay(day: number) {
  const cell = document.querySelector<HTMLElement>(`.react-datepicker__day--${String(day).padStart(3, '0')}:not(.react-datepicker__day--outside-month)`);
  expect(cell).not.toBeNull();
  fireEvent.click(cell!);
}

async function open(issueId: number) {
  fireEvent.click(await screen.findByRole('button', { name: `Open calendar ${issueId}` }));
  expect(document.querySelector('.rk-minimax-datepicker')).not.toBeNull();
}

describe('App calendar mutations', () => {
  let client: QueryClient;

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 25, 12));
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mutateAsync.mockReset();
    anchorY.value = 100;
  });

  afterEach(() => {
    cleanup();
    client.clear();
    vi.useRealTimers();
  });

  async function mount() {
    render(<QueryClientProvider client={client}><App dataUrl="/projects/demo/kanban/data" initialCurrentUserId={7} /></QueryClientProvider>);
    await screen.findByRole('button', { name: 'Open calendar 9' });
  }

  it.each(['resolve', 'reject'] as const)('keeps B open when A %s after B opens', async (outcome) => {
    const pendingA = deferred();
    mutateAsync.mockReturnValueOnce(pendingA.promise);
    await mount();
    await open(9);
    clickDay(14);
    expect(document.querySelector('.rk-minimax-datepicker')).toBeNull();
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledExactlyOnceWith({ issueId: 9, patch: { due_date: '2026-09-14' }, lockVersion: 3 }));
    await open(10);
    if (outcome === 'resolve') await act(async () => pendingA.resolve());
    else await act(async () => pendingA.reject(new Error('Save failed')));
    expect(document.querySelector('.rk-minimax-datepicker')).not.toBeNull();
    if (outcome === 'reject') expect(screen.getByRole('dialog', { name: 'Error' }).textContent).toContain('Save failed');
  });

  it('sends A and B once each and keeps the right issue when B finishes first', async () => {
    const pendingA = deferred();
    const pendingB = deferred();
    mutateAsync.mockReturnValueOnce(pendingA.promise).mockReturnValueOnce(pendingB.promise);
    await mount();
    await open(9);
    clickDay(14);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    await open(10);
    clickDay(21);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    expect(mutateAsync.mock.calls).toEqual([
      [{ issueId: 9, patch: { due_date: '2026-09-14' }, lockVersion: 3 }],
      [{ issueId: 10, patch: { due_date: '2026-09-21' }, lockVersion: 7 }],
    ]);
    await act(async () => pendingB.resolve());
    await open(10);
    await act(async () => pendingA.resolve());
    expect(document.querySelector('.rk-minimax-datepicker')).not.toBeNull();
    expect(mutateAsync).toHaveBeenCalledTimes(2);
  });

  it('commits once when Escape immediately follows date selection', async () => {
    mutateAsync.mockResolvedValue(undefined);
    await mount();
    await open(9);
    clickDay(14);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
  });

  it('moves the open calendar on board and page scroll without resetting its month', async () => {
    await mount();
    await open(9);
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('combobox', { name: 'Month' })).toHaveProperty('value', '9');
    fireEvent.click(screen.getByRole('button', { name: 'Scroll board' }));
    expect(document.querySelector<HTMLElement>('.rk-date-popup-anchor')?.style.top).toBe('60px');
    expect(screen.getByRole('combobox', { name: 'Month' })).toHaveProperty('value', '9');
    anchorY.value = 40;
    fireEvent.scroll(window);
    expect(document.querySelector<HTMLElement>('.rk-date-popup-anchor')?.style.top).toBe('40px');
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('closes without saving when the date anchor scrolls out of view', async () => {
    await mount();
    await open(9);
    fireEvent.click(screen.getByRole('button', { name: 'Scroll away' }));
    await waitFor(() => expect(document.querySelector('.rk-minimax-datepicker')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('.rk-canvas')));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('does not save when the selected date is unchanged', async () => {
    await mount();
    await open(10);
    clickDay(20);
    expect(document.querySelector('.rk-minimax-datepicker')).toBeNull();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('keeps B open after clearing A and completing its save', async () => {
    const pendingA = deferred();
    mutateAsync.mockReturnValueOnce(pendingA.promise);
    await mount();
    await open(10);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledExactlyOnceWith({ issueId: 10, patch: { due_date: null }, lockVersion: 7 }));
    await open(9);
    await act(async () => pendingA.resolve());
    expect(document.querySelector('.rk-minimax-datepicker')).not.toBeNull();
  });
});
