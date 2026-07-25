// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardData, Issue } from './types';
import { KanbanPopupHost } from './KanbanPopupHost';

const issue: Issue = {
  id: 42,
  subject: '削除対象',
  status_id: 1,
  tracker_id: 1,
  description: '',
  assigned_to_id: null,
  urls: { issue: '/issues/42', issue_edit: '/issues/42/edit' },
};

const data = {
  labels: {
    notice: '通知',
    close: '閉じる',
    undo: '復元',
    restoring: '復元中',
    deleted_with_undo: 'チケット #%{id} を削除しました。復元できます。',
  },
} as unknown as BoardData;

describe('KanbanPopupHost', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function renderHost(overrides: Partial<React.ComponentProps<typeof KanbanPopupHost>> = {}) {
    return render(
      <KanbanPopupHost
        data={data}
        loading={false}
        notice={null}
        error={null}
        pendingDeleteIssue={issue}
        isRestoring={false}
        onCloseNotice={vi.fn()}
        onCloseError={vi.fn()}
        onDismissDeleteNotice={vi.fn()}
        onUndoDelete={vi.fn()}
        {...overrides}
      />
    );
  }

  it('renders the deleted notice and restores the issue when undo is clicked', () => {
    const onUndoDelete = vi.fn();

    render(
      <KanbanPopupHost
        data={data}
        loading={false}
        notice={null}
        error={null}
        pendingDeleteIssue={issue}
        isRestoring={false}
        onCloseNotice={vi.fn()}
        onCloseError={vi.fn()}
        onDismissDeleteNotice={vi.fn()}
        onUndoDelete={onUndoDelete}
      />
    );

    expect(screen.getByText('チケット #42 を削除しました。復元できます。')).toBeTruthy();
    const undoButton = screen.getByRole('button', { name: '復元' });
    expect(undoButton.className).toContain('rk-popup-undo-btn');

    fireEvent.click(undoButton);
    expect(onUndoDelete).toHaveBeenCalledTimes(1);
  });

  it('dismisses a deleted notice without invoking deletion again', () => {
    const onDismissDeleteNotice = vi.fn();
    renderHost({ onDismissDeleteNotice });

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));

    expect(onDismissDeleteNotice).toHaveBeenCalledTimes(1);
  });

  it('automatically dismisses a deleted notice after eight seconds', () => {
    vi.useFakeTimers();
    const onDismissDeleteNotice = vi.fn();
    renderHost({ onDismissDeleteNotice });

    vi.advanceTimersByTime(7_999);
    expect(onDismissDeleteNotice).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(onDismissDeleteNotice).toHaveBeenCalledTimes(1);
  });

  it('does not let a stale delete timer dismiss a notice during undo', () => {
    vi.useFakeTimers();
    const onDismissDeleteNotice = vi.fn();
    const { rerender } = renderHost({ onDismissDeleteNotice });

    vi.advanceTimersByTime(7_000);
    rerender(
      <KanbanPopupHost
        data={data}
        loading={false}
        notice={null}
        error={null}
        pendingDeleteIssue={issue}
        isRestoring={true}
        onCloseNotice={vi.fn()}
        onCloseError={vi.fn()}
        onDismissDeleteNotice={onDismissDeleteNotice}
        onUndoDelete={vi.fn()}
      />
    );
    vi.advanceTimersByTime(2_000);

    expect(onDismissDeleteNotice).not.toHaveBeenCalled();
  });

  it('automatically dismisses normal notices after five seconds', () => {
    vi.useFakeTimers();
    const onCloseNotice = vi.fn();
    renderHost({ pendingDeleteIssue: null, notice: '保存しました', onCloseNotice });

    vi.advanceTimersByTime(4_999);
    expect(onCloseNotice).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(onCloseNotice).toHaveBeenCalledTimes(1);
  });

  it('does not automatically dismiss errors', () => {
    vi.useFakeTimers();
    const onCloseError = vi.fn();
    renderHost({ pendingDeleteIssue: null, error: '失敗しました', onCloseError });

    vi.advanceTimersByTime(10_000);

    expect(onCloseError).not.toHaveBeenCalled();
  });

  it('cleans up the old notice timer when the notice changes', () => {
    vi.useFakeTimers();
    const onCloseNotice = vi.fn();
    const { rerender } = renderHost({ pendingDeleteIssue: null, notice: '最初', onCloseNotice });

    vi.advanceTimersByTime(4_000);
    rerender(
      <KanbanPopupHost
        data={data}
        loading={false}
        notice="次"
        error={null}
        pendingDeleteIssue={null}
        isRestoring={false}
        onCloseNotice={onCloseNotice}
        onCloseError={vi.fn()}
        onDismissDeleteNotice={vi.fn()}
        onUndoDelete={vi.fn()}
      />
    );
    vi.advanceTimersByTime(1_000);
    expect(onCloseNotice).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4_000);
    expect(onCloseNotice).toHaveBeenCalledTimes(1);
  });
});
