import { useState } from 'react';
import { copyViewSettings, createSavedView, updateSavedView, viewSettingsEqual, type SavedView, type SavedViewSettings } from '../../model/view/savedViews';
import { newSavedViewCandidateId, readSavedViews, writeSavedViews } from '../../infrastructure/storage/savedViewsRepository';

export function useSavedViews(storageKey: string, current: SavedViewSettings, onApply: (settings: SavedViewSettings) => void) {
  const [stored, setStored] = useState(() => readSavedViews(storageKey));
  const [selectedId, setSelectedId] = useState('');
  const [activeId, setActiveId] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const selected = stored.views.find((view) => view.id === selectedId);
  const active = stored.views.find((view) => view.id === activeId);
  const changed = Boolean(active && !viewSettingsEqual(current, active.settings));

  const run = <T,>(update: (views: SavedView[]) => { views: SavedView[]; result: T }, after: (result: T) => void): boolean => {
    setSaved(false);
    setError(null);
    try {
      const next = writeSavedViews(storageKey, update);
      setStored({ views: next.views, error: null });
      setSaved(true);
      after(next.result);
      return true;
    } catch (caught) {
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
      const view = stored.views.find((item) => item.id === id);
      if (!view) return false;
      onApply(copyViewSettings(view.settings));
      setActiveId(view.id);
      setSelectedId(view.id);
      setName(view.name);
      setSaved(false);
      setError(null);
      return true;
    },
    clearActiveView() {
      setActiveId('');
      setSaved(false);
      setError(null);
    },
    create() {
      return run((views) => {
        const next = createSavedView(views, name, current, newSavedViewCandidateId);
        return { views: next.views, result: next.view };
      }, (view) => {
        setActiveId(view.id);
        setSelectedId(view.id);
        setName(view.name);
      });
    },
    update(operation: 'rename' | 'overwrite') {
      const target = operation === 'overwrite' ? active : selected;
      if (!target) return false;
      return run((views) => {
        const next = updateSavedView(views, target.id, operation, name, current);
        return { views: next.views, result: next.name };
      }, (latestName) => { if (selectedId === target.id) setName(latestName); });
    },
    remove(id: string): boolean {
      return run((views) => ({ views: views.filter((view) => view.id !== id), result: id }), () => {
        if (activeId === id) setActiveId('');
        setSelectedId('');
        setName('');
      });
    },
    clearFeedback() { setSaved(false); setError(null); },
  };
}
