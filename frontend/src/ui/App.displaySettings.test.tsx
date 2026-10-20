// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { CanvasBoard, CanvasBoardHandle } from './board/CanvasBoard';
import { DEFAULT_ISSUE_DIALOG_SIZE } from '../model/view/issueDialogSize';

vi.mock('./board/CanvasBoard', async () => {
  const { forwardRef } = await import('react');
  return {
    CanvasBoard: forwardRef<CanvasBoardHandle, ComponentProps<typeof CanvasBoard>>((props, _ref) => (
      <div data-testid="canvas-board" data-card-display-mode={props.cardDisplayMode} data-fit-mode={props.fitMode} data-font-size={props.fontSize}>
        <button onClick={() => props.onEditClick('/issues/1')}>View issue</button>
        <button onClick={() => props.onEditClick('/issues/1/edit')}>Edit issue</button>
        <button onClick={() => props.onCreate({ statusId: 1, projectId: 1 })}>Create issue</button>
      </div>
    )),
  };
});

vi.mock('../infrastructure/api/http', () => ({
  getJson: vi.fn((url: string) => Promise.resolve(url.includes('/trackers') ? { trackers: [] } : url.includes('/metadata') ? { ok: true, board: { id: 1, name: 'B', identifier: 'b' }, projects: [], viewable_projects: [], statuses: [], server_entity_limit: 10000, filter_options_complete: true, filter_options: { assignees: [], trackers: [], priorities: [] } } : {
    ok: true, contract_version: 3, scope_fingerprint: 'sha256:test',
    meta: { project_id: 1, project_ids: [1], scope_status_ids: [], current_user_id: 7, can_move: false, can_create: false, can_delete: false, lane_type: 'assignee', complete: true, entity_count: 0, server_entity_limit: null },
    columns: [], lanes: [], entities: [], tree: { root_ids: [], children_by_parent_id: {} },
    lists: { assignees: [], trackers: [], priorities: [], projects: [], viewable_projects: [], creatable_projects: [] },
    labels: {
      display_settings: '表示設定',
      card_display_mode: 'カード表示',
      card_display_standard: '標準',
      card_display_single_line: '1行',
      display_width: '表示幅',
      fit_none: '通常',
      fit_width: '幅に合わせる',
      font_size: 'フォントサイズ',
      show_subtasks_short: '子チケットを表示',
      issue_dialog_settings: 'チケットダイアログ',
      issue_dialog_width: '幅',
      issue_dialog_width_compact: 'コンパクト (900px)',
      issue_dialog_width_standard: '標準 (1200px)',
      issue_dialog_width_wide: 'ワイド (1500px)',
      issue_dialog_height: '高さ',
      issue_dialog_height_auto: '自動',
      issue_dialog_height_fixed: '固定',
      issue_dialog_height_percent: '固定高さ (%)',
      issue_dialog_fullscreen: '全画面表示',
      issue_dialog_reset: 'サイズをリセット',
    },
  })),
  isHttpError: vi.fn(() => false),
  postJson: vi.fn(),
}));

describe('App display settings', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    localStorage.clear();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  async function openDisplaySettings() {
    const view = render(
      <QueryClientProvider client={queryClient}>
        <App dataUrl="/projects/demo/kanban/data" initialCurrentUserId={7} />
      </QueryClientProvider>,
    );
    await screen.findByTestId('canvas-board');
    fireEvent.click(await screen.findByRole('button', { name: /表示設定/ }));
    return view;
  }

  it('changes and restores dialog sizes, disables overridden controls, and resets all fields', async () => {
    const view = await openDisplaySettings();
    const width = screen.getByRole<HTMLSelectElement>('combobox', { name: '幅' });
    const height = screen.getByRole<HTMLSelectElement>('combobox', { name: '高さ' });
    const percent = screen.getByRole<HTMLSelectElement>('combobox', { name: '固定高さ (%)' });
    expect(width.value).toBe('1200');
    expect(within(width).getAllByRole('option').map((option) => (option as HTMLOptionElement).value)).toEqual(['900', '1200', '1500']);
    expect(percent.disabled).toBe(true);
    expect(within(percent).getAllByRole('option').map((option) => (option as HTMLOptionElement).value)).toEqual(['50', '55', '60', '65', '70', '75', '80', '85', '90']);
    fireEvent.change(width, { target: { value: '900' } });
    fireEvent.change(height, { target: { value: 'fixed' } });
    expect(percent.disabled).toBe(false);
    fireEvent.change(percent, { target: { value: '65' } });
    fireEvent.click(screen.getByRole('switch', { name: '全画面表示' }));
    expect(width.disabled).toBe(true);
    expect(height.disabled).toBe(true);
    expect(percent.disabled).toBe(true);
    expect(JSON.parse(localStorage.getItem('rk_issue_dialog_size:user:7')!)).toEqual({ widthPx: 900, heightMode: 'fixed', heightPercent: 65, fullScreen: true });
    view.unmount();

    await openDisplaySettings();
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '幅' }).value).toBe('900');
    fireEvent.click(screen.getByRole('switch', { name: '全画面表示' }));
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '高さ' }).value).toBe('fixed');
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '固定高さ (%)' }).value).toBe('65');
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '幅' }).disabled).toBe(false);
    fireEvent.click(screen.getByRole('switch', { name: '全画面表示' }));
    fireEvent.click(screen.getByRole('button', { name: 'サイズをリセット' }));
    expect(JSON.parse(localStorage.getItem('rk_issue_dialog_size:user:7')!)).toEqual(DEFAULT_ISSUE_DIALOG_SIZE);
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '幅' }).value).toBe('1200');
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '高さ' }).value).toBe('auto');
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '固定高さ (%)' }).disabled).toBe(true);
  });

  it.each(['View issue', 'Edit issue', 'Create issue'])('passes configured sizes from the toolbar to %s', async (action) => {
    await openDisplaySettings();
    fireEvent.change(screen.getByRole('combobox', { name: '幅' }), { target: { value: '900' } });
    fireEvent.change(screen.getByRole('combobox', { name: '高さ' }), { target: { value: 'fixed' } });
    fireEvent.change(screen.getByRole('combobox', { name: '固定高さ (%)' }), { target: { value: '65' } });
    fireEvent.click(screen.getByRole('button', { name: action }));
    const dialog = await screen.findByTestId('issue-dialog-header');
    expect(dialog.parentElement?.style.width).toBe(`${Math.min(900, window.innerWidth * 0.98)}px`);
    expect(dialog.parentElement?.style.height).toBe(`${Math.max(320, Math.floor(window.innerHeight * 0.65))}px`);
  });

  it('returns focus on Escape, prevents propagation, and dismisses on outside mouse action', async () => {
    await openDisplaySettings();
    const trigger = screen.getByRole('button', { name: '表示設定' });
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('type')).toBe('button');
    const menu = screen.getByRole('dialog', { name: '表示設定' });
    expect(trigger.getAttribute('aria-controls')).toBe(menu.id);
    const behind = vi.fn();
    window.addEventListener('keydown', behind);
    screen.getByRole('combobox', { name: 'フォントサイズ' }).focus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '表示設定' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(behind).not.toHaveBeenCalled();
    window.removeEventListener('keydown', behind);
    fireEvent.click(trigger);
    const outside = document.createElement('button'); document.body.appendChild(outside); outside.focus();
    fireEvent.mouseDown(outside);
    expect(screen.queryByRole('dialog', { name: '表示設定' })).toBeNull();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('does not expose the server entity ceiling as a user setting', async () => {
    await openDisplaySettings();
    expect(document.querySelector('#rk-maximum-board-entity-count')).toBeNull();
    expect(screen.queryByText('Maximum Board Entity Count')).toBeNull();
  });

  it.each([13, 18])('shows the same font size %i in settings and Canvas', async (size) => {
    if (size !== 13) localStorage.setItem('rk_font_size:user:7', String(size));
    await openDisplaySettings();
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'フォントサイズ' }).value).toBe(String(size));
    expect(screen.getByTestId('canvas-board').getAttribute('data-font-size')).toBe(String(size));
  });

  it('switches and persists both display modes through the toolbar independently of subtasks', async () => {
    const view = await openDisplaySettings();
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'カード表示' });
    expect(select.value).toBe('standard');
    expect(screen.getByTestId('canvas-board').getAttribute('data-card-display-mode')).toBe('standard');
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['標準', '1行']);

    fireEvent.change(select, { target: { value: 'single_line' } });
    expect(select.value).toBe('single_line');
    expect(screen.getByTestId('canvas-board').getAttribute('data-card-display-mode')).toBe('single_line');
    expect(localStorage.getItem('rk_card_display_mode:user:7')).toBe('single_line');
    expect((screen.getByRole('switch', { name: '子チケットを表示' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('switch', { name: '子チケットを表示' }).getAttribute('aria-checked')).toBe('false');

    fireEvent.change(select, { target: { value: 'standard' } });
    expect(select.value).toBe('standard');
    expect(screen.getByTestId('canvas-board').getAttribute('data-card-display-mode')).toBe('standard');
    expect(localStorage.getItem('rk_card_display_mode:user:7')).toBe('standard');
    expect(screen.getByRole('switch', { name: '子チケットを表示' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('switch', { name: '子チケットを表示' }));
    expect(screen.getByRole('switch', { name: '子チケットを表示' }).getAttribute('aria-checked')).toBe('false');

    fireEvent.change(select, { target: { value: 'single_line' } });
    view.unmount();
    await openDisplaySettings();
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'カード表示' }).value).toBe('single_line');
    expect(screen.getByTestId('canvas-board').getAttribute('data-card-display-mode')).toBe('single_line');
    expect((screen.getByRole('switch', { name: '子チケットを表示' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('switch', { name: '子チケットを表示' }).getAttribute('aria-checked')).toBe('false');
  });

  it('displays standard when the stored mode is invalid', async () => {
    localStorage.setItem('rk_card_display_mode:user:7', 'invalid');
    await openDisplaySettings();
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'カード表示' }).value).toBe('standard');
    expect(screen.getByTestId('canvas-board').getAttribute('data-card-display-mode')).toBe('standard');
    expect(localStorage.getItem('rk_card_display_mode:user:7')).toBe('standard');
  });

  it('keeps width and font size independent from the card display mode', async () => {
    await openDisplaySettings();
    fireEvent.change(screen.getByRole('combobox', { name: '表示幅' }), { target: { value: 'width' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'フォントサイズ' }), { target: { value: '30' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'カード表示' }), { target: { value: 'single_line' } });

    const board = screen.getByTestId('canvas-board');
    expect(board.getAttribute('data-card-display-mode')).toBe('single_line');
    expect(board.getAttribute('data-fit-mode')).toBe('width');
    expect(board.getAttribute('data-font-size')).toBe('30');

    fireEvent.change(screen.getByRole('combobox', { name: 'フォントサイズ' }), { target: { value: '10' } });
    fireEvent.change(screen.getByRole('combobox', { name: '表示幅' }), { target: { value: 'none' } });
    expect(board.getAttribute('data-card-display-mode')).toBe('single_line');
    expect(board.getAttribute('data-fit-mode')).toBe('none');
    expect(board.getAttribute('data-font-size')).toBe('10');
  });
});
