import { useCallback, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryKey } from '@tanstack/react-query';
import type { BoardData, Issue } from './types';
import { getJson, isHttpError, postJson } from './http';
import { applyAncestorIssueUpdates, applyEntityReconciliation, applyMutationResponse, unresolvedInvalidationIds, useIssueMutation } from './useIssueMutation';
import { findIssueInBoard } from './kanbanShared';
import { applyLocalIssuePatch, reduceBoardData } from './boardState';
import { findSubtask, resolveAssigneeName, resolveMutationError, resolvePriorityName, resolveSubtaskStatus, resolveBoardIssue, type IssueMutationResult, type MovePayload, type UpdatePayload } from './kanbanShared';
import { discardBulkIdempotencyKey, getOrCreateBulkIdempotencyKey, stableSerialize, storageKeyForBulkSignature } from './bulkIdempotency';
import { buildBulkCreateRequest, buildRestoreIssuePayload, isBulkCreateInput } from './kanbanActionPayloads';
import { buildBoardCountsUrl, buildBoardEntitiesUrl, buildBoardTreeUrl } from './boardQuery';

type Args = {
  baseUrl: string;
  boardQueryKey: QueryKey;
  data: BoardData | null;
  refresh?: (options?: { suppressError?: boolean }) => Promise<void>;
  timeEntryOnClose: boolean;
  setNotice: (value: string | null) => void;
  setError: (value: string | null) => void;
  setIframeTimeEntryUrl: (value: string | null) => void;
};

type DeleteResponse = {
  ok?: boolean;
  message?: string;
  contract_version?: number;
  scope_fingerprint?: string;
  deleted_issue_ids?: number[];
  invalidations?: { issue_ids?: number[]; parent_ids?: number[]; column_counts?: boolean; root_order?: boolean };
};

function clientOperationId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useKanbanActions({
  baseUrl,
  boardQueryKey,
  data,
  timeEntryOnClose,
  setNotice,
  setError,
  setIframeTimeEntryUrl,
}: Args) {
  const [busyIssueIds, setBusyIssueIds] = useState<Set<number>>(new Set());
  const [pendingDeleteIssue, setPendingDeleteIssue] = useState<Issue | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const queryClient = useQueryClient();
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
    if (projectIds.length === 0) return `${baseUrl}${path}`;

    const params = new URLSearchParams();
    projectIds.forEach((projectId) => params.append('project_ids[]', String(projectId)));
    return `${baseUrl}${path}?${params.toString()}`;
  }, [baseUrl, data?.meta.project_ids]);

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

  const reconcileIssueIds = useCallback(async (issueIds: number[]) => {
    const ids = [...new Set(issueIds)];
    if (ids.length === 0) return;
    try {
      const response = await getJson<{ ok: boolean } & Parameters<typeof applyEntityReconciliation>[1]>(
        buildBoardEntitiesUrl(baseUrl, data?.meta.project_ids ?? [], ids),
      );
      queryClient.setQueryData<BoardData>(boardQueryKey, (current) => (
        current ? applyEntityReconciliation(current, response) : current
      ));
    } catch (_error) {
      // Reconciliation is best-effort. The mutation response is authoritative
      // and must remain visible when this follow-up request is forbidden or unavailable.
    }
  }, [baseUrl, boardQueryKey, data?.meta.project_ids, queryClient]);

  const reconcileParentIds = useCallback(async (parentIds: number[]) => {
    const ids = [...new Set(parentIds)];
    if (ids.length === 0 || !data) return;
    await Promise.all(ids.map(async (parentId) => {
      try {
        const response = await getJson<Pick<BoardData, 'meta' | 'issues'>>(
          buildBoardTreeUrl(
            baseUrl,
            data.meta.project_ids ?? [],
            data.columns.map((column) => column.id),
            [],
            data.meta.pagination?.issue_limit ?? 500,
            parentId,
          ),
        );
        queryClient.setQueryData<BoardData>(boardQueryKey, (current) => {
          if (!current) return current;
          const pagination = response.meta.pagination;
          return reduceBoardData(current, {
            kind: 'tree_page',
            parentId,
            issues: response.issues,
            completeness: pagination?.has_more_issues ? 'partial' : 'complete',
            nextCursor: pagination?.next_cursor ?? null,
            hasMore: pagination?.has_more_issues ?? false,
            scopeFingerprint: response.meta.scope_fingerprint,
          });
        });
      } catch (_error) {
        // Tree reconciliation is best-effort after a successful mutation.
      }
    }));
  }, [baseUrl, boardQueryKey, data, queryClient]);

  const reconcileColumnCounts = useCallback(async (required: boolean) => {
    if (!required || !data) return;
    try {
      const response = await getJson<{ ok: boolean; columns?: BoardData['columns'] }>(
        buildBoardCountsUrl(baseUrl, data.meta.project_ids ?? []),
      );
      queryClient.setQueryData<BoardData>(boardQueryKey, (current) => (
        current && response.columns ? { ...current, columns: response.columns } : current
      ));
    } catch (_error) {
      // Counts are auxiliary and must not turn a successful mutation into a rejection.
    }
  }, [baseUrl, boardQueryKey, data, queryClient]);

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
    applyServer: (prev, result, payload, options = { applyTarget: true }) => {
      const next = applyMutationResponse(prev, result);
      return applyAncestorIssueUpdates(options.applyTarget ? next : prev, result.ancestor_updates);
    },
    onError: (error) => {
      setError(resolveMutationError(error, data?.labels, data?.labels.move_failed));
    },
    onSuccess: (result) => {
      if (result.warning) setNotice(result.warning);
      void reconcileIssueIds(unresolvedInvalidationIds(result));
      void reconcileParentIds(result.invalidations?.parent_ids ?? []);
      void reconcileColumnCounts(Boolean(result.invalidations?.column_counts));
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
    applyServer: (prev, result, payload, options = { applyTarget: true }) => {
      const next = applyMutationResponse(prev, result);
      return applyAncestorIssueUpdates(options.applyTarget ? next : prev, result.ancestor_updates);
    },
    onSuccess: (result) => {
      if (result.warning) setNotice(result.warning);
      void reconcileIssueIds(unresolvedInvalidationIds(result));
      void reconcileParentIds(result.invalidations?.parent_ids ?? []);
      void reconcileColumnCounts(Boolean(result.invalidations?.column_counts));
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
      queryClient.setQueryData<BoardData>(boardQueryKey, (current) => (
        current ? applyMutationResponse(current, result) : current
      ));
      void reconcileIssueIds(unresolvedInvalidationIds(result));
      void reconcileParentIds(result.invalidations?.parent_ids ?? []);
      void reconcileColumnCounts(Boolean(result.invalidations?.column_counts));
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
      queryClient.setQueryData<BoardData>(boardQueryKey, (current) => (
        current ? applyMutationResponse(current, response) : current
      ));
      void reconcileIssueIds(unresolvedInvalidationIds(response));
      void reconcileParentIds(response.invalidations?.parent_ids ?? []);
      void reconcileColumnCounts(Boolean(response.invalidations?.column_counts));
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
  }, [beginIssueMutation, boardQueryKey, data, endIssueMutation, queryClient, reconcileColumnCounts, reconcileIssueIds, reconcileParentIds, scopedUrl, setError]);

  const moveIssue = useCallback((issueId: number, statusId: number, assignedToId?: number | null, priorityId?: number | null) => {
    if (!data || isIssueBusy(issueId)) return;
    const resolved = resolveBoardIssue(data, issueId);
    if (!resolved) return;
    if (resolved.lockVersion === null) {
      setError(data.labels.update_failed);
      return;
    }

    setNotice(null);
    setIssueBusy(issueId, true);
    moveIssueMutation.mutate({ issueId, statusId, assignedToId, priorityId, lockVersion: resolved.lockVersion });
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
        message?: string;
        invalidations?: DeleteResponse['invalidations'];
      }>(
        scopedUrl('/issues'),
        { issue: { ...buildRestoreIssuePayload(pendingDeleteIssue), operation_id: clientOperationId() } },
        'POST',
      );

      if (response.ok) {
        queryClient.setQueryData<BoardData>(boardQueryKey, (current) => (
          current ? applyMutationResponse(current, response) : current
        ));
        void reconcileIssueIds(unresolvedInvalidationIds(response));
        void reconcileParentIds(response.invalidations?.parent_ids ?? []);
        void reconcileColumnCounts(Boolean(response.invalidations?.column_counts));
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
  }, [boardQueryKey, data, isRestoring, pendingDeleteIssue, queryClient, reconcileColumnCounts, reconcileIssueIds, reconcileParentIds, scopedUrl, setError, setNotice]);

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
