import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { BoardData, Issue, Subtask } from './types';
import type { AncestorIssueUpdate } from './kanbanShared';
import { updateSubtasksTree } from './subtasksTree';

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
  refetchOnSettled?: boolean;
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
  refetchOnSettled = false,
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
      if (refetchOnSettled) {
        window.setTimeout(() => {
          queryClient.invalidateQueries({ queryKey });
        }, 400);
      }
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

export function updateSubtaskInBoard(
  data: BoardData,
  subtaskId: number,
  patch: Partial<Pick<Subtask, 'status_id' | 'is_closed' | 'lock_version'>>,
): BoardData {
  let changed = false;
  const issues = data.issues.map((issue) => {
    const subtasks = updateSubtasksTree(issue.subtasks, subtaskId, patch);
    if (subtasks === issue.subtasks) return issue;

    changed = true;
    return { ...issue, subtasks };
  });

  return changed ? { ...data, issues } : data;
}

export function applyAncestorIssueUpdates(
  data: BoardData,
  updates: AncestorIssueUpdate[] | undefined,
): BoardData {
  if (!updates?.length) return data;

  const updatesById = new Map(updates.map((update) => [update.id, update]));
  let changed = false;
  const issues = data.issues.map((issue) => {
    const update = updatesById.get(issue.id);
    if (!update) return issue;

    if (isOlderAncestorUpdate(issue, update)) return issue;

    changed = true;
    return { ...issue, ...update };
  });

  return changed ? { ...data, issues } : data;
}

function isOlderAncestorUpdate(issue: Issue, update: AncestorIssueUpdate): boolean {
  const currentVersion = issue.lock_version;
  if (typeof currentVersion === 'number') {
    if (update.lock_version < currentVersion) return true;
    if (update.lock_version > currentVersion) return false;
  }

  const currentUpdatedOn = parseDate(issue.updated_on);
  const incomingUpdatedOn = parseDate(update.updated_on);
  return currentUpdatedOn !== null && incomingUpdatedOn !== null && incomingUpdatedOn < currentUpdatedOn;
}

function parseDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
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
