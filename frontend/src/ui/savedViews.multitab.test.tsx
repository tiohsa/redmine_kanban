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

  it('clears a remotely deleted active view and refuses to overwrite it', () => {
    publish([view], 'a');
    const { result } = renderHook(() => useSavedViews(key, settings, vi.fn()));
    act(() => result.current.select('a'));
    act(() => publish([]));
    expect(result.current.activeId).toBe('');
    expect(result.current.selectedId).toBe('');
    expect(result.current.update('rename')).toBe(false);
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