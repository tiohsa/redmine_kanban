// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildInstanceBasePathFromDataUrl,
  buildProjectScopeFromDataUrl,
  colorThemeStorageKey,
  makeScopedStorageKey,
  readColorTheme,
  readScopedBooleanWithLegacy,
  readScopedNumberSetWithLegacy,
  writeColorTheme,
} from './storage';

describe('storage utils', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('buildProjectScopeFromDataUrl', () => {
    it('removes /data suffix', () => {
      expect(buildProjectScopeFromDataUrl('/projects/ecookbook/kanban/data')).toBe('/projects/ecookbook/kanban');
    });

    it('removes query string before calculating scope', () => {
      expect(buildProjectScopeFromDataUrl('/projects/ecookbook/kanban/data?project_ids%5B%5D=1')).toBe('/projects/ecookbook/kanban');
    });
  });

  describe('makeScopedStorageKey', () => {
    it('creates key with scope suffix', () => {
      expect(makeScopedStorageKey('rk_hidden_status_ids', '/projects/ecookbook/kanban')).toBe(
        'rk_hidden_status_ids:/projects/ecookbook/kanban',
      );
    });
  });

  describe('readScopedBooleanWithLegacy', () => {
    it('prefers scoped key', () => {
      localStorage.setItem('rk_priority_lane_enabled:/projects/a/kanban', '1');
      localStorage.setItem('rk_priority_lane_enabled', '0');

      const result = readScopedBooleanWithLegacy(
        'rk_priority_lane_enabled:/projects/a/kanban',
        'rk_priority_lane_enabled',
        false,
      );

      expect(result).toBe(true);
      expect(localStorage.getItem('rk_priority_lane_enabled')).toBe('0');
    });

    it('falls back to legacy key when scoped key is absent', () => {
      localStorage.setItem('rk_priority_lane_enabled', '1');

      const result = readScopedBooleanWithLegacy(
        'rk_priority_lane_enabled:/projects/a/kanban',
        'rk_priority_lane_enabled',
        false,
      );

      expect(result).toBe(true);
      expect(localStorage.getItem('rk_priority_lane_enabled:/projects/a/kanban')).toBe('1');
      expect(localStorage.getItem('rk_priority_lane_enabled')).toBeNull();
    });

    it('returns default when no value exists', () => {
      const result = readScopedBooleanWithLegacy(
        'rk_priority_lane_enabled:/projects/a/kanban',
        'rk_priority_lane_enabled',
        false,
      );

      expect(result).toBe(false);
    });
  });

  describe('readScopedNumberSetWithLegacy', () => {
    it('prefers scoped set', () => {
      localStorage.setItem('rk_hidden_status_ids:/projects/a/kanban', JSON.stringify([1, 2]));
      localStorage.setItem('rk_hidden_status_ids', JSON.stringify([9]));

      const result = readScopedNumberSetWithLegacy(
        'rk_hidden_status_ids:/projects/a/kanban',
        'rk_hidden_status_ids',
        new Set(),
      );

      expect(Array.from(result).sort((a, b) => a - b)).toEqual([1, 2]);
    });

    it('falls back to legacy when scoped key is absent', () => {
      localStorage.setItem('rk_hidden_status_ids', JSON.stringify([3, 4]));

      const result = readScopedNumberSetWithLegacy(
        'rk_hidden_status_ids:/projects/a/kanban',
        'rk_hidden_status_ids',
        new Set(),
      );

      expect(Array.from(result).sort((a, b) => a - b)).toEqual([3, 4]);
      expect(localStorage.getItem('rk_hidden_status_ids:/projects/a/kanban')).toBe(JSON.stringify([3, 4]));
      expect(localStorage.getItem('rk_hidden_status_ids')).toBeNull();
    });

    it('returns default for invalid scoped json', () => {
      localStorage.setItem('rk_hidden_status_ids:/projects/a/kanban', 'not-json');
      localStorage.setItem('rk_hidden_status_ids', JSON.stringify([7]));

      const result = readScopedNumberSetWithLegacy(
        'rk_hidden_status_ids:/projects/a/kanban',
        'rk_hidden_status_ids',
        new Set([10]),
      );

      expect(Array.from(result)).toEqual([10]);
    });
  });

  describe('buildInstanceBasePathFromDataUrl', () => {
    it('returns / for root Redmine project board', () => {
      expect(buildInstanceBasePathFromDataUrl('/projects/ecookbook/kanban/data')).toBe('/');
    });

    it('returns / for root Redmine global board', () => {
      expect(buildInstanceBasePathFromDataUrl('/kanban/data')).toBe('/');
    });

    it('returns /subpath for sub-URI Redmine project board', () => {
      expect(buildInstanceBasePathFromDataUrl('/redmine/projects/ecookbook/kanban/data')).toBe('/redmine');
    });

    it('returns /subpath for sub-URI Redmine global board', () => {
      expect(buildInstanceBasePathFromDataUrl('/redmine/kanban/data')).toBe('/redmine');
    });

    it('strips query strings before resolving base path', () => {
      expect(buildInstanceBasePathFromDataUrl('/redmine/kanban/data?project_ids%5B%5D=1')).toBe('/redmine');
      expect(buildInstanceBasePathFromDataUrl('/projects/demo/kanban/data?tab=board')).toBe('/');
    });

    it('handles nested sub-URIs', () => {
      expect(buildInstanceBasePathFromDataUrl('/corporate/redmine/projects/alpha/kanban/data')).toBe('/corporate/redmine');
    });

    it('defaults to / for empty or invalid data URLs', () => {
      expect(buildInstanceBasePathFromDataUrl('')).toBe('/');
      expect(buildInstanceBasePathFromDataUrl('/unknown/format')).toBe('/');
    });
  });

  describe('colorThemeStorageKey', () => {
    it('formats key with root instance base path and user id', () => {
      expect(colorThemeStorageKey('/projects/demo/kanban/data', 42)).toBe('rk_color_theme:/:user:42');
    });

    it('formats key with subpath instance base path and user id', () => {
      expect(colorThemeStorageKey('/redmine/projects/demo/kanban/data', 42)).toBe('rk_color_theme:/redmine:user:42');
    });

    it('formats key with anonymous when user id is undefined or null', () => {
      expect(colorThemeStorageKey('/projects/demo/kanban/data', undefined)).toBe('rk_color_theme:/:user:anonymous');
      expect(colorThemeStorageKey('/redmine/kanban/data', null)).toBe('rk_color_theme:/redmine:user:anonymous');
    });
  });

  describe('readColorTheme and writeColorTheme', () => {
    it('returns default light theme when storage key is absent', () => {
      expect(readColorTheme('rk_color_theme:/:user:1')).toBe('light');
    });

    it('reads saved light or dark theme', () => {
      localStorage.setItem('rk_color_theme:/:user:1', 'dark');
      expect(readColorTheme('rk_color_theme:/:user:1')).toBe('dark');

      localStorage.setItem('rk_color_theme:/:user:1', 'light');
      expect(readColorTheme('rk_color_theme:/:user:1')).toBe('light');
    });

    it('falls back to light theme for invalid or corrupt storage values', () => {
      localStorage.setItem('rk_color_theme:/:user:1', 'neon');
      expect(readColorTheme('rk_color_theme:/:user:1')).toBe('light');

      localStorage.setItem('rk_color_theme:/:user:1', '');
      expect(readColorTheme('rk_color_theme:/:user:1')).toBe('light');

      localStorage.setItem('rk_color_theme:/:user:1', 'null');
      expect(readColorTheme('rk_color_theme:/:user:1')).toBe('light');
    });

    it('writes theme to localStorage', () => {
      writeColorTheme('rk_color_theme:/:user:7', 'dark');
      expect(localStorage.getItem('rk_color_theme:/:user:7')).toBe('dark');

      writeColorTheme('rk_color_theme:/:user:7', 'light');
      expect(localStorage.getItem('rk_color_theme:/:user:7')).toBe('light');
    });

    it('handles localStorage errors gracefully without throwing', () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      expect(() => writeColorTheme('rk_color_theme:/:user:7', 'dark')).not.toThrow();

      setItemSpy.mockRestore();
    });
  });
});
