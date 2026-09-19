// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatePopup } from './KanbanPopups';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DatePopup', () => {
  it('commits immediately when selecting a date for an issue without a due date', () => {
    const onClose = vi.fn();
    const onCommit = vi.fn();
    const { container } = render(
      <DatePopup x={0} y={0} value={null} onClose={onClose} onCommit={onCommit} />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="date"]');
    expect(input).not.toBeNull();

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    fireEvent.change(input!, { target: { value: today } });

    expect(onCommit).toHaveBeenCalledWith(today);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clears the due date immediately when the calendar selection is cleared', () => {
    const onClose = vi.fn();
    const onCommit = vi.fn();
    const { container } = render(
      <DatePopup x={0} y={0} value="2026-09-20" onClose={onClose} onCommit={onCommit} />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="date"]');
    expect(input).not.toBeNull();

    fireEvent.change(input!, { target: { value: '' } });

    expect(onCommit).toHaveBeenCalledWith(null);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('commits today when the existing due date has the same day number', () => {
    const onClose = vi.fn();
    const onCommit = vi.fn();
    const { container } = render(
      <DatePopup x={0} y={0} value="2026-08-19" onClose={onClose} onCommit={onCommit} />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="date"]');
    expect(input).not.toBeNull();

    fireEvent.change(input!, { target: { value: '2026-09-19' } });

    expect(onCommit).toHaveBeenCalledWith('2026-09-19');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
