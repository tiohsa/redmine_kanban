// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SavedViewsPopover } from './SavedViewsPopover';
import type { SavedViewSettings } from '../savedViews';
const current: SavedViewSettings = { filters: { assigneeIds: [], q: '', due: 'all', priority: [], priorityFilterEnabled: false, projectIds: [1], statusIds: [2], trackerIds: [] }, sortConfig: [{ field: 'updated', direction: 'desc' }], laneType: 'none', hiddenStatusIds: [], viewableProjectsEnabled: false };
const labels = Object.fromEntries(['saved_views', 'saved_views_select', 'saved_views_none', 'saved_views_apply', 'saved_views_name', 'saved_views_new', 'saved_views_overwrite', 'saved_views_rename', 'saved_views_saved', 'saved_views_changed', 'saved_views_confirm_delete', 'saved_views_delete_confirm', 'saved_views_write_failed', 'saved_views_unreadable', 'saved_views_duplicate', 'saved_views_limit', 'delete', 'cancel'].map((k) => [k, k]));
const key = 'test-views';
const read = () => JSON.parse(localStorage.getItem(key) ?? '{}');
function setup() {
  const onApply = vi.fn();
  const props = { storageKey: key, current, onApply, labels, validation: { pending: false, unavailable: [] } };
  const view = render(<SavedViewsPopover {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'saved_views' }));
  return { ...view, props, onApply };
}
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const nameView = (name: string) => fireEvent.change(screen.getByRole('textbox', { name: 'saved_views_name' }), { target: { value: name } });
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('saved view operations', () => {
  it('saves, applies, detects edits, explicitly overwrites, renames and confirms deletion without resetting conditions', () => {
    const view = setup();
    nameView(' A '); click('saved_views_new');
    const id = read().views[0].id;
    expect(read().views[0]).toMatchObject({ name: 'A', settings: current });
    click('saved_views_apply');
    expect(view.onApply).toHaveBeenCalledExactlyOnceWith(current);
    const edited = { ...current, laneType: 'priority' as const };
    view.rerender(<SavedViewsPopover {...view.props} current={edited} />);
    expect(screen.getByRole('button', { name: /saved_views: A \(saved_views_changed\)/ })).toBeTruthy();
    expect(read().views[0].settings.laneType).toBe('none');
    click('saved_views_overwrite');
    expect(read().views[0].settings.laneType).toBe('priority');
    nameView('Renamed'); click('saved_views_rename');
    expect(read().views[0]).toMatchObject({ id, name: 'Renamed' });
    click('delete'); click('cancel');
    expect(read().views).toHaveLength(1);
    click('delete'); click('saved_views_confirm_delete');
    expect(read().views).toEqual([]);
    expect(view.onApply).toHaveBeenCalledTimes(1);
  });
  it('rejects duplicate new saves, the 21st view, and failed writes', () => {
    const view = setup();
    nameView('A'); click('saved_views_new'); click('saved_views_new');
    expect(screen.getByRole('alert').textContent).toBe('saved_views_duplicate');
    expect(read().views).toHaveLength(1);
    localStorage.setItem(key, JSON.stringify({ version: 1, views: Array.from({ length: 20 }, (_, i) => ({ id: String(i), name: String(i), settings: current })) }));
    nameView('21'); click('saved_views_new');
    expect(screen.getByRole('alert').textContent).toBe('saved_views_limit');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    click('saved_views_rename');
    expect(screen.queryByText('saved_views_saved')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    view.unmount();
  });
  it('does not claim success on a storage write failure', () => {
    setup(); nameView('A');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    click('saved_views_new');
    expect(screen.getByRole('alert').textContent).toBe('saved_views_write_failed');
    expect(screen.queryByText('saved_views_saved')).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });
  it.each(['{', '{"version":2,"views":[]}'])('retains unreadable storage %s', (raw) => {
    localStorage.setItem(key, raw); setup();
    expect(screen.getByRole('alert').textContent).toBe('saved_views_unreadable');
    expect(localStorage.getItem(key)).toBe(raw);
  });
  it('handles storage read failure', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    setup();
    expect(screen.getByRole('alert').textContent).toBe('saved_views_unreadable');
  });
});
