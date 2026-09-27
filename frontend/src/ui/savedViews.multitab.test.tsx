// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSavedViews } from '../application/savedViews/useSavedViews';
import { activeSavedViewKey } from '../infrastructure/storage/savedViewsRepository';
import type { SavedViewSettings } from '../model/view/savedViews';

const key = 'rk_saved_views:multitab-test';
const settings: SavedViewSettings = {
  filters: { assigneeIds: [], q: '', due: 'all', priority: [], priorityFilterEnabled: false, projectIds: [1], statusIds: [], trackerIds: [] },
  sortConfig: [{ field: 'updated', direction: 'desc' }],
  laneType: 'none', hiddenStatusIds: [], viewableProjectsEnabled: false,
};
const view = { id: 'a', name: 'A', settings };

function publish(views: typeof view[], activeId: string | null = null) {
  const raw = JSON.stringify({ version: 1, views });
  localStorage.setItem(key, raw);
  if (activeId !== null) localStorage.setItem(activeSavedViewKey(key), activeId);
  window.dispatchEvent(new StorageEvent('storage', { key, newValue: raw, storageArea: localStorage }));
}

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('saved views across tabs', () => {
  it('refreshes remote views without applying them over unsaved filters', () => {
    publish([view], 'a');
    const current = { ...settings, filters: { ...settings.filters, q: 'unsaved' } };
    const onApply = vi.fn();
    const { result } = renderHook(() => useSavedViews(key, current, onApply));
    expect(result.current.changed).toBe(true);

    act(() => publish([{ ...view, name: 'Renamed' }, { ...view, id: 'b', name: 'B' }]));
    expect(result.current.stored.views.map((item) => item.name)).toEqual(['Renamed', 'B']);
    expect(result.current.changed).toBe(true);
    expect(onApply).not.toHaveBeenCalled();
    expect(current.filters.q).toBe('unsaved');
  });

  it('does not attach local unsaved conditions to a view selected in another tab', () => {
    const other = { ...view, id: 'b', name: 'B' };
    publish([view, other], 'a');
    const current = { ...settings, filters: { ...settings.filters, q: 'unsaved' } };
    const { result } = renderHook(() => useSavedViews(key, current, vi.fn()));
    act(() => publish([view, other], 'b'));
    expect(result.current.activeId).toBe('a');
    act(() => expect(result.current.update('overwrite')).toBe(true));
    expect(JSON.parse(localStorage.getItem(key)!).views.find((item: typeof view) => item.id === 'b').settings.filters.q).toBe('');
  });

  it('preserves an edited name and reports a concurrent rename', () => {
    publish([view], 'a');
    const { result } = renderHook(() => useSavedViews(key, settings, vi.fn()));
    act(() => { result.current.select('a'); result.current.editName('Local'); });
    act(() => publish([{ ...view, name: 'Remote' }]));
    act(() => expect(result.current.update('rename')).toBe(false));
    expect(result.current.name).toBe('Local');
    expect(result.current.error).toBe('saved_views_conflict');
    expect(JSON.parse(localStorage.getItem(key)!).views[0].name).toBe('Remote');
  });

  it('clears a remotely deleted active view and refuses to overwrite it', () => {
    publish([view], 'a');
    const { result } = renderHook(() => useSavedViews(key, settings, vi.fn()));
    act(() => result.current.select('a'));
    act(() => publish([]));
    expect(result.current.activeId).toBe('');
    expect(result.current.selectedId).toBe('a');
    act(() => expect(result.current.update('rename')).toBe(false));
    expect(result.current.error).toBe('saved_views_conflict');
    expect(result.current.name).toBe('A');
    expect(JSON.parse(localStorage.getItem(key)!).views).toEqual([]);
  });

  it('rechecks storage before an apply even if its event has not arrived', () => {
    publish([view]);
    const onApply = vi.fn();
    const { result } = renderHook(() => useSavedViews(key, settings, onApply));
    localStorage.setItem(key, JSON.stringify({ version: 1, views: [] }));
    act(() => expect(result.current.applyView('a')).toBe(false));
    expect(onApply).not.toHaveBeenCalled();
    expect(result.current.error).toBe('saved_views_unreadable');
  });

  it('reports partial storage writes as incomplete', () => {
    const { result } = renderHook(() => useSavedViews(key, settings, vi.fn()));
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, storageKey, value) {
      if (storageKey === activeSavedViewKey(key)) throw new Error('quota');
      return originalSetItem.call(this, storageKey, value);
    });
    act(() => result.current.editName('New'));
    act(() => expect(result.current.create()).toBe(true));
    expect(result.current.saved).toBe(false);
    expect(result.current.error).toBe('saved_views_write_failed');
    expect(result.current.stored.views).toHaveLength(1);
    expect(result.current.status).toBe('partial');
    expect(result.current.pendingActiveWrite).toEqual({ kind: 'select', view: result.current.stored.views[0] });
    vi.restoreAllMocks();
    act(() => expect(result.current.retryActive()).toBe(true));
    expect(result.current.status).toBe('complete');
    expect(result.current.activeId).toBe(result.current.stored.views[0]?.id);
    expect(JSON.parse(localStorage.getItem(key)!).views).toHaveLength(1);
  });

  it('preserves another tab’s selection when clearing or deleting the local active view', () => {
    const other = { ...view, id: 'b', name: 'B' };
    publish([view, other], 'a');
    const { result } = renderHook(() => useSavedViews(key, settings, vi.fn()));
    act(() => publish([view, other], 'b'));
    act(() => expect(result.current.clearActiveView()).toBe(true));
    expect(localStorage.getItem(activeSavedViewKey(key))).toBe('b');
    act(() => expect(result.current.applyView('a')).toBe(true));
    act(() => publish([view, other], 'b'));
    act(() => expect(result.current.remove('a')).toBe(true));
    expect(localStorage.getItem(activeSavedViewKey(key))).toBe('b');
    expect(JSON.parse(localStorage.getItem(key)!).views).toEqual([other]);
    expect(result.current.status).toBe('complete');
  });

  it('retries only active ID cleanup after a successful deletion', () => {
    publish([view], 'a');
    const { result } = renderHook(() => useSavedViews(key, settings, vi.fn()));
    const originalRemove = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, storageKey) {
      if (storageKey === activeSavedViewKey(key)) throw new Error('denied');
      return originalRemove.call(this, storageKey);
    });
    act(() => expect(result.current.remove('a')).toBe(true));
    expect(result.current.status).toBe('partial');
    expect(result.current.pendingActiveWrite).toEqual({ kind: 'clear', expectedId: 'a' });
    expect(JSON.parse(localStorage.getItem(key)!).views).toEqual([]);
    vi.restoreAllMocks();
    const body = localStorage.getItem(key);
    act(() => expect(result.current.retryActive()).toBe(true));
    expect(localStorage.getItem(activeSavedViewKey(key))).toBeNull();
    expect(localStorage.getItem(key)).toBe(body);
    expect(result.current.status).toBe('complete');
  });

  it('preserves a newer selection during deletion cleanup retry', () => {
    const other = { ...view, id: 'b', name: 'B' };
    publish([view, other], 'a');
    const { result } = renderHook(() => useSavedViews(key, settings, vi.fn()));
    const originalRemove = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, storageKey) {
      if (storageKey === activeSavedViewKey(key)) throw new Error('denied');
      return originalRemove.call(this, storageKey);
    });
    act(() => expect(result.current.remove('a')).toBe(true));
    vi.restoreAllMocks();
    localStorage.setItem(activeSavedViewKey(key), 'b');
    act(() => expect(result.current.retryActive()).toBe(true));
    expect(localStorage.getItem(activeSavedViewKey(key))).toBe('b');
  });

  it('applies the latest saved settings on overwrite conflict reload', () => {
    publish([view], 'a');
    const local = { ...settings, filters: { ...settings.filters, q: 'unsaved' } };
    const remote = { ...view, settings: { ...settings, filters: { ...settings.filters, q: 'remote' } } };
    const onApply = vi.fn();
    const { result } = renderHook(() => useSavedViews(key, local, onApply));
    act(() => publish([remote]));
    act(() => expect(result.current.update('overwrite')).toBe(false));
    act(() => expect(result.current.reloadConflict('overwrite')).toBe('reloaded'));
    expect(onApply).toHaveBeenCalledExactlyOnceWith(remote.settings);
    expect(result.current.error).toBeNull();
  });

  it('keeps local settings when continuing after an overwrite conflict', () => {
    publish([view], 'a');
    const local = { ...settings, filters: { ...settings.filters, q: 'unsaved' } };
    const remote = { ...view, name: 'Remote' };
    const onApply = vi.fn();
    const { result } = renderHook(() => useSavedViews(key, local, onApply));
    act(() => publish([remote]));
    act(() => expect(result.current.update('overwrite')).toBe(false));
    act(() => result.current.continueEditing());
    expect(onApply).not.toHaveBeenCalled();
    act(() => expect(result.current.update('overwrite')).toBe(true));
    expect(JSON.parse(localStorage.getItem(key)!).views[0].settings.filters.q).toBe('unsaved');
  });

  it('reports a deleted rename target as missing on reload', () => {
    publish([view]);
    const { result } = renderHook(() => useSavedViews(key, settings, vi.fn()));
    act(() => result.current.select('a'));
    act(() => result.current.editName('Local'));
    act(() => publish([]));
    act(() => expect(result.current.update('rename')).toBe(false));
    act(() => expect(result.current.reloadConflict('rename')).toBe('missing'));
    expect(result.current.selectedId).toBe('');
    expect(result.current.name).toBe('');
  });

  it('reloads the pending created view rather than the previously active view', () => {
    publish([view], 'a');
    const onApply = vi.fn();
    const { result } = renderHook(() => useSavedViews(key, settings, onApply));
    const originalSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, storageKey, value) {
      if (storageKey === activeSavedViewKey(key)) throw new Error('denied');
      return originalSet.call(this, storageKey, value);
    });
    act(() => result.current.editName('B'));
    act(() => expect(result.current.create()).toBe(true));
    const created = result.current.stored.views[1];
    vi.restoreAllMocks();
    const remote = { ...created, settings: { ...settings, filters: { ...settings.filters, q: 'remote' } } };
    act(() => publish([view, remote]));
    act(() => expect(result.current.retryActive()).toBe(false));
    act(() => expect(result.current.reloadConflict('overwrite')).toBe('reloaded'));
    expect(onApply).toHaveBeenCalledExactlyOnceWith(remote.settings);
    expect(result.current.activeId).toBe('');
    expect(localStorage.getItem(activeSavedViewKey(key))).toBe('a');
    act(() => expect(result.current.retryActive()).toBe(true));
    expect(localStorage.getItem(activeSavedViewKey(key))).toBe(created.id);
  });

  it('removes its storage listener on unmount', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useSavedViews(key, settings, vi.fn()));
    const handler = add.mock.calls.find(([type]) => type === 'storage')?.[1];
    expect(handler).toBeDefined();
    unmount();
    expect(remove).toHaveBeenCalledWith('storage', handler);
  });
});
