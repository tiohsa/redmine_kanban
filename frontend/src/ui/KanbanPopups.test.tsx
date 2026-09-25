// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatePopup } from './KanbanPopups';

const labels = {
  issue_due_date: 'Due date',
  calendar_previous_month: 'Previous month',
  calendar_next_month: 'Next month',
  calendar_year: 'Year',
  calendar_month: 'Month',
  calendar_today: 'Today',
  calendar_clear: 'Clear',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DatePopup', () => {
  it('changes months without selecting or committing a date', () => {
    const onClose = vi.fn();
    const onCommit = vi.fn();
    render(<DatePopup x={0} y={0} value="2026-12-31" labels={labels} onClose={onClose} onCommit={onCommit} />);
    expect(screen.getByRole('dialog').classList.contains('rk-minimax-datepicker')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));

    expect(screen.getByRole('combobox', { name: 'Year' })).toHaveProperty('value', '2027');
    expect(screen.getByRole('combobox', { name: 'Month' })).toHaveProperty('value', '0');
    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByRole('combobox', { name: 'Year' })).toHaveProperty('value', '2026');
    expect(screen.getByRole('combobox', { name: 'Month' })).toHaveProperty('value', '11');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits only when a day is selected, including the same day number in another month', () => {
    const onClose = vi.fn();
    const onCommit = vi.fn();
    render(<DatePopup x={0} y={0} value="2026-08-19" labels={labels} onClose={onClose} onCommit={onCommit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(onCommit).not.toHaveBeenCalled();
    const day = document.querySelector<HTMLElement>('.react-datepicker__day--019:not(.react-datepicker__day--outside-month)');
    expect(day).not.toBeNull();
    fireEvent.click(day!);

    expect(onCommit).toHaveBeenCalledExactlyOnceWith('2026-09-19');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('can jump to another year without committing a date', () => {
    const onCommit = vi.fn();
    render(<DatePopup x={0} y={0} value="2026-08-19" labels={labels} onClose={vi.fn()} onCommit={onCommit} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Year' }), { target: { value: '2030' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Month' }), { target: { value: '1' } });

    expect(screen.getByRole('combobox', { name: 'Year' })).toHaveProperty('value', '2030');
    expect(screen.getByRole('combobox', { name: 'Month' })).toHaveProperty('value', '1');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('selects a date when the issue has no due date', () => {
    const onClose = vi.fn();
    const onCommit = vi.fn();
    render(<DatePopup x={0} y={0} value={null} labels={labels} onClose={onClose} onCommit={onCommit} />);

    const day = document.querySelector<HTMLElement>('.react-datepicker__day--010:not(.react-datepicker__day--outside-month)');
    expect(day).not.toBeNull();
    fireEvent.click(day!);

    const now = new Date();
    const selectedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-10`;
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(selectedDate);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('commits today directly', () => {
    const onCommit = vi.fn();
    render(<DatePopup x={0} y={0} value="2026-08-19" labels={labels} onClose={vi.fn()} onCommit={onCommit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(today);
  });

  it('clears the due date directly', () => {
    const onClose = vi.fn();
    const onCommit = vi.fn();
    render(<DatePopup x={0} y={0} value="2026-09-20" labels={labels} onClose={onClose} onCommit={onCommit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(onCommit).toHaveBeenCalledExactlyOnceWith(null);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses without committing on Escape or outside click', () => {
    const onClose = vi.fn();
    const onCommit = vi.fn();
    render(<DatePopup x={0} y={0} value="2026-09-20" labels={labels} onClose={onClose} onCommit={onCommit} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.mouseDown(document.body);

    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
