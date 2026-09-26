import { useEffect, useState } from 'react';
import { copyViewSettings, createSavedView, updateSavedView, viewSettingsEqual, type SavedView, type SavedViewSettings } from '../../model/view/savedViews';
import { activeSavedViewKey, newSavedViewCandidateId, readActiveSavedViewId, readSavedViews, writeActiveSavedViewId, writeSavedViews } from '../../infrastructure/storage/savedViewsRepository';

export function useSavedViews(storageKey: string, current: SavedViewSettings, onApply: (settings: SavedViewSettings) => void) {
  const [stored, setStored] = useState(() => readSavedViews(storageKey));
  const [selectedId, setSelectedId] = useState('');
  const [activeId, setActiveId] = useState(() => readActiveSavedViewId(storageKey, stored.views));
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const selected = stored.views.find((view) => view.id === selectedId);
  const active = stored.views.find((view) => view.id === activeId);
  const changed = Boolean(active && !viewSettingsEqual(current, active.settings));
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || (event.key !== storageKey && event.key !== activeSavedViewKey(storageKey) && event.key !== null)) return;
      const latest = readSavedViews(storageKey);
      setStored(latest);
      setActiveId(readActiveSavedViewId(storageKey, latest.views));
      if (selectedId && !latest.views.some((view) => view.id === selectedId)) {
        setSelectedId('');
        setName('');
      }
      setSaved(false);
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [storageKey, selectedId]);

  const persistActive = (id: string): boolean => {
    try {
      writeActiveSavedViewId(storageKey, id);
      return true;
    } catch {
      setError('saved_views_write_failed');
      return false;
    }
  };

  const run = <T,>(update: (views: SavedView[]) => { views: SavedView[]; result: T }, after: (result: T) => boolean): boolean => {
    setSaved(false);
    setError(null);
    try {
      const next = writeSavedViews(storageKey, update);
      setStored({ views: next.views, error: null });
      const complete = after(next.result);
      setSaved(complete);
      return true;
    } catch (caught) {
      const latest = readSavedViews(storageKey);
      setStored(latest);
      setActiveId(readActiveSavedViewId(storageKey, latest.views));
      if (selectedId && !latest.views.some((view) => view.id === selectedId)) {
        setSelectedId('');
        setName('');
      }
      const code = caught instanceof Error && caught.message.startsWith('saved_views_') ? caught.message : 'saved_views_write_failed';
      setError(code);
      return false;
    }
  };

  return {
    stored, selectedId, activeId, name, selected, active, changed, error, saved,
    select(id: string) {
      setSelectedId(id);
      setName(stored.views.find((view) => view.id === id)?.name ?? '');
      setSaved(false);
      setError(null);
    },
    editName(value: string) { setName(value); setSaved(false); setError(null); },
    applyView(id: string): boolean {
      const latest = readSavedViews(storageKey);
      setStored(latest);
      const view = latest.views.find((item) => item.id === id);
      if (!view || latest.error) {
        setError(latest.error ?? 'saved_views_unreadable');
        return false;
      }
      setSaved(false);
      setError(null);
      if (!persistActive(view.id)) return false;
      onApply(copyViewSettings(view.settings));
      setActiveId(view.id);
      setSelectedId(view.id);
      setName(view.name);
      return true;
    },
    clearActiveView(): boolean {
      setSaved(false);
      setError(null);
      if (!persistActive('')) return false;
      setActiveId('');
      return true;
    },
    create() {
      return run((views) => {
        const next = createSavedView(views, name, current, newSavedViewCandidateId);
        return { views: next.views, result: next.view };
      }, (view) => {
        const activeSaved = persistActive(view.id);
        if (activeSaved) setActiveId(view.id);
        setSelectedId(view.id);
        setName(view.name);
        return activeSaved;
      });
    },
    update(operation: 'rename' | 'overwrite') {
      const target = operation === 'overwrite' ? active : selected;
      if (!target) return false;
      return run((views) => {
        const next = updateSavedView(views, target.id, operation, name, current);
        return { views: next.views, result: next.name };
      }, (latestName) => {
        if (selectedId === target.id) setName(latestName);
        return true;
      });
    },
    remove(id: string): boolean {
      return run((views) => {
        if (!views.some((view) => view.id === id)) throw new Error('saved_views_unreadable');
        return { views: views.filter((view) => view.id !== id), result: id };
      }, () => {
        let activeSaved = true;
        if (activeId === id) {
          setActiveId('');
          activeSaved = persistActive('');
        }
        setSelectedId('');
        setName('');
        return activeSaved;
      });
    },
    clearFeedback() { setSaved(false); setError(null); },
  };
}
