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
    expect(validateViewReferences(settings, null, {}).pending).toBe(true);
    const validation = validateViewReferences(settings, { ok: true, board: { id: 1, name: 'B', identifier: 'b' }, projects: [], viewable_projects: [], statuses: [], server_entity_limit: 10000, filter_options: { assignees: [{ id: 2, name: 'A', available_project_ids: [1] }], trackers: [{ id: 3, name: 'T', available_project_ids: [1] }], priorities: [] } }, { project: 'Project', status: 'Status', hidden_statuses: 'Hidden', assignee: 'Assignee', issue_tracker: 'Tracker', issue_priority: 'Priority' });
    expect(validation.unavailable).toEqual(['Project: 1', 'Status: 2', 'Hidden: 4']);
    expect(validation.pending).toBe(false);
    expect(settings).toEqual(before);
  });

  it('validates dynamic saved-view filter IDs from metadata before a snapshot is available', () => {
    const saved = copyViewSettings(settings);
    saved.filters.assigneeIds = ['2', 'unassigned'];
    saved.filters.trackerIds = [3];
    saved.filters.priority = ['4', 'no_priority'];
    const metadata = {
      ok: true as const,
      board: { id: 1, name: 'B', identifier: 'b' },
      projects: [{ id: 1, name: 'Project', level: 0 }],
      viewable_projects: [{ id: 1, name: 'Project', level: 0 }],
      statuses: [{ id: 2, name: 'Open', is_closed: false }, { id: 4, name: 'Done', is_closed: true }],
      server_entity_limit: 10000,
      filter_options: {
        assignees: [{ id: 2, name: 'A', available_project_ids: [1] }],
        trackers: [{ id: 3, name: 'T', available_project_ids: [1] }],
        priorities: [{ id: 4, name: 'High' }],
      },
    };
    expect(validateViewReferences(saved, metadata, { project: 'Project', status: 'Status', hidden_statuses: 'Hidden', assignee: 'Assignee', issue_tracker: 'Tracker', issue_priority: 'Priority' })).toEqual({ pending: false, unavailable: [] });

    const unavailableSaved = copyViewSettings(saved);
    unavailableSaved.filters.assigneeIds = ['99'];
    unavailableSaved.filters.trackerIds = [99];
    unavailableSaved.filters.priority = ['99'];
    expect(validateViewReferences(unavailableSaved, metadata, { project: 'Project', status: 'Status', hidden_statuses: 'Hidden', assignee: 'Assignee', issue_tracker: 'Tracker', issue_priority: 'Priority' }).unavailable).toEqual(['Assignee: 99', 'Tracker: 99', 'Priority: 99']);
    expect(unavailableSaved.filters.assigneeIds).toEqual(['99']);
    expect(unavailableSaved.filters.trackerIds).toEqual([99]);
    expect(unavailableSaved.filters.priority).toEqual(['99']);
  });
});
