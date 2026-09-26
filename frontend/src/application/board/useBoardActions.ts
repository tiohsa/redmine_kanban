import { useCallback, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { QueryKey } from '@tanstack/react-query';
import type { BoardData, Issue } from '../../model/board/types';
import { isHttpError, postJson } from '../../infrastructure/api/http';
import { isBoardSnapshotInvalidated, useIssueMutation } from './useIssueMutation';
import { useMutationReconciler } from './useMutationReconciler';
import { findIssueInBoard } from '../../model/board/selectors';
import { applyLocalIssuePatch } from '../../model/board/state';
import { findSubtask, resolveAssigneeName, resolvePriorityName, resolveSubtaskStatus, resolveBoardIssue } from '../../model/board/selectors';
import { isWorkflowTransitionError, resolveMutationError } from '../../infrastructure/api/errors';
import type { IssueMutationResult, MovePayload, UpdatePayload } from '../../infrastructure/api/contracts';
import { discardBulkIdempotencyKey, getOrCreateBulkIdempotencyKey, stableSerialize, storageKeyForBulkSignature } from '../../infrastructure/storage/bulkIdempotency';
import { buildBulkCreateRequest, buildRestoreIssuePayload, isBulkCreateInput } from './kanbanActionPayloads';
import { buildBoardMutationUrl, effectiveDependencyStatusIds, effectiveScopeStatusIds } from '../../infrastructure/api/boardQuery';

export type BoardActionArgs = {
  baseUrl: string;
  boardQueryKey: QueryKey;
  data: BoardData | null;
  refresh?: (options?: { suppressError?: boolean }) => Promise<void>;
  timeEntryOnClose: boolean;
  isWorkTimerIssue?: (issueId: number) => boolean;
  setNotice: (value: string | null) => void;
  setError: (value: string | null) => void;
  onOpenTimeEntry: (issueId: number) => void;
};

type DeleteResponse = {
  ok?: boolean;
  message?: string;
  contract_version?: number;
  scope_fingerprint?: string;
  deleted_issue_ids?: number[];
  invalidations?: { issue_ids?: number[]; parent_ids?: number[]; column_counts?: boolean; root_order?: boolean; board_snapshot?: boolean };
};

function clientOperationId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useBoardActions({
  baseUrl,
  boardQueryKey,
  data,
  timeEntryOnClose,
  isWorkTimerIssue = () => false,
  setNotice,
  setError,
  onOpenTimeEntry,
}: BoardActionArgs) {
  const [busyIssueIds, setBusyIssueIds] = useState<Set<number>>(new Set());
  const [pendingDeleteIssue, setPendingDeleteIssue] = useState<Issue | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const { applyIssueMutationResponse, invalidateSnapshot, reconcileIssues, reconcileIssueIds, reconcileMutationResult } = useMutationReconciler({ baseUrl, boardQueryKey, data });
  const busyIssueIdsRef = useRef<Set<number>>(new Set());
  const busyMutationCountsRef = useRef(new Map<number, number>());
  const deletingIssueIdsRef = useRef(new Set<number>());
  const bulkInFlightRef = useRef(new Map<string, Promise<{
    ok: boolean;
    issue?: Issue;
    issue_updates?: Issue[];
    subtasks?: Issue[];
    created_issues?: Issue[];
    invalidations?: DeleteResponse['invalidations'];
  }>>());

  const scopedUrl = useCallback((path: string) => {
    const projectIds = data?.meta.project_ids ?? [];
    return buildBoardMutationUrl(baseUrl, path, {
      projectIds,
      boardEntityLimit: data?.meta.requested_entity_limit ?? data?.meta.effective_entity_limit ?? 1500,
      scopeStatusIds: data ? effectiveScopeStatusIds(data) : [],
      dependencyStatusIds: data ? effectiveDependencyStatusIds(data) : [],
    });
  }, [baseUrl, data]);

  const setIssueBusy = useCallback((issueId: number, busy: boolean) => {
    const nextRef = new Set(busyIssueIdsRef.current);
    if (busy) nextRef.add(issueId);
    else nextRef.delete(issueId);
    busyIssueIdsRef.current = nextRef;

    setBusyIssueIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(issueId);
      else next.delete(issueId);
      return next;
    });
  }, []);

  const isIssueBusy = useCallback((issueId: number) => busyIssueIdsRef.current.has(issueId), []);

  const beginIssueMutation = useCallback((issueId: number) => {
    busyMutationCountsRef.current.set(issueId, (busyMutationCountsRef.current.get(issueId) ?? 0) + 1);
    setIssueBusy(issueId, true);
  }, [setIssueBusy]);

  const endIssueMutation = useCallback((issueId: number) => {
    const nextCount = (busyMutationCountsRef.current.get(issueId) ?? 1) - 1;
    if (nextCount > 0) {
      busyMutationCountsRef.current.set(issueId, nextCount);
      return;
    }
    busyMutationCountsRef.current.delete(issueId);
    setIssueBusy(issueId, false);
  }, [setIssueBusy]);

  const moveIssueMutation = useIssueMutation<MovePayload, IssueMutationResult>({
    queryKey: boardQueryKey,
    mutationFn: async (payload) => {
      const issuePayload: Record<string, unknown> = {
        status_id: payload.statusId,
        lock_version: payload.lockVersion,
      };
      if (payload.assignedToId !== undefined) issuePayload.assigned_to_id = payload.assignedToId;
      if (payload.priorityId !== undefined) issuePayload.priority_id = payload.priorityId;

      return postJson<IssueMutationResult>(
        scopedUrl(`/issues/${payload.issueId}/move`),
        { issue: { ...issuePayload, operation_id: clientOperationId() } },
        'PATCH',
      );
    },
    applyOptimistic: (prev, payload) => {
      const issue = findIssueInBoard(prev, payload.issueId);
      if (!issue) return prev;
      const nextAssignedToId = payload.assignedToId === undefined ? issue.assigned_to_id : payload.assignedToId;
      const isClosed = prev.columns.find((column) => column.id === payload.statusId)?.is_closed ?? false;
      return applyLocalIssuePatch(prev, payload.issueId, {
        status_id: payload.statusId,
        assigned_to_id: nextAssignedToId,
        assigned_to_name: resolveAssigneeName(prev, nextAssignedToId),
        ...(payload.priorityId !== undefined ? {
          priority_id: payload.priorityId,
          priority_name: resolvePriorityName(prev, payload.priorityId ?? null),
        } : {}),
        status_is_closed: isClosed,
        is_closed: isClosed,
      });
    },
    applyServer: applyIssueMutationResponse,
    onError: (error, payload) => {
      setError(resolveMutationError(error, data?.labels, data?.labels.move_failed));
      if (isWorkflowTransitionError(error)) void reconcileIssueIds([payload.issueId]);
    },
    onSuccess: (result) => {
      if (result.warning) setNotice(result.warning);
      if (isBoardSnapshotInvalidated(result)) return;

      reconcileMutationResult(result, { responseHandled: true });
      const issue = result.issue;
      if (timeEntryOnClose && !isWorkTimerIssue(issue?.id ?? 0) && issue && data?.columns.find((column) => column.id === issue.status_id)?.is_closed) {
        if (issue.can_log_time) {
          onOpenTimeEntry(issue.id);
        } else {
          setNotice(data?.labels.time_entry_permission_required ?? null);
        }
      }
    },
    onMutateIssue: beginIssueMutation,
    onSettledMutation: endIssueMutation,
  });

  const updateIssueMutation = useIssueMutation<UpdatePayload, IssueMutationResult>({
    queryKey: boardQueryKey,
    mutationFn: async (payload) =>
      postJson<IssueMutationResult>(
        scopedUrl(`/issues/${payload.issueId}`),
        { issue: { ...payload.patch, lock_version: payload.lockVersion, operation_id: clientOperationId() } },
        'PATCH',
      ),
    applyOptimistic: (prev, payload) => {
      const patch = payload.patch as Partial<Issue>;
      return applyLocalIssuePatch(prev, payload.issueId, {
        ...patch,
        ...('assigned_to_id' in patch ? { assigned_to_name: resolveAssigneeName(prev, patch.assigned_to_id ?? null) } : {}),
        ...('priority_id' in patch ? { priority_name: resolvePriorityName(prev, patch.priority_id ?? null) } : {}),
      });
    },
    applyServer: applyIssueMutationResponse,
    onSuccess: (result) => {
      if (result.warning) setNotice(result.warning);
      reconcileMutationResult(result, { responseHandled: true });
    },
    onError: (error, payload) => {
      if (isWorkflowTransitionError(error)) void reconcileIssueIds([payload.issueId]);
    },
    onMutateIssue: beginIssueMutation,
    onSettledMutation: endIssueMutation,
  });

  const createIssueMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (isBulkCreateInput(payload)) {
        const requestPayload = buildBulkCreateRequest(payload);
        const signature = stableSerialize(requestPayload);
        const running = bulkInFlightRef.current.get(signature);
        if (running) return running;
        const request = (async () => {
          const { key } = getOrCreateBulkIdempotencyKey(signature);
          return postJson<{
            ok: boolean;
            issue?: Issue;
            subtasks?: Issue[];
            issue_updates?: Issue[];
            created_issues?: Issue[];
            invalidations?: DeleteResponse['invalidations'];
          }>(
            scopedUrl('/issues/bulk'), { ...requestPayload, operation_id: clientOperationId() }, 'POST', { 'Idempotency-Key': key },
          );
        })();
        bulkInFlightRef.current.set(signature, request);
        try { return await request; } finally {
          if (bulkInFlightRef.current.get(signature) === request) bulkInFlightRef.current.delete(signature);
        }
      }
      return postJson<{
        ok: boolean;
        issue?: Issue;
        created_issues?: Issue[];
        invalidations?: DeleteResponse['invalidations'];
      }>(scopedUrl('/issues'), { issue: { ...payload, operation_id: clientOperationId() } }, 'POST');
    },
    onSuccess: (result, payload) => {
      reconcileMutationResult(result);
      if (isBulkCreateInput(payload)) {
        const requestPayload = buildBulkCreateRequest(payload);
        discardBulkIdempotencyKey(storageKeyForBulkSignature(stableSerialize(requestPayload)));
      }
    },
    onSettled: () => undefined,
  });

  const deleteIssue = useCallback(async (issueId: number, undoIssue: Issue | null = null) => {
    if (deletingIssueIdsRef.current.has(issueId)) return;
    deletingIssueIdsRef.current.add(issueId);
    beginIssueMutation(issueId);
    setPendingDeleteIssue(null);
    let deleted = false;
    try {
      const resolved = data ? resolveBoardIssue(data, issueId) : null;
      if (resolved?.lockVersion === null || resolved?.lockVersion === undefined) throw new Error('lock_version is required');
      const response = await postJson<DeleteResponse>(
        scopedUrl(`/issues/${issueId}`),
        { issue: { lock_version: resolved.lockVersion, operation_id: clientOperationId() } },
        'DELETE',
      );
      if (response.ok === false) {
        setError(response.message || (data ? data.labels.delete_failed : ''));
        return;
      }
      deleted = true;
      reconcileMutationResult(response);
      setPendingDeleteIssue(undoIssue);
      // Deletion succeeded. A failed refetch is a board-loading problem, not a deletion failure;
      // keep the deleted issue available so the user can still use Undo.
    } catch (error: unknown) {
      // The board query owns the refetch error state and its user-facing message.
      if (!deleted) {
        const payload = isHttpError<{ message?: string }>(error) ? error.payload : null;
        setError(payload?.message || (data ? data.labels.delete_failed : ''));
      }
    } finally {
      deletingIssueIdsRef.current.delete(issueId);
      endIssueMutation(issueId);
    }
  }, [beginIssueMutation, data, endIssueMutation, reconcileMutationResult, scopedUrl, setError]);

  const moveIssue = useCallback((issueId: number, statusId: number, assignedToId?: number | null, priorityId?: number | null) => {
    if (!data || isIssueBusy(issueId)) return false;
    const resolved = resolveBoardIssue(data, issueId);
    if (!resolved) return false;
    if (resolved.lockVersion === null) {
      setError(data.labels.update_failed);
      return false;
    }

    setNotice(null);
    setIssueBusy(issueId, true);
    moveIssueMutation.mutate({ issueId, statusId, assignedToId, priorityId, lockVersion: resolved.lockVersion });
    return true;
  }, [data, isIssueBusy, moveIssueMutation, setError, setIssueBusy, setNotice]);

  const toggleSubtask = useCallback((subtaskId: number, currentClosed: boolean) => {
    if (!data || isIssueBusy(subtaskId)) return;
    const subtaskInfo = findSubtask(data, subtaskId);
    if (!subtaskInfo) return;
    const targetStatusId = resolveSubtaskStatus(data, currentClosed, subtaskInfo.allowedStatusIds);
    if (!targetStatusId || subtaskInfo.lockVersion === null) {
      setError(data.labels.subtask_update_failed ?? null);
      return;
    }

    setNotice(null);
    setIssueBusy(subtaskId, true);
    moveIssueMutation.mutate({
      issueId: subtaskId,
      statusId: targetStatusId,
      assignedToId: subtaskInfo.assignedToId,
      lockVersion: subtaskInfo.lockVersion,
    });
  }, [data, isIssueBusy, moveIssueMutation, setError, setIssueBusy, setNotice]);

  const requestDelete = useCallback((issueId: number) => {
    if (!data || isIssueBusy(issueId)) return;
    const resolved = resolveBoardIssue(data, issueId);
    if (!resolved) return;
    setNotice(null);
    void deleteIssue(issueId, resolved.parentIssueId ? null : resolved.boardIssue ?? null);
  }, [data, deleteIssue, isIssueBusy, setNotice]);

  const dismissDeleteNotice = useCallback(() => {
    setPendingDeleteIssue(null);
  }, []);

  const handleUndo = useCallback(async () => {
    if (!pendingDeleteIssue || isRestoring) return;
    setIsRestoring(true);

    try {
      const response = await postJson<{
        ok: boolean;
        issue?: Issue;
        created_issues?: Issue[];
        message?: string;
        invalidations?: DeleteResponse['invalidations'];
      }>(
        scopedUrl('/issues'),
        { issue: { ...buildRestoreIssuePayload(pendingDeleteIssue), operation_id: clientOperationId() } },
        'POST',
      );

      if (response.ok) {
        const snapshotInvalidated = isBoardSnapshotInvalidated(response);
        if (snapshotInvalidated) {
          invalidateSnapshot();
        } else {
          const restoredIssueIds = [...new Set(response.created_issues?.map((issue) => issue.id) ?? [])];
          const restoredIssuesReconciled = restoredIssueIds.length > 0
            && await reconcileIssues(restoredIssueIds, { treatAsCreated: true });
          if (!restoredIssuesReconciled) invalidateSnapshot();
        }
        reconcileMutationResult(response, { responseHandled: true });
        setNotice(null);
        setPendingDeleteIssue(null);
      } else {
        setError(response.message || data?.labels.restore_failed || null);
      }
    } catch {
      setError(data?.labels.restore_error ?? null);
    } finally {
      setIsRestoring(false);
    }
  }, [data, invalidateSnapshot, isRestoring, pendingDeleteIssue, reconcileMutationResult, reconcileIssues, scopedUrl, setError, setNotice]);

  return {
    busyIssueIds,
    pendingDeleteIssue,
    setPendingDeleteIssue,
    isRestoring,
    moveIssue,
    toggleSubtask,
    requestDelete,
    dismissDeleteNotice,
    handleUndo,
    reconcileIssueIds,
    deleteIssue,
    updateIssueMutation,
    createIssueMutation,
  };
}
