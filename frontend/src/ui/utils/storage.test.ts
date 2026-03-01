// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildProjectScopeFromDataUrl,
  makeScopedStorageKey,
  readScopedBooleanWithLegacy,
  readScopedNumberSetWithLegacy,
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
    });

    it('falls back to legacy key when scoped key is absent', () => {
      localStorage.setItem('rk_priority_lane_enabled', '1');

      const result = readScopedBooleanWithLegacy(
        'rk_priority_lane_enabled:/projects/a/kanban',
        'rk_priority_lane_enabled',
        false,
      );

      expect(result).toBe(true);
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
});
