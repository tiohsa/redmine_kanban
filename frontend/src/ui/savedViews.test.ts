// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { copyViewSettings, parseSavedViews, validateViewName, viewSettingsEqual, type SavedViewSettings } from '../model/view/savedViews';
import { activeSavedViewKey, savedViewsKey } from '../infrastructure/storage/savedViewsRepository';
import { validateViewReferences } from '../model/view/validation';
export const settings: SavedViewSettings = {
  filters: { assigneeIds: ['2', 'unassigned'], q: 'test', due: 'custom', dueDays: 3, priority: [], priorityFilterEnabled: true, projectIds: [1], statusIds: [2], trackerIds: [3] },
  sortConfig: [{ field: 'due', direction: 'asc' }, { field: 'priority', direction: 'desc' }], laneType: 'category', hiddenStatusIds: [4], viewableProjectsEnabled: true,
};
describe('saved view documents', () => {
  it('round trips every setting including empty priority selection and ordered sorting', () => {
    const document = { version: 1, views: [{ id: 'stable', name: 'Example', settings }] };
    expect(parseSavedViews(JSON.stringify(document))).toEqual(document);
    expect(copyViewSettings({ ...settings, fontSize: 30 } as SavedViewSettings)).not.toHaveProperty('fontSize');
  });
  it.each(['{', '{"version":2,"views":[]}', '{"version":1,"views":{}}', JSON.stringify({ version: 1, views: [{ id: 'x', name: 'X', settings: { ...settings, filters: { ...settings.filters, dueDays: null } } }] })])('rejects unreadable data %s', (raw) => expect(() => parseSavedViews(raw)).toThrow());
  it('rejects string-like arrays instead of coercing invalid field types', () => {
    for (const invalid of [
      { ...settings, filters: { ...settings.filters, due: ['all'] } },
      { ...settings, sortConfig: [{ field: ['due'], direction: 'asc' }] },
      { ...settings, sortConfig: [{ field: 'due', direction: ['asc'] }] },
    ]) {
      expect(() => parseSavedViews(JSON.stringify({ version: 1, views: [{ id: 'a', name: 'A', settings: invalid }] }))).toThrow();
    }
  });

  it('validates names and duplicate names without implicit replacement', () => {
    expect(validateViewName(' A ', [])).toBe('A');
    expect(validateViewName('x'.repeat(80), [])).toHaveLength(80);
    expect(() => validateViewName('x'.repeat(81), [])).toThrow();
    expect(() => validateViewName(' ', [])).toThrow();
    const views = [{ id: 'a', name: 'A', settings }];
    expect(() => validateViewName('A', views)).toThrow('saved_views_duplicate');
    expect(validateViewName('A', views, 'a')).toBe('A');
  });
  it('isolates users, boards and Redmine subpaths with the existing scope format', () => {
    const keys = [savedViewsKey('/one/projects/a/kanban/data', 1), savedViewsKey('/two/projects/a/kanban/data', 1), savedViewsKey('/one/projects/a/kanban/data', 2), savedViewsKey('/one/projects/b/kanban/data', 1)];
    expect(new Set(keys).size).toBe(4);
    expect(keys[0]).toBe('rk_saved_views:/one/projects/a/kanban:user:1');
    expect(new Set(keys.map(activeSavedViewKey)).size).toBe(4);
    expect(activeSavedViewKey(keys[0])).toBe(`${keys[0]}:active`);
  });
  it('compares ID sets independently of order while retaining sort order', () => {
    const other = copyViewSettings(settings);
    other.filters.assigneeIds.reverse();
    expect(viewSettingsEqual(settings, other)).toBe(true);
    other.sortConfig.reverse();
    expect(viewSettingsEqual(settings, other)).toBe(false);
  });
  it('keeps unknown references pending and reports known invalid IDs without deleting them', () => {
    const before = copyViewSettings(settings);
    expect(validateViewReferences(settings, null, null, {}).pending).toBe(true);
    const validation = validateViewReferences(settings, { ok: true, board: { id: 1, name: 'B', identifier: 'b' }, projects: [], viewable_projects: [], statuses: [], server_entity_limit: 5000 }, null, { project: 'Project', status: 'Status', hidden_statuses: 'Hidden' });
    expect(validation.unavailable).toEqual(['Project: 1', 'Status: 2', 'Hidden: 4']);
    expect(validation.pending).toBe(true);
    expect(settings).toEqual(before);
  });
});
