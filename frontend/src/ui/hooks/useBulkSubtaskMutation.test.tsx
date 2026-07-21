// @vitest-environment jsdom

import React, { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
});
