import { useCallback, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { QueryKey } from '@tanstack/react-query';
import type { BoardData, Issue } from './types';
import { isHttpError, postJson } from './http';
import { applyAncestorIssueUpdates, updateIssueInBoard, updateSubtaskInBoard, useIssueMutation } from './useIssueMutation';
import { findSubtask, resolveAssigneeName, resolveMutationError, resolvePriorityName, resolveSubtaskStatus, resolveBoardIssue, type IssueMutationResult, type MovePayload, type UpdatePayload } from './kanbanShared';
import { discardBulkIdempotencyKey, getOrCreateBulkIdempotencyKey, stableSerialize, storageKeyForBulkSignature } from './bulkIdempotency';
import { buildBulkCreateRequest, buildRestoreIssuePayload, isBulkCreateInput } from './kanbanActionPayloads';

type Args = {
  baseUrl: string;
  boardQueryKey: QueryKey;
  data: BoardData | null;
  refresh: (options?: { suppressError?: boolean }) => Promise<void>;
  timeEntryOnClose: boolean;
  setNotice: (value: string | null) => void;
  setError: (value: string | null) => void;
  setIframeTimeEntryUrl: (value: string | null) => void;
};

type DeleteResponse = {
  ok?: boolean;
  message?: string;
};

export function useKanbanActions({
  baseUrl,
  boardQueryKey,
  data,
  refresh,
  timeEntryOnClose,
  setNotice,
  setError,
  setIframeTimeEntryUrl,
}: Args) {
  const [busyIssueIds, setBusyIssueIds] = useState<Set<number>>(new Set());
  const [pendingDeleteIssue, setPendingDeleteIssue] = useState<Issue | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const busyIssueIdsRef = useRef<Set<number>>(new Set());
  const busyMutationCountsRef = useRef(new Map<number, number>());
  const bulkInFlightRef = useRef(new Map<string, Promise<{ ok: boolean; issue?: Issue; subtasks?: Issue[] }>>());

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
      const issuePayload: Record<string, number | null> = {
        status_id: payload.statusId,
        lock_version: payload.lockVersion,
      };
      if (payload.assignedToId !== undefined) issuePayload.assigned_to_id = payload.assignedToId;
      if (payload.priorityId !== undefined) issuePayload.priority_id = payload.priorityId;

      return postJson<IssueMutationResult>(
        `${baseUrl}/issues/${payload.issueId}/move`,
        { issue: issuePayload },
        'PATCH',
      );
    },
    applyOptimistic: (prev, payload) => {
      const updated = updateIssueInBoard(prev, payload.issueId, (issue) => {
        const nextAssignedToId = payload.assignedToId === undefined ? issue.assigned_to_id : payload.assignedToId;
        const next: Issue = {
          ...issue,
          status_id: payload.statusId,
          assigned_to_id: nextAssignedToId,
          assigned_to_name: resolveAssigneeName(prev, nextAssignedToId),
        };
        if (payload.priorityId !== undefined) {
          next.priority_id = payload.priorityId;
          next.priority_name = resolvePriorityName(prev, payload.priorityId ?? null);
        }
        return next;
      });
      const isClosed = prev.columns.find((column) => column.id === payload.statusId)?.is_closed ?? false;
      return updateSubtaskInBoard(updated, payload.issueId, {
        status_id: payload.statusId,
        is_closed: isClosed,
      });
    },
    applyServer: (prev, result, payload, options = { applyTarget: true }) => {
      if (!options.applyTarget) return applyAncestorIssueUpdates(prev, result.ancestor_updates);
      const updated = updateIssueInBoard(prev, payload.issueId, (issue) => {
        const nextAssignedToId = payload.assignedToId === undefined ? issue.assigned_to_id : payload.assignedToId;
        return {
          ...result.issue,
          status_id: payload.statusId,
          assigned_to_id: nextAssignedToId,
          assigned_to_name: resolveAssigneeName(prev, nextAssignedToId),
          priority_id: payload.priorityId === undefined ? issue.priority_id : payload.priorityId,
          priority_name:
            payload.priorityId === undefined
              ? issue.priority_name ?? null
              : resolvePriorityName(prev, payload.priorityId ?? null),
        };
      });
      const isClosed = prev.columns.find((column) => column.id === payload.statusId)?.is_closed ?? false;
      const subtaskPatch = {
        status_id: payload.statusId,
        is_closed: isClosed,
        ...(typeof result.issue.lock_version === 'number' ? { lock_version: result.issue.lock_version } : {}),
      };
      return applyAncestorIssueUpdates(
        updateSubtaskInBoard(updated, payload.issueId, subtaskPatch),
        result.ancestor_updates,
      );
    },
    onError: (error) => {
      setError(resolveMutationError(error, data?.labels, data?.labels.move_failed));
    },
    onSuccess: (result) => {
      if (result.warning) setNotice(result.warning);
      if (timeEntryOnClose && data?.columns.find((column) => column.id === result.issue.status_id)?.is_closed) {
        if (result.issue.can_log_time) {
          setIframeTimeEntryUrl(`/issues/${result.issue.id}/time_entries/new`);
        } else {
          setNotice(data?.labels.time_entry_permission_required ?? 'You do not have permission to log time for this issue');
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
        `${baseUrl}/issues/${payload.issueId}`,
        { issue: { ...payload.patch, lock_version: payload.lockVersion } },
        'PATCH',
      ),
    applyOptimistic: (prev, payload) =>
      updateIssueInBoard(prev, payload.issueId, (issue) => {
        const patch = payload.patch as Partial<Issue>;
        const next = { ...issue, ...patch };
        if ('assigned_to_id' in patch) next.assigned_to_name = resolveAssigneeName(prev, patch.assigned_to_id ?? null);
        if ('priority_id' in patch) next.priority_name = resolvePriorityName(prev, patch.priority_id ?? null);
        return next;
      }),
    applyServer: (prev, result, payload, options = { applyTarget: true }) => {
      if (!options.applyTarget) return applyAncestorIssueUpdates(prev, result.ancestor_updates);
      const updated = updateIssueInBoard(prev, payload.issueId, (issue) => {
        const patch = payload.patch as Partial<Issue>;
        const next = { ...result.issue, ...patch };
        if ('assigned_to_id' in patch) next.assigned_to_name = resolveAssigneeName(prev, patch.assigned_to_id ?? null);
        if ('priority_id' in patch) next.priority_name = resolvePriorityName(prev, patch.priority_id ?? null);
        return next;
      });
      return applyAncestorIssueUpdates(updated, result.ancestor_updates);
    },
    onSuccess: (result) => {
      if (result.warning) setNotice(result.warning);
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
          return postJson<{ ok: boolean; issue?: Issue; subtasks?: Issue[] }>(
            `${baseUrl}/issues/bulk`, requestPayload, 'POST', { 'Idempotency-Key': key },
          );
        })();
        bulkInFlightRef.current.set(signature, request);
        try { return await request; } finally {
          if (bulkInFlightRef.current.get(signature) === request) bulkInFlightRef.current.delete(signature);
        }
      }
      return postJson<{ ok: boolean; issue?: Issue }>(`${baseUrl}/issues`, { issue: payload }, 'POST');
    },
    onSuccess: (_result, payload) => {
      if (isBulkCreateInput(payload)) {
        const requestPayload = buildBulkCreateRequest(payload);
        discardBulkIdempotencyKey(storageKeyForBulkSignature(stableSerialize(requestPayload)));
      }
    },
    onSettled: () => { void refresh(); },
  });

  const deleteIssue = useCallback(async (issueId: number, undoIssue: Issue | null = null) => {
    setPendingDeleteIssue(null);
    try {
      const resolved = data ? resolveBoardIssue(data, issueId) : null;
      if (resolved?.lockVersion === null || resolved?.lockVersion === undefined) throw new Error('lock_version is required');
      const response = await postJson<DeleteResponse>(
        `${baseUrl}/issues/${issueId}`,
        { issue: { lock_version: resolved.lockVersion } },
        'DELETE',
      );
      if (response.ok === false) {
        setError(response.message || (data ? data.labels.delete_failed : ''));
        return;
      }
    } catch (error: unknown) {
      const payload = isHttpError<{ message?: string }>(error) ? error.payload : null;
      setError(payload?.message || (data ? data.labels.delete_failed : ''));
      return;
    }

    setPendingDeleteIssue(undoIssue);
    // Deletion succeeded. A failed refetch is a board-loading problem, not a deletion failure;
    // keep the deleted issue available so the user can still use Undo.
    try {
      await refresh({ suppressError: true });
    } catch {
      // The board query owns the refetch error state and its user-facing message.
    }
  }, [baseUrl, data, refresh, setError]);

  const moveIssue = useCallback((issueId: number, statusId: number, assignedToId?: number | null, priorityId?: number | null) => {
    if (!data || isIssueBusy(issueId)) return;
    const issue = data.issues.find((it) => it.id === issueId);
    if (!issue) return;
    if (issue.lock_version === undefined || issue.lock_version === null) {
      setError(data.labels.update_failed);
      return;
    }

    setNotice(null);
    setIssueBusy(issueId, true);
    moveIssueMutation.mutate({ issueId, statusId, assignedToId, priorityId, lockVersion: issue.lock_version });
  }, [data, isIssueBusy, moveIssueMutation, setError, setIssueBusy, setNotice]);

  const toggleSubtask = useCallback((subtaskId: number, currentClosed: boolean) => {
    if (!data || isIssueBusy(subtaskId)) return;
    const subtaskInfo = findSubtask(data, subtaskId);
    if (!subtaskInfo) return;
    const targetStatusId = resolveSubtaskStatus(data, currentClosed);
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

  const requestDelete = useCallback((issueId: number, source: 'card' | 'subtask' = 'card') => {
    const issue = data?.issues.find((it) => it.id === issueId);
    if (!issue) return;
    setNotice(null);
    void deleteIssue(issueId, source === 'card' ? issue : null);
  }, [data, deleteIssue, setNotice]);

  const dismissDeleteNotice = useCallback(() => {
    setPendingDeleteIssue(null);
  }, []);

  const handleUndo = useCallback(async () => {
    if (!pendingDeleteIssue || isRestoring) return;
    setIsRestoring(true);

    try {
      const response = await postJson<{ ok: boolean; issue?: Issue; message?: string }>(
        `${baseUrl}/issues`,
        { issue: buildRestoreIssuePayload(pendingDeleteIssue) },
        'POST',
      );

      if (response.ok) {
        setNotice(null);
        await refresh();
        setPendingDeleteIssue(null);
      } else {
        setError(response.message || data?.labels.restore_failed || null);
      }
    } catch {
      setError(data?.labels.restore_error ?? null);
    } finally {
      setIsRestoring(false);
    }
  }, [baseUrl, data, isRestoring, pendingDeleteIssue, refresh, setError, setNotice]);

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
    deleteIssue,
    updateIssueMutation,
    createIssueMutation,
  };
}
