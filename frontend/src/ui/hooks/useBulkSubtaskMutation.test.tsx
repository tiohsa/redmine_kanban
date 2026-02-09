// @vitest-environment jsdom

import React, { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Issue } from '../types';
import { useBulkSubtaskMutation } from './useBulkSubtaskMutation';

const postJsonMock = vi.hoisted(() => vi.fn());

vi.mock('../http', () => ({
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

    postJsonMock
      .mockResolvedValueOnce({ issue: makeIssue(101) })
      .mockResolvedValueOnce({ issue: makeIssue(102) });

    const { result } = renderHook(
      () => useBulkSubtaskMutation('/projects/demo/kanban', ['kanban', 'board'] as const),
      { wrapper: createWrapper(queryClient) }
    );

    const payloads = [
      { parent_issue_id: 1, subject: 'A' },
      { parent_issue_id: 1, subject: 'B', assigned_to_id: 10 },
    ];

    await act(async () => {
      const issues = await result.current.mutateAsync(payloads);
      expect(issues.map((issue) => issue.id)).toEqual([101, 102]);
    });

    expect(postJsonMock).toHaveBeenNthCalledWith(
      1,
      '/projects/demo/kanban/issues',
      { issue: payloads[0] },
      'POST'
    );
    expect(postJsonMock).toHaveBeenNthCalledWith(
      2,
      '/projects/demo/kanban/issues',
      { issue: payloads[1] },
      'POST'
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['kanban', 'board'] });
  });
});
