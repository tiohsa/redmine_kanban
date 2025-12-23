import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useQuery, useMutation, useQueryClient, UseQueryResult } from '@tanstack/react-query';
import { getJson, postJson } from './http';
import type { BoardData, Issue, Subtask } from './types';

// Create a client
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

export const QUERY_KEYS = {
  boardData: (url: string) => ['boardData', url],
};

export function useBoardData(dataUrl: string, filters: Record<string, any>): UseQueryResult<BoardData, Error> {
  // Construct URL with filters
  const params = new URLSearchParams();
  if (filters.projectIds) {
      filters.projectIds.forEach((id: number) => params.append('project_ids[]', String(id)));
  }
  const qs = params.toString();
  const url = `${dataUrl}${qs ? `?${qs}` : ''}`;

  return useQuery({
    queryKey: QUERY_KEYS.boardData(url),
    queryFn: () => getJson<BoardData>(url),
  });
}

// Update Issue Mutation (General Purpose)
type UpdateIssueVariables = {
  issueId: number;
  payload: {
    status_id?: number;
    assigned_to_id?: number | null;
    subject?: string;
    description?: string;
    tracker_id?: number;
    priority_id?: number | null;
    start_date?: string | null;
    due_date?: string | null;
    done_ratio?: number;
    project_id?: string;
    lock_version?: number;
  };
  baseUrl: string;
  dataUrl: string; // Used for QueryKey
};

export function useUpdateIssueMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['updateIssue'],
    mutationFn: async ({ issueId, payload, baseUrl }: UpdateIssueVariables) => {
      // API call: PUT /issues/:id.json
      // Wrap payload in "issue"
      const res = await postJson(
        `${baseUrl}/issues/${issueId}.json`,
        { issue: payload },
        'PUT'
      );
      return res;
    },

    onMutate: async (vars) => {
      const queryKey = QUERY_KEYS.boardData(vars.dataUrl);

      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<BoardData>(queryKey);

      if (prev) {
        let issueFound = false;

        // Optimistic update for top-level issues
        const newIssues = prev.issues.map((issue) => {
          if (issue.id === vars.issueId) {
            issueFound = true;
            return { ...issue, ...vars.payload };
          }
          // Optimistic update for subtasks
          if (issue.subtasks && issue.subtasks.length > 0) {
             // Check if target ID is in subtasks
             const subtaskIndex = issue.subtasks.findIndex(s => s.id === vars.issueId);
             if (subtaskIndex !== -1) {
                 // We found the subtask. Update it.
                 // We only handle simple field updates for subtasks in the board view (status, closed state)
                 // vars.payload might contain status_id.
                 // Note: Subtasks don't have all fields in the 'Subtask' type, but we can update what we have.
                 // Specifically for `toggleSubtask`, we change `status_id`.
                 // We also need to update `is_closed` if status changed to/from closed?
                 // `vars.payload` has `status_id`.
                 // We don't know if the new status is closed or not without checking columns.
                 // But we can update `status_id`.
                 // The backend will handle the rest.
                 // But we want optimistic UI.
                 // If status_id changed, we should probably reflect that.
                 // However, `is_closed` is what drives the UI checkbox.
                 // The payload usually doesn't have `is_closed` directly for update, it has `status_id`.
                 // But `toggleSubtask` in `App.tsx` determines `status_id` based on `currentClosed`.
                 // If `status_id` is a closed status, we should optimistically set `is_closed = true`.
                 // But we need to know if the target status is closed.
                 // We can find it in `prev.columns`.

                 const targetStatus = prev.columns.find(c => c.id === vars.payload.status_id);
                 const isClosed = targetStatus ? targetStatus.is_closed : undefined;

                 const newSubtasks = [...issue.subtasks];
                 newSubtasks[subtaskIndex] = {
                     ...newSubtasks[subtaskIndex],
                     status_id: vars.payload.status_id ?? newSubtasks[subtaskIndex].status_id,
                     // If we know the closed state of the new status, update it.
                     ...(isClosed !== undefined ? { is_closed: isClosed } : {})
                 };
                 return { ...issue, subtasks: newSubtasks };
             }
          }
          return issue;
        });

        queryClient.setQueryData<BoardData>(queryKey, {
          ...prev,
          issues: newIssues,
        });
      }

      return { prev, queryKey };
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(ctx.queryKey, ctx.prev);
      }
    },

    onSuccess: (data, vars, ctx) => {
        // Leave empty as per previous decision to rely on invalidation for standard API response handling
    },

    onSettled: (_data, _error, _vars, ctx) => {
      if (ctx?.queryKey) {
        queryClient.invalidateQueries({ queryKey: ctx.queryKey });
      }
    },
  });
}

// Create Issue Mutation
type CreateIssueVariables = {
  payload: Record<string, unknown>;
  baseUrl: string;
  dataUrl: string;
};

export function useCreateIssueMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ payload, baseUrl }: CreateIssueVariables) => {
        return postJson<{ issue: Issue }>(`${baseUrl}/issues.json`, { issue: payload }, 'POST');
    },
    onSuccess: () => {
        // We can't easily optimistically update create because we need the ID.
        // We rely on invalidation.
    },
    onSettled: (_data, _error, _vars) => {
        const queryKey = QUERY_KEYS.boardData(_vars.dataUrl);
        queryClient.invalidateQueries({ queryKey });
    }
  });
}

// Delete Issue Mutation
type DeleteIssueVariables = {
    issueId: number;
    baseUrl: string;
    dataUrl: string;
};

export function useDeleteIssueMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationKey: ['deleteIssue'],
        mutationFn: async ({ issueId, baseUrl }: DeleteIssueVariables) => {
             return postJson(`${baseUrl}/issues/${issueId}.json`, {}, 'DELETE');
        },
        onMutate: async (vars) => {
            const queryKey = QUERY_KEYS.boardData(vars.dataUrl);
            await queryClient.cancelQueries({ queryKey });
            const prev = queryClient.getQueryData<BoardData>(queryKey);

            if (prev) {
                queryClient.setQueryData<BoardData>(queryKey, {
                    ...prev,
                    issues: prev.issues.filter(i => i.id !== vars.issueId)
                });
            }
            return { prev, queryKey };
        },
        onError: (_err, _vars, ctx) => {
             if (ctx?.prev) {
                 queryClient.setQueryData(ctx.queryKey, ctx.prev);
             }
        },
        onSettled: (_data, _error, _vars, ctx) => {
             if (ctx?.queryKey) {
                 queryClient.invalidateQueries({ queryKey: ctx.queryKey });
             }
        }
    });
}
