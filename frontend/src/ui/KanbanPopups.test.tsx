// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatePopup, PriorityPopup, ProgressPopup } from './KanbanPopups';

const labels = {
  issue_due_date: 'Due date',
  calendar_previous_month: 'Previous month',
  calendar_next_month: 'Next month',
  calendar_year: 'Year',
  calendar_month: 'Month',
  calendar_today: 'Today',
  calendar_clear: 'Clear',
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 25, 12));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function clickDay(day: number) {
  const cell = document.querySelector<HTMLElement>(
    `.react-datepicker__day--${String(day).padStart(3, '0')}:not(.react-datepicker__day--outside-month)`,
  );
  expect(cell).not.toBeNull();
  fireEvent.click(cell!);
}

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

  it('moves from January to the previous December without saving', () => {
    const onCommit = vi.fn();
    render(<DatePopup x={0} y={0} value="2026-01-31" labels={labels} onClose={vi.fn()} onCommit={onCommit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByRole('combobox', { name: 'Year' })).toHaveProperty('value', '2025');
    expect(screen.getByRole('combobox', { name: 'Month' })).toHaveProperty('value', '11');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('moves from January 31 to February without accidentally saving a date', () => {
    const onCommit = vi.fn();
    render(<DatePopup x={0} y={0} value="2026-01-31" labels={labels} onClose={vi.fn()} onCommit={onCommit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('combobox', { name: 'Month' })).toHaveProperty('value', '1');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits only when a day is selected, including the same day number in another month', () => {
    const onClose = vi.fn();
    const onCommit = vi.fn();
    render(<DatePopup x={0} y={0} value="2026-08-19" labels={labels} onClose={onClose} onCommit={onCommit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(onCommit).not.toHaveBeenCalled();
    clickDay(19);

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

  it('offers 20 years either side of today and includes an older due date in sorted order', () => {
    render(<DatePopup x={0} y={0} value="1980-08-19" labels={labels} onClose={vi.fn()} onCommit={vi.fn()} />);
    const years = Array.from(screen.getByRole('combobox', { name: 'Year' }).querySelectorAll('option'), (option) => Number(option.value));
    expect(years).toContain(1980);
    expect(years).toContain(2006);
    expect(years).toContain(2046);
    expect(years).toEqual([...years].sort((a, b) => a - b));
  });

  it('selects a year beyond the former five-year range and saves only after choosing a day', () => {
    const onCommit = vi.fn();
    render(<DatePopup x={0} y={0} value="2026-08-19" labels={labels} onClose={vi.fn()} onCommit={onCommit} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Year' }), { target: { value: '2040' } });
    expect(onCommit).not.toHaveBeenCalled();
    clickDay(10);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('2040-08-10');
  });

  it('saves leap day and a past date without timezone conversion', () => {
    const leapCommit = vi.fn();
    const { unmount } = render(<DatePopup x={0} y={0} value="2024-02-01" labels={labels} onClose={vi.fn()} onCommit={leapCommit} />);
    clickDay(29);
    expect(leapCommit).toHaveBeenCalledExactlyOnceWith('2024-02-29');
    unmount();

    const pastCommit = vi.fn();
    render(<DatePopup x={0} y={0} value="2020-05-01" labels={labels} onClose={vi.fn()} onCommit={pastCommit} />);
    clickDay(15);
    expect(pastCommit).toHaveBeenCalledExactlyOnceWith('2020-05-15');
  });

  it('selects a date when the issue has no due date', () => {
    const onClose = vi.fn();
    const onCommit = vi.fn();
    render(<DatePopup x={0} y={0} value={null} labels={labels} onClose={onClose} onCommit={onCommit} />);

    clickDay(10);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('2026-09-10');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('commits today directly', () => {
    const onCommit = vi.fn();
    render(<DatePopup x={0} y={0} value="2026-08-19" labels={labels} onClose={vi.fn()} onCommit={onCommit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));

    expect(onCommit).toHaveBeenCalledExactlyOnceWith('2026-09-25');
  });

  it('clears the due date directly', () => {
    const onClose = vi.fn();
    const onCommit = vi.fn();
    render(<DatePopup x={0} y={0} value="2026-09-20" labels={labels} onClose={onClose} onCommit={onCommit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(onCommit).toHaveBeenCalledExactlyOnceWith(null);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not save or close twice when Escape follows a year and month change', () => {
    const onClose = vi.fn();
    const onCommit = vi.fn();
    render(<DatePopup x={0} y={0} value="2026-09-20" labels={labels} onClose={onClose} onCommit={onCommit} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Year' }), { target: { value: '2040' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Month' }), { target: { value: '1' } });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.mouseDown(document.body);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('dismisses an outside click without saving', () => {
    const onClose = vi.fn();
    const onCommit = vi.fn();
    render(<DatePopup x={0} y={0} value="2026-09-20" labels={labels} onClose={onClose} onCommit={onCommit} />);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('does not send a mutation for the same date', () => {
    const onCommit = vi.fn();
    render(<DatePopup x={0} y={0} value="2026-09-20" labels={labels} onClose={vi.fn()} onCommit={onCommit} />);
    clickDay(20);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('focuses the selected day and supports native arrow and Enter selection', async () => {
    const onCommit = vi.fn();
    render(<DatePopup x={0} y={0} value="2026-09-20" labels={labels} onClose={vi.fn()} onCommit={onCommit} />);
    await waitFor(() => expect(document.activeElement).toHaveProperty('className', expect.stringContaining('react-datepicker__day--selected')));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight', code: 'ArrowRight' });
    fireEvent.keyDown(document.activeElement!, { key: 'Enter', code: 'Enter' });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('2026-09-21');
  });

  it('restores focus to the invoking element after Escape', async () => {
    const source = document.createElement('button');
    document.body.append(source);
    source.focus();
    const onCommit = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(true);
      return open ? <DatePopup x={0} y={0} value="2026-09-20" labels={labels} restoreFocusTo={source} onClose={() => setOpen(false)} onCommit={onCommit} /> : null;
    }
    render(<Harness />);
    await waitFor(() => expect(document.activeElement?.className).toContain('react-datepicker__day--selected'));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(source));
    expect(onCommit).not.toHaveBeenCalled();
    source.remove();
  });

  it('does not restore focus from A after B opens', async () => {
    const source = document.createElement('button');
    document.body.append(source);
    source.focus();
    const focusOldSource = vi.spyOn(source, 'focus');
    function Harness() {
      const [open, setOpen] = useState<'A' | 'B' | null>('A');
      return <>
        <button type="button" onClick={() => setOpen('B')}>Open B</button>
        {open ? <DatePopup key={open} x={0} y={0} value="2026-09-20" labels={labels}
          restoreFocusTo={source} onClose={() => setOpen(null)} onCommit={vi.fn()} /> : null}
      </>;
    }
    render(<Harness />);
    await waitFor(() => expect(document.activeElement?.className).toContain('react-datepicker__day--selected'));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Open B' }));
    await waitFor(() => expect(document.activeElement?.className).toContain('react-datepicker__day--selected'));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(focusOldSource).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    source.remove();
  });

  it.each(['outside', 'day', 'today', 'clear'] as const)('restores focus after %s closes the calendar', async (action) => {
    const source = document.createElement('button');
    document.body.append(source);
    source.focus();
    function Harness() {
      const [open, setOpen] = useState(true);
      return open ? <DatePopup x={0} y={0} value="2026-09-20" labels={labels}
        restoreFocusTo={source} onClose={() => setOpen(false)} onCommit={vi.fn()} /> : null;
    }
    render(<Harness />);
    await waitFor(() => expect(document.activeElement?.className).toContain('react-datepicker__day--selected'));
    if (action === 'outside') fireEvent.mouseDown(document.body);
    else if (action === 'day') clickDay(21);
    else fireEvent.click(screen.getByRole('button', { name: action === 'today' ? 'Today' : 'Clear' }));
    await waitFor(() => expect(document.activeElement).toBe(source));
    source.remove();
  });

  it('skips focus restoration when the source was removed', async () => {
    const source = document.createElement('button');
    document.body.append(source);
    function Harness() {
      const [open, setOpen] = useState(true);
      return open ? <DatePopup x={0} y={0} value="2026-09-20" labels={labels}
        restoreFocusTo={source} onClose={() => { source.remove(); setOpen(false); }} onCommit={vi.fn()} /> : null;
    }
    render(<Harness />);
    await waitFor(() => expect(document.activeElement?.className).toContain('react-datepicker__day--selected'));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(document.activeElement).not.toBe(source);
  });
});

describe.each(['priority', 'progress'] as const)('%s popup keyboard access', (kind) => {
  function Harness({ onChange }: { onChange: (value: string | number) => void }) {
    const [open, setOpen] = useState(false);
    const [source, setSource] = useState<HTMLButtonElement | null>(null);
    return <>
      <button ref={setSource} type="button" onClick={() => setOpen(true)}>Open choices</button>
      {open && (kind === 'priority'
        ? <PriorityPopup x={0} y={0} value="1" options={[{ id: '1', name: 'Low' }, { id: '2', name: 'High' }]}
            restoreFocusTo={source} onClose={() => setOpen(false)} onChange={(value) => { onChange(value); setOpen(false); }} />
        : <ProgressPopup x={0} y={0} value={10} restoreFocusTo={source}
            onClose={() => setOpen(false)} onChange={(value) => { onChange(value); setOpen(false); }} />)}
    </>;
  }

  it('exposes selection and accepts Enter and Space', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const source = screen.getByRole('button', { name: 'Open choices' });
    fireEvent.click(source);
    const selected = screen.getByRole('button', { name: kind === 'priority' ? 'Low' : '10%' });
    const other = screen.getByRole('button', { name: kind === 'priority' ? 'High' : '20%' });
    expect(selected.getAttribute('aria-pressed')).toBe('true');
    expect(other.getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(selected);
    other.focus();
    fireEvent.keyDown(other, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(kind === 'priority' ? '2' : 20);
    await waitFor(() => expect(document.activeElement).toBe(source));

    fireEvent.click(source);
    const next = screen.getByRole('button', { name: kind === 'priority' ? 'High' : '20%' });
    next.focus();
    fireEvent.keyDown(next, { key: ' ' });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('closes on Escape, restores focus and retains mouse selection', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const source = screen.getByRole('button', { name: 'Open choices' });
    fireEvent.click(source);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(source));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(source);
    fireEvent.click(screen.getByRole('button', { name: kind === 'priority' ? 'High' : '20%' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(kind === 'priority' ? '2' : 20);
  });
});
