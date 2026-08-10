/**
 * @jest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BulkSubtaskEditor } from './BulkSubtaskEditor';

const labels = {
  bulk_subtask_title: 'Bulk subtasks',
  bulk_subtask_table_mode: 'Table',
  bulk_subtask_text_mode: 'Text',
  bulk_subtask_default_tracker: 'Default tracker',
  bulk_subtask_count: 'items detected',
  bulk_subtask_restored: '%{count} tracker settings restored.',
  bulk_subtask_preserved: 'Tracker settings are being preserved.',
  bulk_subtask_edit_rows: 'Edit rows',
  bulk_subtask_add_row: 'Add row',
  issue_subject: 'Subject',
  issue_tracker: 'Tracker',
  delete: 'Delete',
};

const trackers = [{ id: 1, name: 'Task' }, { id: 2, name: 'Bug' }];

describe('BulkSubtaskEditor', () => {
  afterEach(() => cleanup());

  it('uses the parent tracker for new text rows and does not restore a deleted row', async () => {
    const onChange = vi.fn();
    render(<BulkSubtaskEditor labels={labels} trackers={trackers} initialTrackerId={2} onChange={onChange} />);
    const textarea = screen.getByRole('textbox', { name: 'Bulk subtasks' });

    fireEvent.change(textarea, { target: { value: 'A\nB' } });
    fireEvent.click(screen.getByRole('button', { name: 'Edit rows' }));
    const rowTrackers = screen.getAllByRole('combobox');
    fireEvent.change(rowTrackers[1], { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Text' }));
    const textAreaAfterBack = screen.getByRole('textbox', { name: 'Bulk subtasks' });
    fireEvent.change(textAreaAfterBack, { target: { value: 'A' } });
    await waitFor(() => expect(screen.getByText('1 items detected')).toBeTruthy());
    fireEvent.change(textAreaAfterBack, { target: { value: 'A\nB' } });
    await waitFor(() => expect(screen.getByText('2 items detected')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit rows' }));

    expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('2');
    const latestInputs = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
    expect(latestInputs).toEqual([
      expect.objectContaining({ subject: 'A', trackerId: 2 }),
      expect.objectContaining({ subject: 'B', trackerId: 2 }),
    ]);
  });

  it('keeps an explicitly selected default tracker when the parent tracker changes', () => {
    const { rerender } = render(<BulkSubtaskEditor labels={labels} trackers={trackers} initialTrackerId={2} />);
    const defaultTracker = screen.getByRole('combobox', { name: 'Default tracker' });
    fireEvent.change(defaultTracker, { target: { value: '1' } });
    rerender(<BulkSubtaskEditor labels={labels} trackers={trackers} initialTrackerId={2} />);
    expect((screen.getByRole('combobox', { name: 'Default tracker' }) as HTMLSelectElement).value).toBe('1');
  });

  it('replaces unavailable tracker values before emitting inputs', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<BulkSubtaskEditor labels={labels} trackers={trackers} initialTrackerId={2} onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Bulk subtasks' }), { target: { value: 'A' } });
    rerender(<BulkSubtaskEditor labels={labels} trackers={[trackers[0]]} initialTrackerId={2} onChange={onChange} />);

    await waitFor(() => {
      const latestInputs = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
      expect(latestInputs).toEqual([expect.objectContaining({ subject: 'A', trackerId: 1 })]);
    });
    expect((screen.getByRole('combobox', { name: 'Default tracker' }) as HTMLSelectElement).value).toBe('1');
  });

  it('uses createDraftId for table rows added by the user', () => {
    render(<BulkSubtaskEditor labels={labels} trackers={trackers} initialTrackerId={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
    expect(Array.from(document.querySelectorAll('[data-subtask-id]')).every((element) => element.getAttribute('data-subtask-id')?.startsWith('subtask-'))).toBe(true);
  });
});
