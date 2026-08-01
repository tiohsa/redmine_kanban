// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IframeEditDialog } from './IframeEditDialog';
import { getCleanDialogStyles } from './board/iframeStyles';

const mutateAsyncMock = vi.hoisted(() => vi.fn());
const getJsonMock = vi.hoisted(() => vi.fn());

vi.mock('./hooks/useBulkSubtaskMutation', () => ({
  useBulkSubtaskMutation: () => ({
    mutateAsync: mutateAsyncMock,
  }),
}));

vi.mock('./http', () => ({
  getJson: getJsonMock,
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
  bulk_subtask_mode: '入力方式',
  bulk_subtask_table_mode: '表形式入力',
  bulk_subtask_text_mode: '一括テキスト入力',
  bulk_subtask_default_tracker: '標準トラッカー',
  issue_tracker: 'トラッカー',
  select_tracker: 'トラッカーを選択',
  cancel: 'キャンセル',
  save: '保存',
  saving: '保存中',
  create: '作成',
  creating: '作成中',
  create_issue: 'チケットを作成',
  edit_issue: 'チケットを編集',
  save_comment: 'コメントを保存',
  saving_comment: 'コメントを保存中...',
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
    mutateAsyncMock.mockReset();
    getJsonMock.mockResolvedValue({ trackers: [{ id: 3, name: 'Feature' }] });
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
    expect(footerButtons[0].style.minWidth).toBe('112px');
    expect(footerButtons[1].style.height).toBe('28px');
    expect(footerButtons[1].style.minWidth).toBe('112px');
  });

  it('keeps the dialog open and switches to edit action after issue save success', async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    const { container } = render(
      <IframeEditDialog
        url="/issues/1/edit"
        issueId={1}
        issueTitle="Feature request"
        labels={labels}
        baseUrl=""
        queryKey={['kanban', 'board']}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    const doc = document.implementation.createHTMLDocument('iframe');
    doc.body.innerHTML = '<div id="content"><form id="issue-form"><button type="submit">Save</button></form></div>';
    const iframeWindow = {
      location: { href: 'http://example.com/issues/1/edit' },
      document: doc,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      $: vi.fn(() => ({ off: vi.fn() })),
    };
    Object.defineProperty(iframe, 'contentWindow', {
      value: iframeWindow,
      configurable: true,
    });
    Object.defineProperty(iframe, 'contentDocument', { value: doc, configurable: true });
    const nativeSubmit = doc.querySelector('button') as HTMLButtonElement;
    const nativeClick = vi.spyOn(nativeSubmit, 'click').mockImplementation(() => undefined);

    fireEvent.load(iframe);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(nativeClick).toHaveBeenCalledOnce();

    iframeWindow.location.href = 'http://example.com/issues/1';
    doc.body.innerHTML = '<div id="content"><div class="issue details">Saved issue</div></div>';
    fireEvent.load(iframe);

    await waitFor(() => {
      expect(onClose).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith('保存済み 1', 1);
      expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
      expect(screen.getByRole('button', { name: 'チケットを編集' })).toBeTruthy();
    });
  });

  it('keeps the initial edit save locked when the iframe reloads the edit form', async () => {
    mutateAsyncMock.mockResolvedValue([]);
    const { container } = render(
      <IframeEditDialog
        url="/issues/1/edit"
        issueId={1}
        issueTitle="Feature request"
        projectId={3}
        labels={labels}
        baseUrl="/projects/demo/kanban"
        queryKey={['kanban', 'board']}
        onClose={() => {}}
        onSuccess={() => {}}
      />,
    );

    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    const doc = document.implementation.createHTMLDocument('edit iframe');
    doc.body.innerHTML = `
      <div id="content"><form id="issue-form">
        <input name="issue[project_id]" value="3" />
        <input name="issue[priority_id]" value="4" />
        <input name="issue[status_id]" value="2" />
        <button type="submit">Save</button>
      </form></div>`;
    const iframeWindow = {
      location: { href: 'http://example.com/issues/1/edit' },
      document: doc,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(iframe, 'contentWindow', { value: iframeWindow, configurable: true });
    Object.defineProperty(iframe, 'contentDocument', { value: doc, configurable: true });

    fireEvent.load(iframe);
    await waitFor(() => expect(getJsonMock).toHaveBeenCalledWith('/projects/demo/kanban/trackers?target_project_id=3'));
    fireEvent.click(screen.getByRole('button', { name: /子チケット一括登録/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '子チケット一括登録 (1行に1件名)' }), { target: { value: '子チケット 1' } });

    const nativeSubmit = doc.querySelector('button[type="submit"]') as HTMLButtonElement;
    const nativeClick = vi.spyOn(nativeSubmit, 'click').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    fireEvent.load(iframe);
    await waitFor(() => expect(screen.getByRole('button', { name: '保存中' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '保存中' }));
    expect(nativeClick).toHaveBeenCalledOnce();
  });

  it('shows edit action initially and save action when an issue-show dialog has subtask input', async () => {
    const { container } = render(
      <IframeEditDialog
        url="/issues/1"
        issueId={1}
        issueTitle="Feature request"
        labels={labels}
        baseUrl=""
        queryKey={['kanban', 'board']}
        onClose={() => {}}
        onSuccess={() => {}}
      />,
    );

    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    const doc = document.implementation.createHTMLDocument('iframe');
    doc.body.innerHTML = '<div id="content"><div class="issue details">Issue</div></div>';
    Object.defineProperty(iframe, 'contentWindow', {
      value: { location: { href: 'http://example.com/issues/1' }, document: doc, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      configurable: true,
    });
    Object.defineProperty(iframe, 'contentDocument', { value: doc, configurable: true });

    fireEvent.load(iframe);
    await waitFor(() => expect(getJsonMock).toHaveBeenCalledWith('/trackers'));
    await screen.findByRole('button', { name: 'チケットを編集' });
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /子チケット一括登録/ }));
    expect(screen.getByRole('textbox', { name: '子チケット一括登録 (1行に1件名)' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: '標準トラッカー' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Set tracker per row' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '表形式入力' }));
    expect(screen.queryByRole('combobox', { name: '標準トラッカー' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '一括テキスト入力' }));
    expect(screen.getByRole('combobox', { name: '標準トラッカー' })).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: '子チケット一括登録 (1行に1件名)' }), { target: { value: '子チケット 1' } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '保存' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'チケットを編集' })).toBeNull();
    });

    fireEvent.change(screen.getByRole('textbox', { name: '子チケット一括登録 (1行に1件名)' }), { target: { value: '' } });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'チケットを編集' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
    });

    fireEvent.change(screen.getByRole('textbox', { name: '子チケット一括登録 (1行に1件名)' }), { target: { value: '  \n\t' } });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'チケットを編集' })).toBeTruthy();
      expect(mutateAsyncMock).not.toHaveBeenCalled();
    });
  });

  it('keeps edit issue action usable when bulk subtask registration is open', async () => {
    const { container } = render(
      <IframeEditDialog
        url="/issues/1"
        issueId={1}
        issueTitle="Feature request"
        labels={labels}
        baseUrl=""
        queryKey={['kanban', 'board']}
        onClose={() => {}}
        onSuccess={() => {}}
      />,
    );

    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    const doc = document.implementation.createHTMLDocument('iframe');
    doc.body.innerHTML = '<div id="content"><div class="issue details">Issue</div></div>';
    const iframeWindow = { location: { href: 'http://example.com/issues/1' }, document: doc, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    Object.defineProperty(iframe, 'contentWindow', { value: iframeWindow, configurable: true });
    Object.defineProperty(iframe, 'contentDocument', { value: doc, configurable: true });

    fireEvent.load(iframe);
    await screen.findByRole('button', { name: 'チケットを編集' });
    fireEvent.click(screen.getByRole('button', { name: /子チケット一括登録/ }));

    fireEvent.click(screen.getByRole('button', { name: 'チケットを編集' }));

    expect(iframeWindow.location.href).toBe('http://example.com/issues/1/edit');
  });

  it('keeps subtask input through issue-show to edit and creates subtasks after saving the issue', async () => {
    let resolveBulkMutation: ((value: never[]) => void) | undefined;
    mutateAsyncMock.mockReturnValue(new Promise<never[]>((resolve) => {
      resolveBulkMutation = resolve;
    }));
    const onSuccess = vi.fn();
    const { container } = render(
      <IframeEditDialog
        url="/issues/1"
        issueId={1}
        issueTitle="Feature request"
        projectId={3}
        labels={labels}
        baseUrl="/projects/demo/kanban"
        queryKey={['kanban', 'board']}
        onClose={() => {}}
        onSuccess={onSuccess}
      />,
    );

    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    const doc = document.implementation.createHTMLDocument('iframe');
    doc.body.innerHTML = '<div id="content"><div class="issue details">Issue</div></div>';
    const iframeWindow = {
      location: { href: 'http://example.com/issues/1' },
      document: doc,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      $: vi.fn(() => ({ off: vi.fn() })),
    };
    Object.defineProperty(iframe, 'contentWindow', { value: iframeWindow, configurable: true });
    Object.defineProperty(iframe, 'contentDocument', { value: doc, configurable: true });

    fireEvent.load(iframe);
    await waitFor(() => expect(getJsonMock).toHaveBeenCalledWith('/projects/demo/kanban/trackers?target_project_id=3'));
    fireEvent.click(screen.getByRole('button', { name: /子チケット一括登録/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '子チケット一括登録 (1行に1件名)' }), { target: { value: '子チケット 1\n子チケット 2' } });
    await screen.findByRole('button', { name: '保存' });

    const issueEditForm = document.implementation.createHTMLDocument('edit iframe');
    issueEditForm.body.innerHTML = `
      <div id="content"><form id="issue-form">
        <input name="issue[priority_id]" value="4" />
        <input name="issue[status_id]" value="2" />
        <input name="issue[assigned_to_id]" value="8" />
        <button type="submit">Save</button>
      </form></div>`;
    iframeWindow.location.href = 'http://example.com/issues/1/edit';
    Object.defineProperty(iframe, 'contentDocument', { value: issueEditForm, configurable: true });
    const nativeSubmit = issueEditForm.querySelector('button') as HTMLButtonElement;
    const nativeClick = vi.spyOn(nativeSubmit, 'click').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    fireEvent.load(iframe);

    expect(nativeClick).toHaveBeenCalledOnce();

    iframeWindow.location.href = 'http://example.com/issues/1';
    issueEditForm.body.innerHTML = '<div id="content"><div class="issue details">Saved issue</div></div>';
    fireEvent.load(iframe);
    fireEvent.load(iframe);

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
      expect(mutateAsyncMock).toHaveBeenCalledWith({
        parent: { parent_issue_id: 1, project_id: 3 },
        subtasks: [
          expect.objectContaining({ subject: '子チケット 1', project_id: 3, tracker_id: 3 }),
          expect.objectContaining({ subject: '子チケット 2', project_id: 3, tracker_id: 3 }),
        ],
      });
      const bulkPayload = mutateAsyncMock.mock.calls[0]?.[0] as { subtasks: Array<Record<string, unknown>> };
      expect(bulkPayload.subtasks[0]).not.toHaveProperty('description');
    });
    resolveBulkMutation?.([]);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'チケットを編集' })).toBeTruthy();
      expect((screen.getByRole('button', { name: /子チケット一括登録/ }) as HTMLButtonElement).disabled).toBe(true);
    });

    fireEvent.click(screen.getByRole('button', { name: 'チケットを編集' }));
    expect((screen.getByRole('button', { name: /子チケット一括登録/ }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /子チケット一括登録/ }));
    expect((screen.getByRole('textbox', { name: '子チケット一括登録 (1行に1件名)' }) as HTMLTextAreaElement).value).toBe('');
    iframeWindow.location.href = 'http://example.com/issues/1/edit';
    issueEditForm.body.innerHTML = `
      <div id="content"><form id="issue-form">
        <input name="issue[priority_id]" value="4" />
        <input name="issue[status_id]" value="2" />
        <button type="submit">Save</button>
      </form></div>`;
    fireEvent.load(iframe);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    iframeWindow.location.href = 'http://example.com/issues/1';
    issueEditForm.body.innerHTML = '<div id="content"><div class="issue details">Saved again</div></div>';
    fireEvent.load(iframe);
    fireEvent.load(iframe);

    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(1));
  });

  it('shows comment save action when a journal edit form is active', async () => {
    const { container } = render(
      <IframeEditDialog
        url="/issues/1"
        issueId={1}
        issueTitle="Feature request"
        labels={labels}
        baseUrl=""
        queryKey={['kanban', 'board']}
        onClose={() => {}}
        onSuccess={() => {}}
      />,
    );

    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    const doc = document.implementation.createHTMLDocument('iframe');
    doc.body.innerHTML = '<div id="content"><form id="journal-42-form"><textarea name="journal[notes]"></textarea></form></div>';
    Object.defineProperty(iframe, 'contentWindow', {
      value: {
        location: { href: 'http://example.com/issues/1' },
        document: doc,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      configurable: true,
    });
    Object.defineProperty(iframe, 'contentDocument', { value: doc, configurable: true });

    fireEvent.load(iframe);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'コメントを保存' })).toBeTruthy();
    });
  });

  it('keeps the dialog open after journal save success', async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    const { container } = render(
      <IframeEditDialog
        url="/issues/1"
        issueId={1}
        issueTitle="Feature request"
        labels={labels}
        baseUrl=""
        queryKey={['kanban', 'board']}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    const doc = document.implementation.createHTMLDocument('iframe');
    doc.body.innerHTML = '<div id="content"><form id="journal-42-form"><button type="submit">Save</button><textarea name="journal[notes]"></textarea></form></div>';
    const iframeWindow = {
      location: { href: 'http://example.com/issues/1' },
      document: doc,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(iframe, 'contentWindow', {
      value: iframeWindow,
      configurable: true,
    });
    Object.defineProperty(iframe, 'contentDocument', { value: doc, configurable: true });
    const nativeSubmit = doc.querySelector('button') as HTMLButtonElement;
    const nativeClick = vi.spyOn(nativeSubmit, 'click').mockImplementation(() => undefined);

    fireEvent.load(iframe);
    await screen.findByRole('button', { name: 'コメントを保存' });
    fireEvent.click(screen.getByRole('button', { name: 'コメントを保存' }));

    expect(nativeClick).toHaveBeenCalledOnce();

    doc.body.innerHTML = '<div id="content"><div class="issue details">Saved comment</div></div>';
    fireEvent.load(iframe);

    await waitFor(() => {
      expect(onClose).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith('保存済み 1', 1);
      expect(screen.getByRole('button', { name: 'チケットを編集' })).toBeTruthy();
    });
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
