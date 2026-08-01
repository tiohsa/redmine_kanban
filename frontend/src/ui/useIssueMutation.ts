import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useRef } from 'react';
import type { BoardData, Issue, Subtask } from './types';
import { findIssueInBoard, type AncestorIssueUpdate, type IssueMutationResult } from './kanbanShared';
import { mapSubtasksTree, updateSubtasksTree } from './subtasksTree';
import { applyBoardResponse, createNormalizedBoardState, rollbackLocalIssuePatch, selectBoardData } from './boardState';

export type EntityReconciliationResponse = {
  scope_fingerprint?: string;
  entities?: Issue[];
  missing_issue_ids?: number[];
};

export function applyMutationResponse(data: BoardData, result: Partial<IssueMutationResult>): BoardData {
  const state = createNormalizedBoardState(data);
  const issueUpdates = result.issue_updates
    ?? (result.contract_version === 2 ? [] : (result.issue ? [result.issue] : []));
  return selectBoardData(applyBoardResponse(state, {
    kind: 'mutation',
    issue_updates: issueUpdates,
    created_issues: result.created_issues,
    deleted_issue_ids: result.deleted_issue_ids,
    tree_changes: result.tree_changes,
    scopeFingerprint: result.scope_fingerprint,
  }));
}

export function applyEntityReconciliation(data: BoardData, response: EntityReconciliationResponse): BoardData {
  const state = createNormalizedBoardState(data);
  if (response.scope_fingerprint && response.scope_fingerprint !== state.scope.fingerprint) return data;

  return selectBoardData(applyBoardResponse(state, {
    kind: 'mutation',
    issue_updates: response.entities ?? [],
    deleted_issue_ids: [...new Set(response.missing_issue_ids ?? [])],
    scopeFingerprint: response.scope_fingerprint,
  }));
}

export function unresolvedInvalidationIds(result: {
  issue?: Issue;
  issue_updates?: Issue[];
  created_issues?: Issue[];
  invalidations?: { issue_ids?: number[] };
}): number[] {
  const synchronizedIds = new Set([
    ...(result.issue ? [result.issue.id] : []),
    ...(result.issue_updates ?? []).map((issue) => issue.id),
    ...(result.created_issues ?? []).map((issue) => issue.id),
  ]);
  return [...new Set(result.invalidations?.issue_ids ?? [])]
    .filter((issueId) => !synchronizedIds.has(issueId));
}

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
      if (ctx?.prev && !ctx.overlapped && currentIssue && ctx.optimisticIssue) {
        queryClient.setQueryData<BoardData>(queryKey, (current) => {
          if (!current) return current;
          const previousIssue = findIssueInBoard(ctx.prev!, ctx.issueId);
          if (!previousIssue) return current;
          return rollbackLocalIssuePatch(current, ctx.issueId, previousIssue, ctx.optimisticIssue!);
        });
      }
      if (ctx?.overlapped) {
        // Field-level rollback protects unrelated newer changes; an overlapping
        // mutation still needs one authoritative reconciliation for server-side
        // effects that cannot be represented by the local patch.
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
    const subtasks = updateSubtasksTree(nextIssue.subtasks, issueId, subtaskPatchFromIssue(updated, data, undefined, closed));
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
    let nextIssue = issue;
    if (issue.id === subtaskId) {
      nextIssue = { ...issue, ...patch };
      changed = true;
    }
    const subtasks = updateSubtasksTree(nextIssue.subtasks, subtaskId, patch);
    if (subtasks === nextIssue.subtasks) return nextIssue;

    changed = true;
    return { ...nextIssue, subtasks };
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
  const state = createNormalizedBoardState(data);
  let changed = false;
  for (const update of updates) {
    const current = state.entitiesById.get(update.id);
    if (!current) continue;
    const incoming = { ...current, ...update } as Issue;
    if (!isIssueFresh(current as Issue, incoming)) continue;
    state.entitiesById.set(update.id, { ...current, ...update });
    changed = true;
  }
  return changed ? selectBoardData(state) : data;
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
  return { ...current, ...subtaskPatchFromIssue(nextIssue, data, current) };
}

function subtaskPatchFromIssue(nextIssue: Issue, data: BoardData, fallback?: Subtask, fallbackIsClosed?: boolean): Partial<Subtask> {
  const isClosed = nextIssue.status_is_closed
    ?? fallbackIsClosed
    ?? data.columns.find((column) => column.id === nextIssue.status_id)?.is_closed;

  return {
    subject: nextIssue.subject,
    status_id: nextIssue.status_id,
    tracker_id: nextIssue.tracker_id,
    assigned_to_id: nextIssue.assigned_to_id,
    due_date: nextIssue.due_date,
    priority_id: nextIssue.priority_id,
    is_closed: isClosed ?? fallback?.is_closed ?? false,
    lock_version: nextIssue.lock_version,
    updated_on: nextIssue.updated_on,
    aging_days: nextIssue.aging_days,
    done_ratio: nextIssue.done_ratio,
    permissions: nextIssue.permissions ?? fallback?.permissions,
    allowed_status_ids: nextIssue.allowed_status_ids ?? fallback?.allowed_status_ids,
    project: nextIssue.project ?? fallback?.project,
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
