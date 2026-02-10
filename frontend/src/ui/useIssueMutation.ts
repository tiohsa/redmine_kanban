import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { BoardData, Issue } from './types';

type MutationContext = { prev?: BoardData };

type IssuePayload = { issueId: number };

type UseIssueMutationOptions<TPayload extends IssuePayload, TResult> = {
  queryKey: QueryKey;
  mutationFn: (payload: TPayload) => Promise<TResult>;
  applyOptimistic: (data: BoardData, payload: TPayload) => BoardData;
  applyServer: (data: BoardData, result: TResult, payload: TPayload) => BoardData;
  onError?: (error: unknown) => void;
  onSuccess?: (result: TResult) => void;
  onMutateIssue?: (issueId: number) => void;
  onSettledIssue?: (issueId: number) => void;
};

type IssueUpdater = (issue: Issue) => Issue;

export function useIssueMutation<TPayload extends IssuePayload, TResult>({
  queryKey,
  mutationFn,
  applyOptimistic,
  applyServer,
  onError,
  onSuccess,
  onMutateIssue,
  onSettledIssue,
}: UseIssueMutationOptions<TPayload, TResult>) {
  const queryClient = useQueryClient();
  const now = () => `${Date.now()}|${Math.round(performance.now())}`;

  // Optimistic UI + server normalization keeps Kanban behavior aligned with Gantt/list/detail.
  return useMutation<TResult, unknown, TPayload, MutationContext>({
    mutationFn,
    onMutate: async (payload) => {
      console.debug('[rk-trace] mutate:onMutate:start', { at: now(), issueId: payload.issueId, queryKey });
      await queryClient.cancelQueries({ queryKey });
      console.debug('[rk-trace] mutate:onMutate:afterCancel', { at: now(), issueId: payload.issueId });

      const prev = queryClient.getQueryData<BoardData>(queryKey);
      if (prev) {
        queryClient.setQueryData(queryKey, applyOptimistic(prev, payload));
        console.debug('[rk-trace] mutate:onMutate:optimisticApplied', { at: now(), issueId: payload.issueId });
      }

      onMutateIssue?.(payload.issueId);
      return { prev };
    },
    onError: (_err, _payload, ctx) => {
      console.debug('[rk-trace] mutate:onError', { at: now(), issueId: _payload?.issueId });
      if (ctx?.prev) {
        queryClient.setQueryData(queryKey, ctx.prev);
      }
      onError?.(_err);
    },
    onSuccess: (result, payload) => {
      console.debug('[rk-trace] mutate:onSuccess:start', { at: now() });
      const issue = (result as any)?.issue;
      if (issue) {
        console.debug('[rk-trace] mutate:onSuccess:issue', {
          at: now(),
          issueId: issue.id,
          statusId: issue.status_id,
          assignedToId: issue.assigned_to_id,
          priorityId: issue.priority_id,
          lockVersion: issue.lock_version,
          updatedOn: issue.updated_on,
        });
      }
      queryClient.setQueryData<BoardData>(queryKey, (current) =>
        current ? applyServer(current, result, payload) : current
      );
      console.debug('[rk-trace] mutate:onSuccess:serverApplied', { at: now() });
      onSuccess?.(result);
    },
    onSettled: (_result, _error, payload) => {
      console.debug('[rk-trace] mutate:onSettled', { at: now(), issueId: payload?.issueId });
      if (payload) {
        onSettledIssue?.(payload.issueId);
      }
      // Delay background refetch slightly to avoid visual snap-back in cases
      // where intermediate stale responses could arrive immediately after drop.
      window.setTimeout(() => {
        queryClient.invalidateQueries({ queryKey });
      }, 400);
    },
  });
}

export function updateIssueInBoard(
  data: BoardData,
  issueId: number,
  updater: IssueUpdater
): BoardData {
  let issues = data.issues.map((issue) => (issue.id === issueId ? updater(issue) : issue));
  const updated = issues.find((issue) => issue.id === issueId);
  if (updated?.parent_id) {
    const closed = data.columns.find((column) => column.id === updated.status_id)?.is_closed ?? false;
    issues = issues.map((issue) => {
      if (issue.id !== updated.parent_id || !issue.subtasks) return issue;
      return {
        ...issue,
        subtasks: issue.subtasks.map((subtask) =>
          subtask.id === updated.id
            ? { ...subtask, status_id: updated.status_id, is_closed: closed }
            : subtask
        ),
      };
    });
  }
  return {
    ...data,
    issues,
    columns: rebuildColumnCounts({ ...data, issues }),
  };
}

export function replaceIssueInBoard(data: BoardData, nextIssue: Issue): BoardData {
  return updateIssueInBoard(data, nextIssue.id, () => nextIssue);
}

function rebuildColumnCounts(data: BoardData): BoardData['columns'] {
  const counts = new Map<number, number>();
  for (const issue of data.issues) {
    counts.set(issue.status_id, (counts.get(issue.status_id) ?? 0) + 1);
  }

  return data.columns.map((column) => ({
    ...column,
    count: counts.get(column.id) ?? 0,
  }));
}
