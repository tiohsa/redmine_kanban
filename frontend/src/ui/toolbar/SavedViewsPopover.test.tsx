// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SavedViewsPopover } from './SavedViewsPopover';
import { parseSavedViews, type SavedViewSettings } from '../../model/view/savedViews';
import { activeSavedViewKey } from '../../infrastructure/storage/savedViewsRepository';
const current: SavedViewSettings = { filters: { assigneeIds: [], q: '', due: 'all', priority: [], priorityFilterEnabled: false, projectIds: [1], statusIds: [2], trackerIds: [] }, sortConfig: [{ field: 'updated', direction: 'desc' }], laneType: 'none', hiddenStatusIds: [], viewableProjectsEnabled: false };
const labels = Object.fromEntries(['saved_views', 'saved_views_select', 'saved_views_none', 'saved_views_apply', 'saved_views_name', 'saved_views_new', 'saved_views_overwrite', 'saved_views_rename', 'saved_views_saved', 'saved_views_changed', 'saved_views_confirm_delete', 'saved_views_delete_confirm', 'saved_views_write_failed', 'saved_views_unreadable', 'saved_views_duplicate', 'saved_views_limit', 'saved_views_empty', 'saved_views_manage', 'saved_views_back', 'saved_views_create_title', 'saved_views_rename_title', 'saved_views_rename_submit', 'saved_views_pending', 'saved_views_clear', 'saved_views_clear_help', 'saved_views_switch', 'saved_views_switch_help', 'saved_views_manage_help', 'close', 'due', 'all', 'overdue', 'this_week', 'within_3_days', 'within_1_week', 'within_1_day', 'not_set', 'lane_type', 'none', 'assignee', 'issue_priority', 'category', 'save', 'delete', 'cancel'].map((k) => [k, k]));
labels.saved_views_actions = 'Actions for %{name}';
labels.saved_views_due_days = 'Within %{days} days';
const key = 'test-views';
const read = () => JSON.parse(localStorage.getItem(key) ?? '{}');
function setup() {
  const onApply = vi.fn();
  const props = { storageKey: key, current, onApply, labels, validation: { pending: false, unavailable: [] } };
  const view = render(<SavedViewsPopover {...props} />);
  fireEvent.click(screen.getByRole('button', { name: /^saved_views(?:$|:)/ }));
  return { ...view, props, onApply };
}
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const startCreate = () => click('saved_views_new');
const createView = (name: string) => { startCreate(); nameView(name); click('save'); };
const manage = (name: string) => { click('saved_views_manage'); click(`Actions for ${name}`); };
const nameView = (name: string) => fireEvent.change(screen.getByRole('textbox', { name: 'saved_views_name' }), { target: { value: name } });
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('saved view operations', () => {
  it('focuses the active view on reopen, then the first view or another action when none is active', () => {
    const view = setup();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'saved_views_new' }));
    createView('A'); createView('B'); createView('C');
    click('close'); click('saved_views: C');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'C', pressed: true }));
    const clear = screen.getByRole('button', { name: 'saved_views_clear' });
    const manage = screen.getByRole('button', { name: 'saved_views_manage' });
    expect(manage.compareDocumentPosition(clear) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(clear.getAttribute('title')).toBe('saved_views_clear_help');
    click('saved_views_clear'); click('saved_views');
    expect(localStorage.getItem(activeSavedViewKey(key))).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'A', pressed: false }));
    expect(view.onApply).not.toHaveBeenCalled();
  });
  it.each(['none', 'priority'] as const)('clears selection with %s lanes without applying or writing settings', (laneType) => {
    const view = setup();
    expect(screen.queryByRole('button', { name: 'saved_views_clear' })).toBeNull();
    createView('A');
    view.rerender(<SavedViewsPopover {...view.props} current={{ ...current, laneType }} />);
    const before = localStorage.getItem(key);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    click('saved_views_clear');
    expect(view.onApply).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBe(before);
    expect(screen.queryByRole('dialog')).toBeNull();
    const trigger = screen.getByRole('button', { name: 'saved_views' });
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'A', pressed: false })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'saved_views_clear' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'saved_views_overwrite' })).toBeNull();
    expect(screen.queryAllByText('saved_views_changed')).toHaveLength(0);
    createView('B');
    expect(read().views[1].settings.laneType).toBe(laneType);
    expect(screen.getByRole('button', { name: 'B', pressed: true })).toBeTruthy();
    expect(view.onApply).not.toHaveBeenCalled();
    click('saved_views_clear'); click('saved_views'); click('A');
    expect(view.onApply).toHaveBeenCalledExactlyOnceWith(current);
  });
  it('shows saved conditions as an accessible description and a close control that restores focus', () => {
    localStorage.setItem(key, JSON.stringify({ version: 1, views: [
      { id: 'a', name: 'A', settings: { ...current, filters: { ...current.filters, due: 'custom', dueDays: 14 }, laneType: 'category' } },
    ] }));
    const view = setup();
    const row = screen.getByRole('button', { name: 'A' });
    expect(document.getElementById(row.getAttribute('aria-describedby')!)?.textContent).toBe('due: Within 14 days / lane_type: category');
    click('close');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'saved_views' }));
    expect(view.onApply).not.toHaveBeenCalled();
  });

  it('keeps the list open and focused while switching views immediately', () => {
    localStorage.setItem(key, JSON.stringify({ version: 1, views: [
      { id: 'a', name: 'A', settings: current }, { id: 'b', name: 'B', settings: { ...current, laneType: 'priority' } },
    ] }));
    const view = setup();
    expect(screen.getByRole('button', { name: 'A', pressed: false })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'B', pressed: false })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'saved_views_apply' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'saved_views_rename' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'delete' })).toBeNull();
    click('A');
    expect(view.onApply).toHaveBeenCalledExactlyOnceWith(current);
    expect(screen.getByRole('dialog', { name: 'saved_views' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'saved_views: A' }).getAttribute('aria-expanded')).toBe('true');
    const active = screen.getByRole('button', { name: 'A', pressed: true });
    expect(document.activeElement).toBe(active);
    expect(active.querySelector('.rk-saved-views-check')?.textContent).toBe('check');
    click('B');
    expect(view.onApply).toHaveBeenLastCalledWith({ ...current, laneType: 'priority' });
    expect(view.onApply).toHaveBeenCalledTimes(2);
    view.rerender(<SavedViewsPopover {...view.props} current={{ ...current, laneType: 'priority' }} />);
    expect(screen.getByRole('button', { name: 'A', pressed: false })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'B', pressed: true })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'saved_views' })).toBeTruthy();
    click('close');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'saved_views: B' }));
  });
  it('keeps the active view separate from the management target when saving changes', () => {
    const view = setup();
    createView('A'); createView('B');
    manage('A'); click('saved_views_rename'); nameView(' Renamed A '); click('saved_views_rename_submit');
    expect(read().views[0]).toMatchObject({ name: 'Renamed A', settings: current });
    expect(screen.getByRole('button', { name: 'saved_views: B' })).toBeTruthy();
    click('saved_views_back');
    view.rerender(<SavedViewsPopover {...view.props} current={{ ...current, laneType: 'priority' }} />);
    click('saved_views_overwrite');
    expect(read().views.map((v: { settings: SavedViewSettings }) => v.settings.laneType)).toEqual(['none', 'priority']);
    manage('Renamed A'); click('delete'); click('saved_views_confirm_delete');
    expect(screen.getByRole('button', { name: 'saved_views: B' })).toBeTruthy();
    expect(view.onApply).not.toHaveBeenCalled();
  });
  it('focuses the name field and returns focus to the trigger on Escape from every screen', () => {
    setup(); createView('A');
    for (const mode of ['list', 'manage', 'create', 'rename', 'delete']) {
      if (mode === 'manage') click('saved_views_manage');
      if (mode === 'create') startCreate();
      if (mode === 'rename' || mode === 'delete') { manage('A'); click(mode === 'rename' ? 'saved_views_rename' : 'delete'); }
      if (mode === 'create' || mode === 'rename') expect(document.activeElement).toBe(screen.getByRole('textbox'));
      fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
      const trigger = screen.getByRole('button', { name: 'saved_views: A' });
      expect(document.activeElement).toBe(trigger);
      fireEvent.click(trigger);
      expect(screen.getByRole('dialog', { name: 'saved_views' })).toBeTruthy();
    }
  });
  it('cancels new saves and renames without changing storage, and validates rename names', () => {
    setup(); createView('A'); createView('B');
    const before = localStorage.getItem(key);
    startCreate(); nameView('Discard'); click('cancel');
    manage('A'); click('saved_views_rename'); nameView('B'); click('saved_views_rename_submit');
    expect(screen.getByRole('alert').textContent).toBe('saved_views_duplicate');
    click('cancel');
    expect(localStorage.getItem(key)).toBe(before);
  });
  it('keeps failed rename and deletion open without reporting success', () => {
    setup(); createView('A'); manage('A'); click('saved_views_rename'); nameView('B');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    click('saved_views_rename_submit');
    expect(screen.queryByText('saved_views_saved')).toBeNull();
    expect(read().views[0].name).toBe('A');
    click('cancel'); click('Actions for A'); click('delete'); click('saved_views_confirm_delete');
    expect(screen.getByRole('alert').textContent).toBe('saved_views_write_failed');
    expect(screen.getByRole('button', { name: 'saved_views_confirm_delete' })).toBeTruthy();
    expect(read().views).toHaveLength(1);
  });

  it('saves, applies, detects edits, explicitly overwrites, renames and confirms deletion without resetting conditions', () => {
    const view = setup();
    expect(screen.getByText('saved_views_empty')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    createView(' A ');
    const id = read().views[0].id;
    expect(read().views[0]).toMatchObject({ name: 'A', settings: current });
    click('A');
    expect(screen.getByRole('dialog', { name: 'saved_views' })).toBeTruthy();
    expect(view.onApply).toHaveBeenCalledExactlyOnceWith(current);
    const edited = { ...current, laneType: 'priority' as const };
    view.rerender(<SavedViewsPopover {...view.props} current={edited} />);
    expect(screen.getByRole('button', { name: /saved_views: A \(saved_views_changed\)/ })).toBeTruthy();
    expect(read().views[0].settings.laneType).toBe('none');
    expect(screen.getByRole('button', { name: /A.*saved_views_changed/, pressed: true })).toBeTruthy();
    click('saved_views_overwrite');
    expect(read().views[0].settings.laneType).toBe('priority');
    expect(screen.queryAllByText('saved_views_changed')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'saved_views_overwrite' })).toBeNull();
    manage('A'); click('saved_views_rename');
    nameView('Renamed'); click('saved_views_rename_submit');
    expect(read().views[0]).toMatchObject({ id, name: 'Renamed' });
    click('Actions for Renamed'); click('delete'); click('cancel');
    expect(read().views).toHaveLength(1);
    click('Actions for Renamed'); click('delete'); click('saved_views_confirm_delete');
    expect(read().views).toEqual([]);
    expect(view.onApply).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'saved_views' })).toBeTruthy();
  });
  it('rejects duplicate new saves and the 21st view', () => {
    setup();
    createView('A'); startCreate(); nameView('A'); click('save');
    expect(screen.getByRole('alert').textContent).toBe('saved_views_duplicate');
    expect(read().views).toHaveLength(1);
    localStorage.setItem(key, JSON.stringify({ version: 1, views: Array.from({ length: 20 }, (_, i) => ({ id: String(i), name: String(i), settings: current })) }));
    nameView('21'); click('save');
    expect(screen.getByRole('alert').textContent).toBe('saved_views_limit');
  });
  it('does not claim success on a storage write failure', () => {
    setup(); startCreate(); nameView('A');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    click('save');
    expect(screen.getByRole('alert').textContent).toBe('saved_views_write_failed');
    expect(screen.getByRole('textbox')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'saved_views' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByText('saved_views_saved')).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });
  it('does not apply a view when its active ID cannot be saved', () => {
    localStorage.setItem(key, JSON.stringify({ version: 1, views: [{ id: 'a', name: 'A', settings: current }] }));
    const view = setup();
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, storageKey, value) {
      if (storageKey === activeSavedViewKey(key)) throw new Error('quota');
      return setItem.call(this, storageKey, value);
    });
    click('A');
    expect(view.onApply).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'A', pressed: false })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('saved_views_write_failed');
  });
  it('reports an active ID failure after creating the view without claiming it was selected', () => {
    setup();
    const setItem = Storage.prototype.setItem;
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, storageKey, value) {
      if (storageKey === activeSavedViewKey(key)) throw new Error('quota');
      return setItem.call(this, storageKey, value);
    });
    createView('A');
    expect(read().views).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'A', pressed: false })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('saved_views_write_failed');
    expect(screen.queryByText('saved_views_saved')).toBeNull();
    write.mockRestore();
    click('A');
    expect(screen.getByRole('button', { name: 'A', pressed: true })).toBeTruthy();
  });
  it('keeps the active view and menu open when clearing its ID fails', () => {
    setup(); createView('A');
    const removeItem = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, storageKey) {
      if (storageKey === activeSavedViewKey(key)) throw new Error('denied');
      return removeItem.call(this, storageKey);
    });
    click('saved_views_clear');
    expect(screen.getByRole('dialog', { name: 'saved_views' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'A', pressed: true })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('saved_views_write_failed');
    expect(localStorage.getItem(activeSavedViewKey(key))).toBe(read().views[0].id);
  });
  it('overwrites only settings after another tab renames the selected view and reuses its old name', () => {
    const view = setup();
    createView('A');
    const original = read().views[0];
    localStorage.setItem(key, JSON.stringify({ version: 1, views: [
      { ...original, name: 'B' },
      { ...original, id: 'another', name: 'A' },
    ] }));
    view.rerender(<SavedViewsPopover {...view.props} current={{ ...current, laneType: 'priority' }} />);
    click('saved_views_overwrite');
    expect(read().views.map((saved: { name: string }) => saved.name)).toEqual(['B', 'A']);
    expect(read().views[0].settings.laneType).toBe('priority');
    expect(parseSavedViews(localStorage.getItem(key)).views).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'B', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'saved_views: B' })).toBeTruthy();
  });
  it('creates unique IDs without randomUUID and can reload and apply the saved view', () => {
    vi.stubGlobal('crypto', {});
    vi.spyOn(Date, 'now').mockReturnValue(123);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const view = setup();
    createView('A');
    createView('B');
    const saved = parseSavedViews(localStorage.getItem(key));
    expect(saved.views.map((item) => item.id)).toEqual([expect.stringMatching(/^view_123_/), expect.stringMatching(/^view_123_.*_1$/)]);
    expect(localStorage.getItem(activeSavedViewKey(key))).toBe(saved.views[1].id);
    view.unmount();
    const reloaded = setup();
    expect(screen.getByRole('button', { name: 'saved_views: B' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'B', pressed: true })).toBeTruthy();
    expect(reloaded.onApply).not.toHaveBeenCalled();
    click('B');
    expect(reloaded.onApply).toHaveBeenCalledExactlyOnceWith(current);
  });
  it('keeps the last edited conditions and marks a restored view as modified', () => {
    const view = setup();
    createView('A');
    view.unmount();
    const edited = { ...current, laneType: 'priority' as const };
    const onApply = vi.fn();
    render(<SavedViewsPopover storageKey={key} current={edited} onApply={onApply} labels={labels} validation={{ pending: false, unavailable: [] }} />);
    expect(screen.getByRole('button', { name: 'saved_views: A (saved_views_changed)' })).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    expect(read().views[0].settings.laneType).toBe('none');
  });
  it('ignores an active ID with no matching saved view', () => {
    localStorage.setItem(key, JSON.stringify({ version: 1, views: [{ id: 'a', name: 'A', settings: current }] }));
    localStorage.setItem(activeSavedViewKey(key), 'deleted');
    setup();
    expect(screen.getByRole('button', { name: 'saved_views' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'A', pressed: false })).toBeTruthy();
  });
  it('clears the persisted selection after deleting the active view', () => {
    const view = setup();
    createView('A');
    expect(localStorage.getItem(activeSavedViewKey(key))).toBe(read().views[0].id);
    manage('A'); click('delete'); click('saved_views_confirm_delete');
    expect(localStorage.getItem(activeSavedViewKey(key))).toBeNull();
    view.unmount();
    setup();
    expect(screen.getByRole('button', { name: 'saved_views' })).toBeTruthy();
  });
  it('refuses to write a document that would fail validation on the next read', () => {
    const view = setup();
    createView('A');
    const before = localStorage.getItem(key);
    view.rerender(<SavedViewsPopover {...view.props} current={{ ...current, hiddenStatusIds: [0] }} />);
    click('saved_views_overwrite');
    expect(screen.getByRole('alert').textContent).toBe('saved_views_unreadable');
    expect(localStorage.getItem(key)).toBe(before);
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
