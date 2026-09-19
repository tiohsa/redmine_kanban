// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { CanvasBoard, CanvasBoardHandle } from './board/CanvasBoard';

vi.mock('./board/CanvasBoard', async () => {
  const { forwardRef } = await import('react');
  return {
    CanvasBoard: forwardRef<CanvasBoardHandle, ComponentProps<typeof CanvasBoard>>((props, _ref) => (
      <div data-testid="canvas-board" data-card-display-mode={props.cardDisplayMode} data-fit-mode={props.fitMode} data-font-size={props.fontSize} />
    )),
  };
});

vi.mock('./http', () => ({
  getJson: vi.fn(() => Promise.resolve({
    ok: true, contract_version: 3, scope_fingerprint: 'sha256:test',
    meta: { project_id: 1, project_ids: [1], scope_status_ids: [], current_user_id: 7, can_move: false, can_create: false, can_delete: false, complete: true, entity_count: 0 },
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
      maximum_board_entity_count_help: '最大 %{max} 件',
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
