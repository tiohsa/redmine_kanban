// @vitest-environment jsdom

import React, { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Issue } from '../types';
import { useBulkSubtaskMutation } from './useBulkSubtaskMutation';
import { HttpError } from '../http';

const postJsonMock = vi.hoisted(() => vi.fn());
const getJsonMock = vi.hoisted(() => vi.fn());

vi.mock('../http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../http')>()),
  postJson: postJsonMock,
  getJson: getJsonMock,
}));

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function makeIssue(id: number): Issue {
  return {
    id,
    subject: `Subtask ${id}`,
    status_id: 1,
    tracker_id: 1,
    description: '',
    assigned_to_id: null,
    urls: { issue: `/issues/${id}`, issue_edit: `/issues/${id}/edit` },
  };
}

function makeBoard() {
  const child = makeIssue(2);
  const parent = { ...makeIssue(1), subtasks: [child as never] };
  return {
    ok: true,
    meta: {
      project_id: 1,
      project_ids: [1],
      scope_fingerprint: 'project:1',
      current_user_id: 1,
      can_move: true,
      can_create: true,
      can_delete: true,
      lane_type: 'assignee' as const,
      aging_warn_days: 7,
      aging_danger_days: 14,
      aging_exclude_closed: false,
    },
    columns: [{ id: 1, name: 'Open', is_closed: false }],
    lanes: [],
    lists: { assignees: [], trackers: [], priorities: [], projects: [], viewable_projects: [], creatable_projects: [] },
    issues: [parent],
    labels: {},
  };
}

describe('useBulkSubtaskMutation', () => {
  beforeEach(() => {
    sessionStorage.clear();
    postJsonMock.mockReset();
    getJsonMock.mockReset();
  });

  it('posts subtasks in order and applies the created delta without invalidating the board', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    postJsonMock.mockResolvedValueOnce({ subtasks: [makeIssue(101), makeIssue(102)] });

    const { result } = renderHook(
      () => useBulkSubtaskMutation('/projects/demo/kanban', ['kanban', 'board'] as const),
      { wrapper: createWrapper(queryClient) }
    );

    const payloads = [
      { parent_issue_id: 1, subject: 'A', tracker_id: 2 },
      { parent_issue_id: 1, subject: 'B', tracker_id: 3, assigned_to_id: 10 },
    ];

    await act(async () => {
      const response = await result.current.mutateAsync(payloads);
      expect(response.subtasks?.map((issue) => issue.id)).toEqual([101, 102]);
    });

    expect(postJsonMock).toHaveBeenCalledWith(
      '/projects/demo/kanban/issues/bulk?board_entity_limit=1500&scope_status_ids_present=1&dependency_status_ids_present=1',
      expect.objectContaining({ parent: { parent_issue_id: 1, project_id: undefined }, subtasks: payloads, operation_id: expect.any(String) }),
      'POST',
      expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
    );
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('preserves the current project scope on bulk mutation requests', async () => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    postJsonMock.mockResolvedValueOnce({ subtasks: [makeIssue(101)] });

    const { result } = renderHook(
      () => useBulkSubtaskMutation('/projects/demo/kanban', ['kanban'] as const, [7, 3, 7]),
      { wrapper: createWrapper(queryClient) },
    );

    await act(async () => {
      await result.current.mutateAsync([{ parent_issue_id: 1, subject: 'Scoped', tracker_id: 2 }]);
    });

    expect(postJsonMock).toHaveBeenCalledWith(
      '/projects/demo/kanban/issues/bulk?project_ids%5B%5D=3&project_ids%5B%5D=7&board_entity_limit=1500&scope_status_ids_present=1&dependency_status_ids_present=1',
      expect.any(Object),
      'POST',
      expect.any(Object),
    );
  });

  it('forwards the configured board entity limit to bulk mutation', async () => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    postJsonMock.mockResolvedValueOnce({ subtasks: [makeIssue(101)] });

    const { result } = renderHook(
      () => useBulkSubtaskMutation('/projects/demo/kanban', ['kanban'] as const, [7], [2], [2, 3], 3000),
      { wrapper: createWrapper(queryClient) },
    );

    await act(async () => {
      await result.current.mutateAsync([{ parent_issue_id: 1, subject: 'Configured', tracker_id: 2 }]);
    });

    expect(postJsonMock).toHaveBeenCalledWith(
      '/projects/demo/kanban/issues/bulk?project_ids%5B%5D=7&board_entity_limit=3000&scope_status_ids_present=1&scope_status_ids%5B%5D=2&dependency_status_ids_present=1&dependency_status_ids%5B%5D=2&dependency_status_ids%5B%5D=3',
      expect.any(Object),
      'POST',
      expect.any(Object),
    );
  });

  it('applies missing IDs from bulk reconciliation to the normalized board state', async () => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    queryClient.setQueryData(['kanban'], makeBoard());
    postJsonMock.mockResolvedValueOnce({
      subtasks: [makeIssue(101)],
      invalidations: { issue_ids: [2] },
    });
    getJsonMock.mockResolvedValueOnce({
      scope_fingerprint: 'project:1',
      entities: [],
      missing_issue_ids: [2],
    });

    const { result } = renderHook(
      () => useBulkSubtaskMutation('/projects/demo/kanban', ['kanban'] as const),
      { wrapper: createWrapper(queryClient) },
    );

    await act(async () => {
      await result.current.mutateAsync([{ parent_issue_id: 1, subject: 'A', tracker_id: 2 }]);
      await Promise.resolve();
    });

    expect(getJsonMock).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData<ReturnType<typeof makeBoard>>(['kanban'])?.issues[0]?.subtasks).toEqual([]);
  });

  it('resets the board and skips reconciliation for snapshot-invalidated success without issue DTOs', async () => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    queryClient.setQueryData(['kanban'], makeBoard());
    const resetQueries = vi.spyOn(queryClient, 'resetQueries');
    postJsonMock.mockResolvedValueOnce({
      ok: true,
      contract_version: 3,
      invalidations: { board_snapshot: true },
    });

    const { result } = renderHook(
      () => useBulkSubtaskMutation('/projects/demo/kanban', ['kanban'] as const),
      { wrapper: createWrapper(queryClient) },
    );

    await act(async () => {
      await result.current.mutateAsync([{ parent_issue_id: 1, subject: 'Overflow', tracker_id: 2 }]);
    });

    expect(resetQueries).toHaveBeenCalledWith({ queryKey: ['kanban'] });
    expect(getJsonMock).not.toHaveBeenCalled();
  });

  it('can defer all board reconciliation for a native composite operation', async () => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    queryClient.setQueryData(['kanban'], makeBoard());
    const resetQueries = vi.spyOn(queryClient, 'resetQueries');
    postJsonMock.mockResolvedValueOnce({
      ok: true,
      contract_version: 3,
      created_issues: [makeIssue(101)],
      invalidations: { board_snapshot: true },
    });

    const { result } = renderHook(
      () => useBulkSubtaskMutation('/projects/demo/kanban', ['kanban'] as const, [], [], [], 3000, true),
      { wrapper: createWrapper(queryClient) },
    );

    await act(async () => {
      await result.current.mutateAsync([{ parent_issue_id: 1, subject: 'Deferred', tracker_id: 2 }]);
    });

    expect(resetQueries).not.toHaveBeenCalled();
    expect(queryClient.getQueryData<ReturnType<typeof makeBoard>>(['kanban'])?.issues[0]?.subtasks).toHaveLength(1);
  });

  it('reports the failed row and API validation details', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    postJsonMock.mockRejectedValueOnce(new HttpError(422, {
      message: 'tracker is not available',
      field_errors: { tracker_id: ['Select a tracker available in the project'] },
    }));

    const { result } = renderHook(
      () => useBulkSubtaskMutation('/projects/demo/kanban', ['kanban'] as const),
      { wrapper: createWrapper(queryClient) }
    );

    await expect(act(async () => result.current.mutateAsync([
      { parent_issue_id: 10, subject: 'Invalid child', tracker_id: 99 },
    ]))).rejects.toMatchObject({
      name: 'BulkSubtaskError',
      details: {
        rowIndex: 0,
        subject: 'Invalid child',
        status: 422,
        message: 'tracker is not available',
        fieldErrors: { tracker_id: ['Select a tracker available in the project'] },
      },
    });
  });

  it('single-flights concurrent requests for the same operation', async () => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    let resolveRequest: ((value: { subtasks: Issue[] }) => void) | undefined;
    postJsonMock.mockReturnValueOnce(new Promise((resolve) => { resolveRequest = resolve; }));
    const { result } = renderHook(
      () => useBulkSubtaskMutation('/projects/demo/kanban', ['kanban'] as const),
      { wrapper: createWrapper(queryClient) }
    );
    const payload = [{ parent_issue_id: 1, subject: 'A', tracker_id: 2 }];

    let first: Promise<{ subtasks?: Issue[] }>;
    let second: Promise<{ subtasks?: Issue[] }>;
    await act(async () => {
      first = result.current.mutateAsync(payload);
      second = result.current.mutateAsync(payload);
      await Promise.resolve();
    });
    expect(postJsonMock).toHaveBeenCalledTimes(1);
    resolveRequest?.({ subtasks: [makeIssue(101)] });
    await expect(first!).resolves.toMatchObject({ subtasks: expect.any(Array) });
    await expect(second!).resolves.toMatchObject({ subtasks: expect.any(Array) });
  });

  it('reuses the key after an unknown failure and removes it after success', async () => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const payload = [{ parent_issue_id: 1, subject: 'Retry me', tracker_id: 2 }];
    postJsonMock.mockRejectedValueOnce(new TypeError('network failed'))
      .mockResolvedValueOnce({ subtasks: [makeIssue(101)] });
    const { result } = renderHook(
      () => useBulkSubtaskMutation('/projects/demo/kanban', ['kanban'] as const),
      { wrapper: createWrapper(queryClient) }
    );

    let firstError: unknown;
    await act(async () => {
      try { await result.current.mutateAsync(payload); } catch (error) { firstError = error; }
    });
    expect(firstError).toMatchObject({ message: 'network failed' });
    await act(async () => { await result.current.mutateAsync(payload); });
    const firstHeaders = postJsonMock.mock.calls[0][3];
    const secondHeaders = postJsonMock.mock.calls[1][3];
    expect(firstHeaders['Idempotency-Key']).toBe(secondHeaders['Idempotency-Key']);

    postJsonMock.mockResolvedValueOnce({ subtasks: [makeIssue(102)] });
    await act(async () => { await result.current.mutateAsync(payload); });
    expect(postJsonMock.mock.calls[2][3]['Idempotency-Key']).not.toBe(secondHeaders['Idempotency-Key']);
  });
});
