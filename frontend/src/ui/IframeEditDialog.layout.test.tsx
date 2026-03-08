// @vitest-environment jsdom

import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IframeEditDialog } from './IframeEditDialog';

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
};

describe('IframeEditDialog layout variants', () => {
  it('applies compact issue layout classes for issue dialogs', () => {
    const { container } = render(
      <IframeEditDialog
        url="/issues/1/edit"
        issueId={1}
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
  });

  it('keeps time entry dialogs on the default layout', () => {
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
    expect(container.querySelector('.rk-create-footer-compact')).toBeNull();
    expect(container.querySelector('.rk-modal-actions-start')).toBeNull();
  });
});
