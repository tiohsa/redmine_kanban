/**
 * @jest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HelpDialog } from './HelpDialog';

describe('HelpDialog', () => {
  const mockLabels = {
    help: 'ヘルプ',
    close: '閉じる',
    help_chapter1_title: '第1章',
    help_chapter1_desc: 'アイコン説明',
    help_chapter2_title: '第2章',
    help_add: '追加',
    help_filter: 'フィルタ',
    help_drag_drop_title: 'ドラッグ',
    help_drag_drop_desc: 'ドラッグ説明',
    help_edit_title: '編集',
    help_edit_desc: '編集説明',
    help_quick_edit_title: 'クイック',
    help_quick_edit_desc: 'クイック説明',
    help_subtask_title: '子チケット',
    help_subtask_desc: '子チケット説明',
  };

  it('renders all sections and labels', () => {
    const onClose = vi.fn();
    render(<HelpDialog labels={mockLabels} onClose={onClose} />);

    // screen.debug();
    expect(screen.getByText('ヘルプ')).toBeTruthy();
    expect(screen.getByText('第1章')).toBeTruthy();
    expect(screen.getByText('第2章')).toBeTruthy();
    expect(screen.getByText('追加')).toBeTruthy();
    expect(screen.getByText('ドラッグ')).toBeTruthy();
  });

  it('calls onClose when Close buttons are clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<HelpDialog labels={mockLabels} onClose={onClose} />);

    const footerBtn = container.querySelector('.rk-help-close-footer') as HTMLElement;
    fireEvent.click(footerBtn);
    expect(onClose).toHaveBeenCalledTimes(1);

    const xButton = container.querySelector('.rk-help-close-x') as HTMLElement;
    fireEvent.click(xButton);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<HelpDialog labels={mockLabels} onClose={onClose} />);

    const backdrop = container.firstChild as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    render(<HelpDialog labels={mockLabels} onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
