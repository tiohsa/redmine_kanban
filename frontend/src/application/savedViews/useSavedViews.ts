import { useEffect, useState } from 'react';
import { copyViewSettings, createSavedView, updateSavedView, viewSettingsEqual, type SavedView, type SavedViewSettings } from '../../model/view/savedViews';
import { activeSavedViewKey, clearActiveSavedViewIdIfMatches, newSavedViewCandidateId, readActiveSavedViewId, readSavedViews, writeActiveSavedViewId, writeSavedViews } from '../../infrastructure/storage/savedViewsRepository';

type PendingActiveWrite = { kind: 'select'; view: SavedView } | { kind: 'clear'; expectedId: string };

export function useSavedViews(storageKey: string, current: SavedViewSettings, onApply: (settings: SavedViewSettings) => void) {
  const [stored, setStored] = useState(() => readSavedViews(storageKey));
  const [selectedId, setSelectedId] = useState('');
  const [activeId, setActiveId] = useState(() => readActiveSavedViewId(storageKey, stored.views));
  const [activeBaseline, setActiveBaseline] = useState<SavedView | null>(() => stored.views.find((view) => view.id === readActiveSavedViewId(storageKey, stored.views)) ?? null);
  const [selectedBaseline, setSelectedBaseline] = useState<SavedView | null>(null);
  const [pendingActiveWrite, setPendingActiveWrite] = useState<PendingActiveWrite | null>(null);
  const [status, setStatus] = useState<'complete' | 'partial' | 'failed' | null>(null);
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
      if (activeId && !latest.views.some((view) => view.id === activeId)) {
        setActiveId('');
        setActiveBaseline(null);
      }
      setSaved(false);
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [storageKey, activeId]);

  const persistActive = (id: string): boolean => {
    try {
      writeActiveSavedViewId(storageKey, id);
      return true;
    } catch {
      setError('saved_views_write_failed');
      return false;
    }
  };

  const clearPersistedActive = (expectedId: string): boolean => {
    try {
      clearActiveSavedViewIdIfMatches(storageKey, expectedId);
      return true;
    } catch {
      setError('saved_views_write_failed');
      return false;
    }
  };

  const run = <T,>(update: (views: SavedView[]) => { views: SavedView[]; result: T }, after: (result: T) => boolean): boolean => {
    setSaved(false);
    setError(null);
    setStatus(null);
    try {
      const next = writeSavedViews(storageKey, update);
      setStored({ views: next.views, error: null });
      const complete = after(next.result);
      setSaved(complete);
      setStatus(complete ? 'complete' : 'partial');
      return true;
    } catch (caught) {
      const latest = readSavedViews(storageKey);
      setStored(latest);
      if (activeId && !latest.views.some((view) => view.id === activeId)) {
        setActiveId('');
        setActiveBaseline(null);
      }
      const code = caught instanceof Error && caught.message.startsWith('saved_views_') ? caught.message : 'saved_views_write_failed';
      setError(code);
      setStatus('failed');
      return false;
    }
  };

  return {
    stored, selectedId, activeId, name, selected, active, changed, error, saved, status, pendingActiveWrite,
    select(id: string) {
      setSelectedId(id);
      const target = stored.views.find((view) => view.id === id) ?? null;
      setSelectedBaseline(target);
      setName(target?.name ?? '');
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
      setActiveBaseline(view);
      setSelectedId(view.id);
      setSelectedBaseline(view);
      setName(view.name);
      setPendingActiveWrite(null);
      return true;
    },
    clearActiveView(): boolean {
      setSaved(false);
      setError(null);
      if (!clearPersistedActive(activeId)) return false;
      setActiveId('');
      setActiveBaseline(null);
      setPendingActiveWrite(null);
      return true;
    },
    create() {
      return run((views) => {
        const next = createSavedView(views, name, current, newSavedViewCandidateId);
        return { views: next.views, result: next.view };
      }, (view) => {
        const activeSaved = persistActive(view.id);
        if (activeSaved) {
          setActiveId(view.id);
          setActiveBaseline(view);
          setPendingActiveWrite(null);
        } else setPendingActiveWrite({ kind: 'select', view });
        setSelectedId(view.id);
        setSelectedBaseline(view);
        setName(view.name);
        return activeSaved;
      });
    },
    update(operation: 'rename' | 'overwrite') {
      const target = operation === 'overwrite' ? activeBaseline : selectedBaseline;
      if (!target) return false;
      return run((views) => {
        const latest = views.find((view) => view.id === target.id);
        if (!latest || JSON.stringify(latest) !== JSON.stringify(target)) throw new Error('saved_views_conflict');
        const next = updateSavedView(views, target.id, operation, name, current);
        return { views: next.views, result: next.views.find((view) => view.id === target.id)! };
      }, (updated) => {
        if (activeId === target.id) setActiveBaseline(updated);
        if (selectedId === target.id) { setSelectedBaseline(updated); setName(updated.name); }
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
          setActiveBaseline(null);
          activeSaved = clearPersistedActive(id);
          setPendingActiveWrite(activeSaved ? null : { kind: 'clear', expectedId: id });
        }
        setSelectedId('');
        setSelectedBaseline(null);
        setName('');
        return activeSaved;
      });
    },
    retryActive(): boolean {
      if (pendingActiveWrite?.kind === 'clear') {
        if (!clearPersistedActive(pendingActiveWrite.expectedId)) return false;
        setPendingActiveWrite(null);
        setError(null);
        setSaved(true);
        setStatus('complete');
        return true;
      }
      if (pendingActiveWrite?.kind !== 'select') return false;
      const latest = readSavedViews(storageKey);
      const target = latest.views.find((view) => view.id === pendingActiveWrite.view.id);
      if (latest.error || !target || JSON.stringify(target) !== JSON.stringify(pendingActiveWrite.view)) {
        setError('saved_views_conflict');
        return false;
      }
      if (!persistActive(target.id)) return false;
      setActiveId(target.id);
      setActiveBaseline(target);
      setPendingActiveWrite(null);
      setError(null);
      setSaved(true);
      setStatus('complete');
      return true;
    },
    reloadConflict(operation: 'rename' | 'overwrite'): 'reloaded' | 'missing' | 'unreadable' {
      const latest = readSavedViews(storageKey);
      setStored(latest);
      if (latest.error) {
        setError(latest.error);
        return 'unreadable';
      }
      const selectedLatest = latest.views.find((view) => view.id === selectedId) ?? null;
      setSelectedBaseline(selectedLatest);
      if (selectedLatest) setName(selectedLatest.name);
      else { setSelectedId(''); setName(''); }
      const activeLatest = latest.views.find((view) => view.id === activeId) ?? null;
      setActiveBaseline(activeLatest);
      if (!activeLatest && activeId) setActiveId('');
      const pendingLatest = pendingActiveWrite?.kind === 'select' ? latest.views.find((view) => view.id === pendingActiveWrite.view.id) ?? null : null;
      const target = operation === 'rename' ? selectedLatest : pendingLatest ?? activeLatest;
      if (operation === 'overwrite' && target) {
        onApply(copyViewSettings(target.settings));
        if (pendingLatest) {
          setActiveId('');
          setActiveBaseline(null);
          setPendingActiveWrite({ kind: 'select', view: pendingLatest });
        }
      }
      setError(null);
      return target ? 'reloaded' : 'missing';
    },
    continueEditing(): void {
      const latest = readSavedViews(storageKey);
      setStored(latest);
      if (latest.error) { setError(latest.error); return; }
      setSelectedBaseline(latest.views.find((view) => view.id === selectedId) ?? null);
      setActiveBaseline(latest.views.find((view) => view.id === activeId) ?? null);
      if (pendingActiveWrite?.kind === 'select') {
        const pendingLatest = latest.views.find((view) => view.id === pendingActiveWrite.view.id);
        if (pendingLatest) setPendingActiveWrite({ kind: 'select', view: pendingLatest });
      }
      setError(null);
    },
    clearFeedback() { setSaved(false); setError(null); },
  };
}
