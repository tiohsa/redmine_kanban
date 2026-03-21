// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IframeEditDialog } from './IframeEditDialog';
import { getCleanDialogStyles } from './board/iframeStyles';

const mutateAsyncMock = vi.hoisted(() => vi.fn());

vi.mock('./hooks/useBulkSubtaskMutation', () => ({
  useBulkSubtaskMutation: () => ({
    mutateAsync: mutateAsyncMock,
  }),
}));

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const setElementHeight = (element: HTMLElement, height: number) => {
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    value: height,
  });
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    value: height,
  });
  Object.defineProperty(element, 'offsetHeight', {
    configurable: true,
    value: height,
  });
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 0,
      height,
      top: 0,
      left: 0,
      right: 0,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
};

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
  time_entry_dialog_title: '作業時間',
  open_in_redmine: 'Redmine標準画面を開く',
  close: '閉じる',
};

describe('IframeEditDialog layout variants', () => {
  beforeEach(() => {
    window.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    cleanup();
  });

  it('renders compact issue header and left-aligned footer actions', () => {
    render(
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

    const header = screen.getByTestId('issue-dialog-header');
    const footer = screen.getByTestId('issue-dialog-footer');
    const openLink = screen.getByRole('link', { name: 'Redmine標準画面を開く' });
    const closeButton = screen.getByRole('button', { name: '閉じる' });
    const footerButtons = within(footer).getAllByRole('button');

    expect(screen.getByRole('heading', { name: 'Feature request #1' })).toBeTruthy();
    expect(header.className).toContain('rk-issue-dialog-head-compact');
    expect(openLink.getAttribute('href')).toBe('/issues/1/edit');
    expect(openLink.style.width).toBe('24px');
    expect(openLink.style.height).toBe('24px');
    expect(closeButton.style.width).toBe('24px');
    expect(closeButton.style.height).toBe('24px');

    expect(footer.style.justifyContent).toBe('flex-start');
    expect(footer.style.flexDirection).toBe('row');
    expect(footer.style.gap).toBe('6px');
    expect(footer.style.paddingTop).toBe('2px');
    expect(footer.style.paddingRight).toBe('12px');
    expect(footer.style.paddingBottom).toBe('4px');
    expect(footer.style.paddingLeft).toBe('12px');
    expect(footerButtons).toHaveLength(2);
    expect(footerButtons[0].textContent).toContain('キャンセル');
    expect(footerButtons[1].textContent).toContain('保存');
    expect(footerButtons[0].style.height).toBe('28px');
    expect(footerButtons[0].style.minWidth).toBe('88px');
    expect(footerButtons[1].style.height).toBe('28px');
    expect(footerButtons[1].style.minWidth).toBe('88px');
  });

  it('uses the same compact chrome for time entry dialogs', () => {
    render(
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

    expect(screen.getByTestId('issue-dialog-header')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '作業時間' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Redmine標準画面を開く' }).getAttribute('href')).toBe('/issues/1/time_entries/new');
    expect(screen.getByTestId('issue-dialog-footer')).toBeTruthy();
    expect(screen.queryByText('子チケット一括登録 (1行に1件名)')).toBeNull();
  });

  it('shrinks dialog height for short iframe content', async () => {
    const { container } = render(
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

    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    const doc = document.implementation.createHTMLDocument('iframe');
    const content = doc.createElement('div');
    content.id = 'content';
    doc.body.appendChild(content);

    setElementHeight(content, 120);
    setElementHeight(doc.body, 120);
    setElementHeight(doc.documentElement, 120);

    Object.defineProperty(iframe, 'contentWindow', {
      value: { location: { href: 'http://example.com/issues/1/edit' }, document: doc, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      configurable: true,
    });
    Object.defineProperty(iframe, 'contentDocument', { value: doc, configurable: true });

    fireEvent.load(iframe);

    await waitFor(() => {
      const dialog = screen.getByTestId('issue-dialog-header').parentElement as HTMLDivElement;
      expect(dialog.style.height).toBe('320px');
    });
  });

  it('clamps dialog height for tall iframe content', async () => {
    const { container } = render(
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

    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    const doc = document.implementation.createHTMLDocument('iframe');
    const content = doc.createElement('div');
    content.id = 'content';
    doc.body.appendChild(content);

    setElementHeight(content, 2000);
    setElementHeight(doc.body, 2000);
    setElementHeight(doc.documentElement, 2000);

    Object.defineProperty(iframe, 'contentWindow', {
      value: { location: { href: 'http://example.com/issues/1/edit' }, document: doc, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      configurable: true,
    });
    Object.defineProperty(iframe, 'contentDocument', { value: doc, configurable: true });

    fireEvent.load(iframe);

    await waitFor(() => {
      const dialog = screen.getByTestId('issue-dialog-header').parentElement as HTMLDivElement;
      expect(dialog.style.height).toBe(`${Math.floor(window.innerHeight * 0.9)}px`);
    });
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
