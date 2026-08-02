import { describe, expect, it } from 'vitest';
import {
  buildIssueTitle,
  buildDisplayData,
  buildTrackerCatalog,
  findIssueInBoard,
  findSubtask,
  normalizeBoardData,
  normalizeTrackerId,
  resolveBoardIssue,
  resolveTrackerName,
} from './kanbanShared';
import type { BoardData, Issue } from './types';

function makeIssue(id: number, attrs: Partial<Issue> = {}): Issue {
  return {
    id,
    subject: `Issue ${id}`,
    status_id: 1,
    tracker_id: 1,
    description: '',
    assigned_to_id: null,
    lock_version: 3,
    urls: {
      issue: `/issues/${id}`,
      issue_edit: `/issues/${id}/edit`,
    },
    ...attrs,
  };
}

function makeBoardData(issues: Issue[]): BoardData {
  return {
    ok: true,
    meta: {
      project_id: 1,
      current_user_id: 7,
      can_move: true,
      can_create: true,
      can_delete: true,
      lane_type: 'assignee',
      aging_warn_days: 3,
      aging_danger_days: 7,
      aging_exclude_closed: true,
    },
    columns: [
      { id: 1, name: 'Open', is_closed: false, count: 1 },
      { id: 2, name: 'Closed', is_closed: true, count: 0 },
    ],
    lanes: [],
    lists: {
      assignees: [],
      trackers: [{ id: 1, name: 'Bug' }],
      priorities: [],
      projects: [],
      viewable_projects: [],
      creatable_projects: [],
    },
    issues,
    labels: {},
  };
}

describe('resolveBoardIssue', () => {
  it('resolves top-level issues with existing urls', () => {
    const data = makeBoardData([makeIssue(10, { subject: 'Top level', project: { id: 3, name: 'Subproject' } })]);

    expect(resolveBoardIssue(data, 10)).toMatchObject({
      id: 10,
      subject: 'Top level',
      lockVersion: 3,
      assignedToId: null,
      issueUrl: '/issues/10',
      issueEditUrl: '/issues/10/edit',
      kind: 'issue',
      trackerId: 1,
      parentIssueId: undefined,
      projectId: 3,
    });
  });

  it('resolves nested subtasks and builds urls from the id', () => {
    const data = makeBoardData([
      makeIssue(10, {
        project: { id: 3, name: 'Subproject' },
        subtasks: [
          {
            id: 20,
            subject: 'Child',
            status_id: 1,
            is_closed: true,
            lock_version: 5,
            subtasks: [
              {
                id: 30,
                subject: 'Grandchild',
                status_id: 2,
                tracker_id: 1,
                is_closed: false,
                lock_version: 8,
              },
            ],
          },
        ],
      }),
    ]);

    expect(resolveBoardIssue(data, 30)).toEqual({
      id: 30,
      subject: 'Grandchild',
      lockVersion: 8,
      assignedToId: undefined,
      issueUrl: '/issues/30',
      issueEditUrl: '/issues/30/edit',
      kind: 'subtask',
      trackerId: 1,
      parentIssueId: 10,
      projectId: 3,
    });
  });

  it('returns null for unknown ids', () => {
    const data = makeBoardData([makeIssue(10)]);
    expect(resolveBoardIssue(data, 99)).toBeNull();
  });
});

describe('Tracker catalog projection', () => {
  it('normalizes only positive integer tracker ids', () => {
    expect(normalizeTrackerId(1)).toBe(1);
    expect(normalizeTrackerId(0)).toBeNull();
    expect(normalizeTrackerId(-1)).toBeNull();
    expect(normalizeTrackerId(1.5)).toBeNull();
    expect(normalizeTrackerId(null)).toBeNull();
    expect(normalizeTrackerId(undefined)).toBeNull();
  });

  it('resolves the same tracker name for root and nested issue display paths', () => {
    const catalog = buildTrackerCatalog([
      { id: 1, name: 'Bug' },
      { id: 2, name: 'Feature' },
    ]);

    expect(resolveTrackerName(catalog, 1)).toBe('Bug');
    expect(resolveTrackerName(catalog, 2)).toBe('Feature');
  });

  it('builds the same title projection for root, child, and unknown tracker paths', () => {
    const data = makeBoardData([
      makeIssue(10, {
        subject: 'Parent',
        subtasks: [{ id: 20, subject: 'Child', status_id: 1, tracker_id: 1, is_closed: false }],
      }),
    ]);

    expect(buildIssueTitle(data, 10)).toBe('Bug #10 Parent');
    expect(buildIssueTitle(data, 20)).toBe('Bug #20 Child');
    expect(buildIssueTitle(data, 99, { id: 99, subject: 'Created', tracker_id: 1 })).toBe('Bug #99 Created');

    const unknownData = {
      ...data,
      issues: [makeIssue(30, { subject: 'Unknown', tracker_id: 0 })],
    };
    expect(buildIssueTitle(unknownData, 30)).toBe('#30 Unknown');
    expect(buildIssueTitle(unknownData, 30, { id: 30, subject: 'Fallback', tracker_id: 1 })).toBe('#30 Unknown');
  });

  it('normalizes invalid tracker values across root and nested board data', () => {
    const normalized = normalizeBoardData(makeBoardData([
      makeIssue(40, {
        tracker_id: 0,
        subtasks: [{ id: 41, subject: 'Unknown child', status_id: 1, tracker_id: -1, is_closed: false }],
      }),
    ]));

    expect(normalized.issues[0]?.tracker_id).toBeNull();
    expect(normalized.issues[0]?.subtasks?.[0]?.tracker_id).toBeNull();
  });

  it('does not invent a tracker name for invalid or unknown ids', () => {
    const catalog = buildTrackerCatalog([
      { id: 0, name: 'Invalid' },
      { id: 1, name: '  ' },
      { id: 2, name: 'Feature' },
      { id: 2, name: 'Duplicate' },
    ]);

    expect(resolveTrackerName(catalog, 0)).toBeNull();
    expect(resolveTrackerName(catalog, null)).toBeNull();
    expect(resolveTrackerName(catalog, undefined)).toBeNull();
    expect(resolveTrackerName(catalog, 99)).toBeNull();
    expect(resolveTrackerName(catalog, 2)).toBe('Feature');
  });
});

describe('findSubtask', () => {
  it('reuses the shared resolver for subtask mutation info', () => {
    const data = makeBoardData([
      makeIssue(10, {
        subtasks: [
          {
            id: 20,
            subject: 'Child',
            status_id: 1,
            is_closed: false,
            lock_version: 11,
          },
        ],
      }),
    ]);

    expect(findSubtask(data, 20)).toEqual({
      lockVersion: 11,
      assignedToId: undefined,
    });
  });
});

describe('findIssueInBoard', () => {
  it('returns nested issue data for modal and mutation callers', () => {
    const data = makeBoardData([
      makeIssue(10, {
        subtasks: [{ id: 20, subject: 'Child', status_id: 1, is_closed: false, lock_version: 11 }],
      }),
    ]);

    expect(findIssueInBoard(data, 20)).toMatchObject({ id: 20, subject: 'Child', lock_version: 11 });
  });
});

describe('resolveSubtaskStatus', () => {
  it('selects an allowed closed status instead of the first closed board column', async () => {
    const { resolveSubtaskStatus } = await import('./kanbanShared');
    const data = makeBoardData([]);
    data.columns = [
      { id: 1, name: 'Open', is_closed: false },
      { id: 2, name: 'Blocked closed', is_closed: true },
      { id: 3, name: 'Allowed closed', is_closed: true },
    ];

    expect(resolveSubtaskStatus(data, false, [3])).toBe(3);
  });

  it('returns null when the workflow offers no status for the requested transition', async () => {
    const { resolveSubtaskStatus } = await import('./kanbanShared');
    const data = makeBoardData([]);

    expect(resolveSubtaskStatus(data, false, [1])).toBeNull();
  });
});

describe('buildDisplayData', () => {
  it('builds priority lanes in high-to-low order with no_priority at the end', () => {
    const data = makeBoardData([]);
    data.lists.priorities = [
      { id: 1, name: 'Low' },
      { id: 2, name: 'High' },
    ];
    data.labels = { not_set: 'Not set' };

    const displayData = buildDisplayData(data, 'priority', { warnDays: 3, dangerDays: 7, excludeClosed: true });

    expect(displayData.meta.lane_type).toBe('priority');
    expect(displayData.lanes.map((lane) => lane.id)).toEqual([2, 1, 'no_priority']);
  });
});
