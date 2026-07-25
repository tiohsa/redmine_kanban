// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
        onFinalizeDelete={vi.fn()}
        onUndoDelete={onUndoDelete}
      />
    );

    expect(screen.getByText('チケット #42 を削除しました。復元できます。')).toBeTruthy();
    const undoButton = screen.getByRole('button', { name: '復元' });
    expect(undoButton.className).toContain('rk-popup-undo-btn');

    fireEvent.click(undoButton);
    expect(onUndoDelete).toHaveBeenCalledTimes(1);
  });
});
