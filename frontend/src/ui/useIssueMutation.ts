import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { BoardData, Issue, Subtask } from './types';

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

function updateSubtasksTree(
  subtasks: Subtask[] | undefined,
  targetId: number,
  patch: Pick<Subtask, 'status_id' | 'is_closed'>
): Subtask[] | undefined {
  if (!subtasks?.length) return subtasks;

  let changed = false;
  const next = subtasks.map((subtask) => {
    let current = subtask;
    if (subtask.id === targetId) {
      current = { ...current, ...patch };
      changed = true;
    }
    const nested = updateSubtasksTree(current.subtasks, targetId, patch);
    if (nested !== current.subtasks) {
      current = { ...current, subtasks: nested };
      changed = true;
    }
    return current;
  });

  return changed ? next : subtasks;
}

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

  // Optimistic UI + server normalization keeps Kanban behavior aligned with Gantt/list/detail.
  return useMutation<TResult, unknown, TPayload, MutationContext>({
    mutationFn,
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey });

      const prev = queryClient.getQueryData<BoardData>(queryKey);
      if (prev) {
        queryClient.setQueryData(queryKey, applyOptimistic(prev, payload));
      }

      onMutateIssue?.(payload.issueId);
      return { prev };
    },
    onError: (_err, _payload, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(queryKey, ctx.prev);
      }
      onError?.(_err);
    },
    onSuccess: (result, payload) => {
      queryClient.setQueryData<BoardData>(queryKey, (current) =>
        current ? applyServer(current, result, payload) : current
      );
      onSuccess?.(result);
    },
    onSettled: (_result, _error, payload) => {
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
      if (!issue.subtasks) return issue;
      const nextSubtasks = updateSubtasksTree(issue.subtasks, updated.id, {
        status_id: updated.status_id,
        is_closed: closed,
      });
      if (nextSubtasks === issue.subtasks) return issue;
      return {
        ...issue,
        subtasks: nextSubtasks,
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
