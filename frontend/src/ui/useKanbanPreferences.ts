import { useEffect, useMemo, useState } from 'react';
import type { SortKey } from './board/sort';
import type { Filters } from './boardFilters';
import { buildProjectScopeFromDataUrl, makeScopedStorageKey, readScopedBooleanWithLegacy, readScopedNumberSetWithLegacy } from './utils/storage';
import type { FitMode } from './kanbanShared';

const DEFAULT_FILTERS: Filters = {
  assignee: 'all',
  q: '',
  due: 'all',
  priority: [],
  priorityFilterEnabled: false,
  projectIds: [],
  statusIds: [],
};

function readFilters(storageKey: string): Filters {
  try {
    const value = localStorage.getItem(storageKey);
    if (value) {
      const parsed = JSON.parse(value);
      return {
        assignee: parsed.assignee || 'all',
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

  const [filters, setFilters] = useState<Filters>(() => readFilters(filtersStorageKey));
  const [fullWindow, setFullWindow] = useState(() => {
    try {
      return localStorage.getItem('rk_fullwindow') === '1';
    } catch {
      return false;
    }
  });
  const [fitMode, setFitMode] = useState<FitMode>(() => {
    try {
      const value = localStorage.getItem('rk_fit_mode');
      if (value === 'none' || value === 'width') return value;
      if (localStorage.getItem('rk_fit_to_screen') === '1') return 'width';
    } catch {
      // ignore
    }
    return 'none';
  });
  const [showSubtasks, setShowSubtasks] = useState(() => {
    try {
      return localStorage.getItem('rk_show_subtasks') !== '0';
    } catch {
      return true;
    }
  });
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    try {
      const value = localStorage.getItem('rk_sortkey');
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
    } catch {
      // ignore
    }
    return 'updated_desc';
  });
  const [hiddenStatusIds, setHiddenStatusIds] = useState<Set<number>>(() =>
    readScopedNumberSetWithLegacy(hiddenStatusStorageKey, 'rk_hidden_status_ids', new Set()),
  );
  const [fontSize, setFontSize] = useState<number>(() => {
    try {
      const value = localStorage.getItem('rk_font_size');
      if (value) return parseInt(value, 10);
    } catch {
      // ignore
    }
    return 13;
  });
  const [timeEntryOnClose, setTimeEntryOnClose] = useState(() => {
    try {
      return localStorage.getItem('rk_time_entry_on_close') === '1';
    } catch {
      return false;
    }
  });
  const [priorityLaneEnabled, setPriorityLaneEnabled] = useState(() =>
    readScopedBooleanWithLegacy(priorityLaneStorageKey, 'rk_priority_lane_enabled', false),
  );

  useEffect(() => {
    const className = 'rk-kanban-fullwindow';
    if (fullWindow) {
      document.body.classList.add(className);
    } else {
      document.body.classList.remove(className);
    }

    try {
      localStorage.setItem('rk_fullwindow', fullWindow ? '1' : '0');
    } catch {
      // ignore
    }

    return () => {
      document.body.classList.remove(className);
    };
  }, [fullWindow]);

  useEffect(() => {
    try {
      localStorage.setItem('rk_fit_mode', fitMode);
    } catch {
      // ignore
    }
  }, [fitMode]);

  useEffect(() => {
    try {
      localStorage.setItem('rk_sortkey', sortKey);
    } catch {
      // ignore
    }
  }, [sortKey]);

  useEffect(() => {
    try {
      localStorage.setItem(filtersStorageKey, JSON.stringify(filters));
    } catch {
      // ignore
    }
  }, [filters, filtersStorageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(hiddenStatusStorageKey, JSON.stringify(Array.from(hiddenStatusIds)));
    } catch {
      // ignore
    }
  }, [hiddenStatusIds, hiddenStatusStorageKey]);

  useEffect(() => {
    try {
      localStorage.setItem('rk_show_subtasks', showSubtasks ? '1' : '0');
    } catch {
      // ignore
    }
  }, [showSubtasks]);

  useEffect(() => {
    try {
      localStorage.setItem('rk_font_size', String(fontSize));
    } catch {
      // ignore
    }
  }, [fontSize]);

  useEffect(() => {
    try {
      localStorage.setItem('rk_time_entry_on_close', timeEntryOnClose ? '1' : '0');
    } catch {
      // ignore
    }
  }, [timeEntryOnClose]);

  useEffect(() => {
    try {
      localStorage.setItem(priorityLaneStorageKey, priorityLaneEnabled ? '1' : '0');
    } catch {
      // ignore
    }
  }, [priorityLaneEnabled, priorityLaneStorageKey]);

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
  };
}
