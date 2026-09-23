import { describe, expect, it } from 'vitest';
import { makeBoardSnapshot } from '../../test/fixtures/boardSnapshot';
import { normalizeBoardData, parseBoardSnapshotV3 } from './boardSnapshot';

describe('parseBoardSnapshotV3', () => {
  it('accepts a complete snapshot without mutating it or losing server URLs', () => {
    const input = makeBoardSnapshot();
    input.entities.push({ ...input.entities[0], id: 10, parent_id: 9, urls: { issue: '/redmine/issues/10', issue_edit: '/redmine/issues/10/edit' } });
    input.meta.entity_count = 2;
    input.tree.children_by_parent_id = { '9': [10] };
    const before = structuredClone(input);

    expect(parseBoardSnapshotV3(input)).toBe(input);
    const board = normalizeBoardData(parseBoardSnapshotV3(input));
    expect(board.issues[0].subtasks?.[0].urls).toEqual(input.entities[1].urls);
    expect(input).toEqual(before);
  });

  it('accepts an empty complete board and omitted optional fields', () => {
    const data = makeBoardSnapshot();
    data.entities = [];
    data.tree.root_ids = [];
    data.meta = { project_id: 4, current_user_id: 0, can_move: false, can_create: false, can_delete: false, lane_type: 'assignee', complete: true, entity_count: 0 };
    data.columns = [{ id: 2, name: 'Open', is_closed: false }];
    data.lists.trackers = [{ id: 1, name: 'Bug' }];
    delete data.lists.categories;
    expect(parseBoardSnapshotV3(data)).toBe(data);
  });

  it('accepts nullable server attributes and minimal Issue attributes', () => {
    const data = makeBoardSnapshot();
    data.entities = [{ id: 9, subject: 'Issue', status_id: 2, tracker_id: null, description: null, assigned_to_id: null, urls: data.entities[0].urls }];
    data.lists.trackers[0].default_status_id = null;
    expect(parseBoardSnapshotV3(data)).toBe(data);
  });

  it.each<[string, unknown]>([
    ['lists', {}], ['lists', []],
    ...['assignees', 'trackers', 'priorities', 'projects', 'viewable_projects', 'creatable_projects'].map((key): [string, unknown] => [`lists.${key}`, undefined]),
    ['lists.assignees', {}], ['lists.assignees.0', null], ['lists.assignees.0.name', 12],
    ['lists.assignees.0.id', '7'], ['lists.trackers.0.name', 123], ['lists.trackers.0.id', 0],
    ['lists.trackers.0.workflow_status_ids', '2'], ['lists.trackers.0.available_project_ids', [null]],
    ['lists.trackers.0.default_status_id', '2'], ['lists.priorities.0.name', {}],
    ['lists.projects.0.level', -1], ['lists.viewable_projects.0.name', null],
    ['lists.creatable_projects.0.id', '4'], ['lists.categories', {}], ['lists.categories.0.project_id', -1],
    ['entities.0.urls', undefined], ['entities.0.urls', []], ['entities.0.urls.issue', '  '],
    ['entities.0.urls.issue_edit', 42], ['entities.0', null],
    ['entities.0.subject', undefined], ['entities.0.subject', {}], ['entities.0.status_id', '2'],
    ['entities.0.tracker_id', undefined], ['entities.0.assigned_to_id', undefined],
    ['entities.0.description', undefined], ['entities.0.description', 123],
    ['entities.0.parent_id', []], ['entities.0.due_date', {}], ['entities.0.lock_version', '1'],
    ['entities.0.project', {}], ['entities.0.permissions.can_edit', 'true'],
    ['entities.0.allowed_status_ids', {}], ['entities.0.status_is_closed', 'false'],
    ['entities.0.aging_days', NaN], ['entities.0.done_ratio', Infinity],
    ['columns.0', null], ['columns.0.name', 123], ['columns.0.is_closed', 'false'], ['columns.0.count', -1],
    ['lanes.0.name', {}], ['lanes.0.id', null], ['lanes.0.assigned_to_id', '7'],
    ['labels', []], ['labels.load_failed', {}],
    ['meta', []], ['meta.project_id', null], ['meta.current_user_id', '7'],
    ['meta.can_move', 'false'], ['meta.lane_type', 'unknown'], ['meta.entity_count', undefined],
    ['meta.scope_status_ids', {}], ['meta.effective_entity_limit', '1500'],
    ['tree.children_by_parent_id', []], ['scope_fingerprint', '  '],
  ])('rejects malformed %s (%j)', (path, value) => {
    const data = makeBoardSnapshot();
    const keys = path.split('.');
    let target = data as unknown as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
    target[keys[keys.length - 1]] = value;
    expect(() => parseBoardSnapshotV3(data)).toThrow('Invalid board snapshot');
  });

  it('rejects invalid URLs on a child Entity before compatibility normalization', () => {
    const data = makeBoardSnapshot();
    const child = { ...data.entities[0], id: 10, parent_id: 9, urls: null };
    const malformed = { ...data, meta: { ...data.meta, entity_count: 2 }, entities: [...data.entities, child], tree: { root_ids: [9], children_by_parent_id: { '9': [10] } } };
    expect(() => parseBoardSnapshotV3(malformed)).toThrow('Invalid board snapshot');
  });

  it('still rejects inconsistent counts, fingerprints, duplicate IDs and invalid tree membership', () => {
    const data = makeBoardSnapshot();
    const invalid = [
      { ...data, meta: { ...data.meta, entity_count: 2 } },
      { ...data, meta: { ...data.meta, scope_fingerprint: 'other' } },
      { ...data, entities: [...data.entities, ...data.entities], meta: { ...data.meta, entity_count: 2 } },
      { ...data, tree: { root_ids: [9, 9], children_by_parent_id: {} } },
      { ...data, tree: { root_ids: [], children_by_parent_id: {} } },
      { ...data, tree: { root_ids: [9], children_by_parent_id: { '9': [10] } } },
      { ...data, tree: { root_ids: [9], children_by_parent_id: { '9': [9] } } },
      { ...data, tree: { root_ids: [9], children_by_parent_id: { '8': [] } } },
    ];
    for (const response of invalid) expect(() => parseBoardSnapshotV3(response)).toThrow('Invalid board snapshot');
  });
});
