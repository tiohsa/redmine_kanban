// @vitest-environment jsdom

import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IframeEditDialog } from './IframeEditDialog';
import { getCleanDialogStyles } from './board/iframeStyles';

const mutateAsyncMock = vi.hoisted(() => vi.fn());

vi.mock('./hooks/useBulkSubtaskMutation', () => ({
  useBulkSubtaskMutation: () => ({
    mutateAsync: mutateAsyncMock,
  }),
}));

const labels: Record<string, string> = {
  bulk_subtask_title: '子チケット一括登録 (1行に1件名)',
  bulk_subtask_placeholder: '1行に1件名',
  cancel: 'キャンセル',
  save: '保存',
  saving: '保存中',
  create: '作成',
  creating: '作成中',
  created: '作成済み %{id}',
  saved: '保存済み %{id}',
  created_with_subtasks: '作成 %{id} %{count}',
  updated_with_subtasks: '更新 %{id} %{count}',
  created_subtask_failed: '作成失敗 %{id}',
  updated_subtask_failed: '更新失敗 %{id}',
  successful_update: '更新成功',
  issue_create_dialog_title: 'チケット登録',
  issue_edit_dialog_title: 'チケット編集',
  issue_info_dialog_title: 'チケット情報',
  open_in_redmine: 'Redmine標準画面を開く',
  close: '閉じる',
};

describe('IframeEditDialog layout variants', () => {
  it('applies compact issue layout classes for issue dialogs', () => {
    const { container, getByRole } = render(
      <IframeEditDialog
        url="/issues/1/edit"
        issueId={1}
        issueTitle="Feature request"
        labels={labels}
        baseUrl="/projects/demo/kanban"
        queryKey={['kanban', 'board']}
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );

    expect(container.querySelector('.rk-iframe-dialog-container-issue')).not.toBeNull();
    expect(container.querySelector('.rk-create-footer-compact')).not.toBeNull();
    expect(container.querySelector('.rk-modal-actions-start')).not.toBeNull();
    expect(getByRole('heading', { name: 'Feature request #1' })).toBeTruthy();
    expect(
      container.querySelector<HTMLAnchorElement>('a[aria-label="Redmine標準画面を開く"]')?.getAttribute('href')
    ).toBe('/issues/1/edit');
    expect(getByRole('button', { name: '閉じる' })).toBeTruthy();
  });

  it('uses compact time entry layout without issue header chrome', () => {
    const { container } = render(
      <IframeEditDialog
        url="/issues/1/time_entries/new"
        issueId={1}
        mode="time_entry"
        labels={labels}
        baseUrl="/projects/demo/kanban"
        queryKey={['kanban', 'board']}
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );

    expect(container.querySelector('.rk-iframe-dialog-container-issue')).toBeNull();
    expect(container.querySelector('.rk-iframe-dialog-container-time-entry')).not.toBeNull();
    expect(container.querySelector('.rk-create-footer-compact')).not.toBeNull();
    expect(container.querySelector('.rk-create-footer-time-entry')).not.toBeNull();
    expect(container.querySelector('.rk-modal-actions-start')).not.toBeNull();
    expect(container.querySelector('a[aria-label="Redmine標準画面を開く"]')).toBeNull();
    expect(container.querySelector('.rk-issue-dialog-head')).toBeNull();
  });

  it('hides native time entry buttons inside the iframe styles', () => {
    const styles = getCleanDialogStyles({ variant: 'time-entry-compact' });

    expect(styles).toContain('#content > p.buttons');
    expect(styles).toContain('#content > a.icon-cancel');
    expect(styles).toContain('#content a[href*="/kanban"]');
    expect(styles).toContain('#new_time_entry p.buttons');
    expect(styles).toContain('#new_time_entry input[name="commit"]');
    expect(styles).toContain('#new_time_entry a.icon-cancel');
    expect(styles).toContain('#new_time_entry a[href*="/kanban"]');
  });
});
