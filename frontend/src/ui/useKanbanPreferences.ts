import { useEffect, useMemo, useState } from 'react';
import type { SortKey } from './board/sort';
import type { Filters } from './boardFilters';
import { buildProjectScopeFromDataUrl, makeScopedStorageKey, readScopedBooleanWithLegacy, readScopedNumberSetWithLegacy } from './utils/storage';
import type { FitMode } from './kanbanShared';

const DEFAULT_FILTERS: Filters = {
  assigneeIds: [],
  q: '',
  due: 'all',
  priority: [],
  priorityFilterEnabled: false,
  projectIds: [],
  statusIds: [],
};

function readStorageValue(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageValue(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function readFilters(storageKey: string): Filters {
  try {
    const value = readStorageValue(storageKey);
    if (value) {
      const parsed = JSON.parse(value);
      return {
        assigneeIds: Array.isArray(parsed.assigneeIds) ? parsed.assigneeIds.map(String) : [],
        q: parsed.q || '',
        due: parsed.due || 'all',
        dueDays: parsed.dueDays || 7,
        priority: Array.isArray(parsed.priority) ? parsed.priority : [],
        priorityFilterEnabled:
          typeof parsed.priorityFilterEnabled === 'boolean'
            ? parsed.priorityFilterEnabled
            : Array.isArray(parsed.priority) && parsed.priority.length > 0,
        projectIds: Array.isArray(parsed.projectIds) ? parsed.projectIds.map(Number) : [],
        statusIds: Array.isArray(parsed.statusIds) ? parsed.statusIds.map(Number) : [],
      };
    }
  } catch {
    // ignore
  }
  return DEFAULT_FILTERS;
}

export function useKanbanPreferences(dataUrl: string) {
  const projectScope = useMemo(() => buildProjectScopeFromDataUrl(dataUrl), [dataUrl]);
  const filtersStorageKey = useMemo(() => makeScopedStorageKey('rk_filters', projectScope), [projectScope]);
  const hiddenStatusStorageKey = useMemo(() => makeScopedStorageKey('rk_hidden_status_ids', projectScope), [projectScope]);
  const priorityLaneStorageKey = useMemo(() => makeScopedStorageKey('rk_priority_lane_enabled', projectScope), [projectScope]);
  const viewableProjectsStorageKey = useMemo(() => makeScopedStorageKey('rk_viewable_projects_enabled', projectScope), [projectScope]);

  const [filters, setFilters] = useState<Filters>(() => readFilters(filtersStorageKey));
  const [fullWindow, setFullWindow] = useState(() => {
    return readStorageValue('rk_fullwindow') === '1';
  });
  const [fitMode, setFitMode] = useState<FitMode>(() => {
    const value = readStorageValue('rk_fit_mode');
    if (value === 'none' || value === 'width') return value;
    if (readStorageValue('rk_fit_to_screen') === '1') return 'width';
    return 'none';
  });
  const [showSubtasks, setShowSubtasks] = useState(() => {
    return readStorageValue('rk_show_subtasks') !== '0';
  });
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const value = readStorageValue('rk_sortkey');
    if (
      value === 'updated_desc' ||
      value === 'updated_asc' ||
      value === 'due_asc' ||
      value === 'due_desc' ||
      value === 'priority_desc' ||
      value === 'priority_asc'
    ) {
      return value;
    }
    return 'updated_desc';
  });
  const [hiddenStatusIds, setHiddenStatusIds] = useState<Set<number>>(() =>
    readScopedNumberSetWithLegacy(hiddenStatusStorageKey, 'rk_hidden_status_ids', new Set()),
  );
  const [fontSize, setFontSize] = useState<number>(() => {
    const value = readStorageValue('rk_font_size');
    if (value) return parseInt(value, 10);
    return 13;
  });
  const [timeEntryOnClose, setTimeEntryOnClose] = useState(() => {
    return readStorageValue('rk_time_entry_on_close') === '1';
  });
  const [priorityLaneEnabled, setPriorityLaneEnabled] = useState(() =>
    readScopedBooleanWithLegacy(priorityLaneStorageKey, 'rk_priority_lane_enabled', false),
  );
  const [viewableProjectsEnabled, setViewableProjectsEnabled] = useState(() =>
    readScopedBooleanWithLegacy(viewableProjectsStorageKey, 'rk_viewable_projects_enabled', false),
  );

  useEffect(() => {
    const className = 'rk-kanban-fullwindow';
    if (fullWindow) {
      document.body.classList.add(className);
    } else {
      document.body.classList.remove(className);
    }

    writeStorageValue('rk_fullwindow', fullWindow ? '1' : '0');

    return () => {
      document.body.classList.remove(className);
    };
  }, [fullWindow]);

  useEffect(() => {
    writeStorageValue('rk_fit_mode', fitMode);
  }, [fitMode]);

  useEffect(() => {
    writeStorageValue('rk_sortkey', sortKey);
  }, [sortKey]);

  useEffect(() => {
    writeStorageValue(filtersStorageKey, JSON.stringify(filters));
  }, [filters, filtersStorageKey]);

  useEffect(() => {
    writeStorageValue(hiddenStatusStorageKey, JSON.stringify(Array.from(hiddenStatusIds)));
  }, [hiddenStatusIds, hiddenStatusStorageKey]);

  useEffect(() => {
    writeStorageValue('rk_show_subtasks', showSubtasks ? '1' : '0');
  }, [showSubtasks]);

  useEffect(() => {
    writeStorageValue('rk_font_size', String(fontSize));
  }, [fontSize]);

  useEffect(() => {
    writeStorageValue('rk_time_entry_on_close', timeEntryOnClose ? '1' : '0');
  }, [timeEntryOnClose]);

  useEffect(() => {
    writeStorageValue(priorityLaneStorageKey, priorityLaneEnabled ? '1' : '0');
  }, [priorityLaneEnabled, priorityLaneStorageKey]);

  useEffect(() => {
    writeStorageValue(viewableProjectsStorageKey, viewableProjectsEnabled ? '1' : '0');
  }, [viewableProjectsEnabled, viewableProjectsStorageKey]);

  return {
    projectScope,
    filters,
    setFilters,
    fullWindow,
    setFullWindow,
    fitMode,
    setFitMode,
    showSubtasks,
    setShowSubtasks,
    sortKey,
    setSortKey,
    hiddenStatusIds,
    setHiddenStatusIds,
    fontSize,
    setFontSize,
    timeEntryOnClose,
    setTimeEntryOnClose,
    priorityLaneEnabled,
    setPriorityLaneEnabled,
    viewableProjectsEnabled,
    setViewableProjectsEnabled,
  };
}
