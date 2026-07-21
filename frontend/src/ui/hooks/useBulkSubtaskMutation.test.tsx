// @vitest-environment jsdom

import React, { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Issue } from '../types';
import { useBulkSubtaskMutation } from './useBulkSubtaskMutation';
import { HttpError } from '../http';

const postJsonMock = vi.hoisted(() => vi.fn());

vi.mock('../http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../http')>()),
  postJson: postJsonMock,
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

describe('useBulkSubtaskMutation', () => {
  beforeEach(() => {
    sessionStorage.clear();
    postJsonMock.mockReset();
  });

  it('posts subtasks in order and invalidates query on success', async () => {
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
      const issues = await result.current.mutateAsync(payloads);
      expect(issues.map((issue) => issue.id)).toEqual([101, 102]);
    });

    expect(postJsonMock).toHaveBeenCalledWith(
      '/projects/demo/kanban/issues/bulk',
      { parent: { parent_issue_id: 1, project_id: undefined }, subtasks: payloads },
      'POST',
      expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['kanban', 'board'] });
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

    let first: Promise<Issue[]>;
    let second: Promise<Issue[]>;
    await act(async () => {
      first = result.current.mutateAsync(payload);
      second = result.current.mutateAsync(payload);
      await Promise.resolve();
    });
    expect(postJsonMock).toHaveBeenCalledTimes(1);
    resolveRequest?.({ subtasks: [makeIssue(101)] });
    await expect(first!).resolves.toHaveLength(1);
    await expect(second!).resolves.toHaveLength(1);
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
