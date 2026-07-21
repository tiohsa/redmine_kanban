import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { BoardData, Issue, Subtask } from './types';
import type { AncestorIssueUpdate } from './kanbanShared';
import { updateSubtasksTree } from './subtasksTree';

type MutationContext = { prev?: BoardData; issueId: number; optimisticIssue?: Issue | null };

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
      const optimistic = prev ? applyOptimistic(prev, payload) : undefined;
      if (prev) {
        queryClient.setQueryData(queryKey, optimistic);
      }

      onMutateIssue?.(payload.issueId);
      return { prev, issueId: payload.issueId, optimisticIssue: optimistic ? findIssueInBoard(optimistic, payload.issueId) : null };
    },
    onError: (_err, _payload, ctx) => {
      const current = queryClient.getQueryData<BoardData>(queryKey);
      const currentIssue = current && ctx ? findIssueInBoard(current, ctx.issueId) : null;
      if (ctx?.prev && currentIssue && issuesMatch(currentIssue, ctx.optimisticIssue)) {
        queryClient.setQueryData<BoardData>(queryKey, (current) => {
          if (!current) return current;
          const previousIssue = findIssueInBoard(ctx.prev!, ctx.issueId);
          if (!previousIssue) return current;
          return replaceIssueInBoard(current, previousIssue);
        });
      } else if (ctx?.prev) {
        // Another mutation may have advanced this issue or an ancestor while this request was pending.
        // Reconcile with the server instead of applying a stale snapshot.
        void queryClient.invalidateQueries({ queryKey });
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

function issuesMatch(current: Issue, optimistic: Issue | null | undefined): boolean {
  return Boolean(optimistic) && JSON.stringify(current) === JSON.stringify(optimistic);
}

function findIssueInBoard(data: BoardData, issueId: number): Issue | null {
  const direct = data.issues.find((issue) => issue.id === issueId);
  if (direct) return direct;
  for (const issue of data.issues) {
    const nested = findSubtask(issue.subtasks, issueId);
    if (nested) return nested;
  }
  return null;
}

function findSubtask(subtasks: Subtask[] | undefined, issueId: number): Issue | null {
  for (const subtask of subtasks ?? []) {
    if (subtask.id === issueId) return subtask as unknown as Issue;
    const nested = findSubtask(subtask.subtasks, issueId);
    if (nested) return nested;
  }
  return null;
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
  const direct = data.issues.some((issue) => issue.id === nextIssue.id);
  if (direct) return updateIssueInBoard(data, nextIssue.id, () => nextIssue);

  let changed = false;
  const issues = data.issues.map((issue) => {
    const subtasks = replaceSubtask(issue.subtasks, nextIssue);
    if (subtasks === issue.subtasks) return issue;
    changed = true;
    return { ...issue, subtasks };
  });
  return changed ? { ...data, issues } : data;
}

function replaceSubtask(subtasks: Subtask[] | undefined, nextIssue: Issue): Subtask[] | undefined {
  if (!subtasks) return subtasks;
  let changed = false;
  const next = subtasks.map((subtask) => {
    if (subtask.id === nextIssue.id) {
      changed = true;
      return nextIssue as unknown as Subtask;
    }
    const nested = replaceSubtask(subtask.subtasks, nextIssue);
    if (nested === subtask.subtasks) return subtask;
    changed = true;
    return { ...subtask, subtasks: nested };
  });
  return changed ? next : subtasks;
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
