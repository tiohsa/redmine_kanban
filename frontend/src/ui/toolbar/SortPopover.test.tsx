// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SortConfig } from '../board/sort';
import { SortPopover } from './SortPopover';

const labels = {
  sort: 'Sort',
  issue_due_date: 'Due Date',
  issue_priority: 'Priority',
  updated: 'Updated',
  add: 'Add sort condition',
  reset: 'Reset',
  delete: 'Delete',
};

afterEach(() => cleanup());

function openPopover(sortConfig: SortConfig = [{ field: 'updated', direction: 'desc' }]) {
  const onChangeSort = vi.fn();
  render(<SortPopover sortConfig={sortConfig} onChangeSort={onChangeSort} labels={labels} />);
  fireEvent.click(screen.getByTitle('Sort'));
  return onChangeSort;
}

describe('SortPopover', () => {
  it('shows the toolbar selection dot while a sort criterion is selected', () => {
    const onChangeSort = vi.fn();
    const { rerender } = render(<SortPopover sortConfig={[{ field: 'updated', direction: 'desc' }]} onChangeSort={onChangeSort} labels={labels} />);
    const trigger = screen.getByRole('button', { name: labels.sort });
    expect(trigger.querySelector('.rk-indicator-dot')).toBeTruthy();
    rerender(<SortPopover sortConfig={[]} onChangeSort={onChangeSort} labels={labels} />);
    expect(trigger.querySelector('.rk-indicator-dot')).toBeNull();
  });

  it('adds a criterion and excludes fields already in use', () => {
    const onChangeSort = openPopover();

    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: labels.add }));

    expect(onChangeSort).toHaveBeenCalledWith([
      { field: 'updated', direction: 'desc' },
      { field: 'due', direction: 'asc' },
    ]);

    const secondOnChangeSort = vi.fn();
    render(<SortPopover
      sortConfig={[{ field: 'updated', direction: 'desc' }, { field: 'due', direction: 'asc' }]}
      onChangeSort={secondOnChangeSort}
      labels={labels}
    />);
    fireEvent.click(screen.getAllByTitle('Sort')[1]);
    const selects = screen.getAllByRole('combobox');
    expect([...selects[0].querySelectorAll('option')].map((option) => option.value)).toEqual(['due', 'priority', 'updated']);
    expect([...selects[1].querySelectorAll('option')].map((option) => option.value)).toEqual(['priority', 'updated']);
  });

  it('toggles direction, deletes conditions, and resets to the default', () => {
    const onChangeSort = openPopover([
      { field: 'due', direction: 'asc' },
      { field: 'priority', direction: 'desc' },
      { field: 'updated', direction: 'asc' },
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Sort 1: Due Date ↑' }));
    expect(onChangeSort).toHaveBeenCalledWith([
      { field: 'due', direction: 'desc' },
      { field: 'priority', direction: 'desc' },
      { field: 'updated', direction: 'asc' },
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Delete: Sort 2' }));
    expect(onChangeSort).toHaveBeenCalledWith([
      { field: 'due', direction: 'asc' },
      { field: 'updated', direction: 'asc' },
    ]);

    fireEvent.click(screen.getByRole('button', { name: labels.reset }));
    expect(onChangeSort).toHaveBeenCalledWith([{ field: 'updated', direction: 'desc' }]);
  });

  it('keeps the only condition undeletable and caps the number of conditions', () => {
    const onChangeSort = openPopover([
      { field: 'due', direction: 'asc' },
      { field: 'priority', direction: 'asc' },
      { field: 'updated', direction: 'asc' },
    ]);

    expect(screen.getByRole('button', { name: labels.add })).toHaveProperty('disabled', true);
    expect(screen.getAllByRole('button', { name: /Delete:/ })).toHaveLength(3);

    const singleOnChangeSort = vi.fn();
    render(<SortPopover sortConfig={[{ field: 'due', direction: 'asc' }]} onChangeSort={singleOnChangeSort} labels={labels} />);
    fireEvent.click(screen.getAllByTitle('Sort')[1]);
    expect(screen.getAllByRole('button', { name: /Delete:/ }).find((element) => (element as HTMLButtonElement).disabled)).toBeTruthy();
  });
});
