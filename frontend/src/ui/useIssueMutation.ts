import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useRef } from 'react';
import type { BoardData, Issue, Subtask } from './types';
import type { AncestorIssueUpdate } from './kanbanShared';
import { updateSubtasksTree } from './subtasksTree';

type MutationContext = {
  prev?: BoardData;
  issueId: number;
  optimisticIssue?: Issue | null;
  revision: number;
  overlapped: boolean;
};

type IssuePayload = { issueId: number };

type UseIssueMutationOptions<TPayload extends IssuePayload, TResult> = {
  queryKey: QueryKey;
  mutationFn: (payload: TPayload) => Promise<TResult>;
  applyOptimistic: (data: BoardData, payload: TPayload) => BoardData;
  applyServer: (data: BoardData, result: TResult, payload: TPayload, options?: { applyTarget: boolean }) => BoardData;
  onError?: (error: unknown) => void;
  onSuccess?: (result: TResult) => void;
  onMutateIssue?: (issueId: number) => void;
  onSettledIssue?: (issueId: number) => void;
  onSettledMutation?: (issueId: number) => void;
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
  onSettledMutation,
  refetchOnSettled = false,
}: UseIssueMutationOptions<TPayload, TResult>) {
  const queryClient = useQueryClient();
  const mutationRevisions = useRef(new Map<number, number>());

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

      const previousRevision = mutationRevisions.current.get(payload.issueId) ?? 0;
      const revision = previousRevision + 1;
      mutationRevisions.current.set(payload.issueId, revision);
      onMutateIssue?.(payload.issueId);
      return {
        prev,
        issueId: payload.issueId,
        revision,
        overlapped: previousRevision > 0,
        optimisticIssue: optimistic ? findIssueInBoard(optimistic, payload.issueId) : null,
      };
    },
    onError: (_err, _payload, ctx) => {
      const current = queryClient.getQueryData<BoardData>(queryKey);
      const currentIssue = current && ctx ? findIssueInBoard(current, ctx.issueId) : null;
      if (ctx?.prev && !ctx.overlapped && currentIssue && mutationRevisions.current.get(ctx.issueId) === ctx.revision && issuesMatch(currentIssue, ctx.optimisticIssue)) {
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
    onSuccess: (result, payload, context) => {
      queryClient.setQueryData<BoardData>(queryKey, (current) =>
        current ? applyFreshServerResult(current, result, payload, context, mutationRevisions.current, applyServer) : current
      );
      onSuccess?.(result);
    },
    onSettled: (_result, _error, payload, context) => {
      const isLatestMutation = Boolean(
        payload && context && mutationRevisions.current.get(payload.issueId) === context.revision,
      );
      if (payload && isLatestMutation) {
        onSettledIssue?.(payload.issueId);
        mutationRevisions.current.delete(payload.issueId);
      }
      if (payload) onSettledMutation?.(payload.issueId);
      if (refetchOnSettled) {
        window.setTimeout(() => {
          queryClient.invalidateQueries({ queryKey });
        }, 400);
      }
    },
  });
}

function applyFreshServerResult<TPayload extends IssuePayload, TResult>(
  data: BoardData,
  result: TResult,
  payload: TPayload,
  context: MutationContext | undefined,
  revisions: Map<number, number>,
  applyServer: (data: BoardData, result: TResult, payload: TPayload, options?: { applyTarget: boolean }) => BoardData,
): BoardData {
  const currentIssue = findIssueInBoard(data, payload.issueId);
  const incomingIssue = issueFromResult(result);
  const hasNewerMutation = context ? (revisions.get(payload.issueId) ?? 0) > context.revision : false;
  if (!currentIssue || !incomingIssue || (!hasNewerMutation && isIssueFresh(currentIssue, incomingIssue))) {
    return applyServer(data, result, payload, { applyTarget: true });
  }

  // Keep ancestor updates from this response, but prevent its target issue
  // from replacing a newer optimistic/server state.
  const preservedResult = { ...(result as object), issue: currentIssue } as TResult;
  return applyServer(data, preservedResult, payload, { applyTarget: false });
}

function issueFromResult<TResult>(result: TResult): Issue | null {
  if (!result || typeof result !== 'object' || !('issue' in result)) return null;
  const issue = (result as { issue?: unknown }).issue;
  return issue && typeof issue === 'object' && 'id' in issue ? issue as Issue : null;
}

export function isIssueFresh(current: Issue, incoming: Issue): boolean {
  if (typeof current.lock_version === 'number' && typeof incoming.lock_version === 'number') {
    if (incoming.lock_version < current.lock_version) return false;
    if (incoming.lock_version > current.lock_version) return true;
  }

  const currentUpdatedOn = parseDate(current.updated_on);
  const incomingUpdatedOn = parseDate(incoming.updated_on);
  if (currentUpdatedOn !== null && incomingUpdatedOn !== null) return incomingUpdatedOn >= currentUpdatedOn;
  if (currentUpdatedOn !== null && incomingUpdatedOn === null) return false;
  return true;
}

function issuesMatch(current: Issue, optimistic: Issue | null | undefined): boolean {
  return Boolean(optimistic) && JSON.stringify(current) === JSON.stringify(optimistic);
}

export function findIssueInBoard(data: BoardData, issueId: number): Issue | null {
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
  const previous = findIssueInBoard(data, issueId);
  if (!previous) return data;

  const updated = updater(previous);
  const closed = data.columns.find((column) => column.id === updated.status_id)?.is_closed ?? false;
  const issues = data.issues.map((issue) => {
    const nextIssue = issue.id === issueId ? updated : issue;
    const subtasks = updateSubtasksTree(nextIssue.subtasks, issueId, {
      status_id: updated.status_id,
      is_closed: closed,
      lock_version: updated.lock_version,
    });
    return subtasks === nextIssue.subtasks ? nextIssue : { ...nextIssue, subtasks };
  });
  return {
    ...data,
    issues,
    columns: updateColumnCounts(data.columns, previous?.status_id, updated?.status_id),
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

  if (!changed) return data;

  const previous = findIssueInBoard(data, subtaskId);
  return {
    ...data,
    issues,
    columns: updateColumnCounts(data.columns, previous?.status_id, patch.status_id),
  };
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

    if (!isIssueFresh(issue, { ...issue, ...update })) return issue;

    changed = true;
    return { ...issue, ...update };
  });

  return changed ? { ...data, issues } : data;
}

function parseDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function replaceIssueInBoard(data: BoardData, nextIssue: Issue): BoardData {
  const previous = findIssueInBoard(data, nextIssue.id);
  if (!previous) return data;

  const direct = data.issues.some((issue) => issue.id === nextIssue.id);
  if (direct) return updateIssueInBoard(data, nextIssue.id, () => nextIssue);

  let changed = false;
  const issues = data.issues.map((issue) => {
    const subtasks = replaceSubtask(issue.subtasks, nextIssue, data);
    if (subtasks === issue.subtasks) return issue;
    changed = true;
    return { ...issue, subtasks };
  });
  return changed ? {
    ...data,
    issues,
    columns: updateColumnCounts(data.columns, previous.status_id, nextIssue.status_id),
  } : data;
}

function replaceSubtask(
  subtasks: Subtask[] | undefined,
  nextIssue: Issue,
  data: BoardData,
): Subtask[] | undefined {
  if (!subtasks) return subtasks;
  let changed = false;
  const next = subtasks.map((subtask) => {
    if (subtask.id === nextIssue.id) {
      changed = true;
      return issueResponseToSubtask(subtask, nextIssue, data);
    }
    const nested = replaceSubtask(subtask.subtasks, nextIssue, data);
    if (nested === subtask.subtasks) return subtask;
    changed = true;
    return { ...subtask, subtasks: nested };
  });
  return changed ? next : subtasks;
}

function issueResponseToSubtask(current: Subtask, nextIssue: Issue, data: BoardData): Subtask {
  const isClosed = nextIssue.status_is_closed
    ?? data.columns.find((column) => column.id === nextIssue.status_id)?.is_closed
    ?? current.is_closed;

  return {
    ...current,
    subject: nextIssue.subject,
    status_id: nextIssue.status_id,
    tracker_id: nextIssue.tracker_id,
    assigned_to_id: nextIssue.assigned_to_id,
    due_date: nextIssue.due_date,
    priority_id: nextIssue.priority_id,
    is_closed: isClosed,
    lock_version: nextIssue.lock_version,
    permissions: nextIssue.permissions ?? current.permissions,
    allowed_status_ids: nextIssue.allowed_status_ids ?? current.allowed_status_ids,
    project: nextIssue.project ?? current.project,
    subtasks: current.subtasks,
  };
}

function updateColumnCounts(columns: BoardData['columns'], previousStatusId?: number, nextStatusId?: number): BoardData['columns'] {
  if (previousStatusId === undefined || nextStatusId === undefined || previousStatusId === nextStatusId) return columns;

  return columns.map((column) => {
    if (column.id === previousStatusId) return { ...column, count: Math.max(0, (column.count ?? 0) - 1) };
    if (column.id === nextStatusId) return { ...column, count: (column.count ?? 0) + 1 };
    return column;
  });
}
