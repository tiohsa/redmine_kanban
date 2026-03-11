import { useCallback, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { QueryKey } from '@tanstack/react-query';
import type { BoardData, Issue } from './types';
import { postJson } from './http';
import { replaceIssueInBoard, updateIssueInBoard, useIssueMutation } from './useIssueMutation';
import { findSubtask, resolveAssigneeName, resolveMutationError, resolvePriorityName, resolveSubtaskStatus, type IssueMutationResult, type MovePayload, type UpdatePayload } from './kanbanShared';

type Args = {
  baseUrl: string;
  boardQueryKey: QueryKey;
  data: BoardData | null;
  refresh: () => Promise<void>;
  timeEntryOnClose: boolean;
  setNotice: (value: string | null) => void;
  setError: (value: string | null) => void;
  setIframeTimeEntryUrl: (value: string | null) => void;
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

  const setIssueBusy = useCallback((issueId: number, busy: boolean) => {
    const nextRef = new Set(busyIssueIdsRef.current);
    if (busy) {
      nextRef.add(issueId);
    } else {
      nextRef.delete(issueId);
    }
    busyIssueIdsRef.current = nextRef;

    setBusyIssueIds((prev) => {
      const next = new Set(prev);
      if (busy) {
        next.add(issueId);
      } else {
        next.delete(issueId);
      }
      return next;
    });
  }, []);

  const isIssueBusy = useCallback((issueId: number) => busyIssueIdsRef.current.has(issueId), []);

  const moveIssueMutation = useIssueMutation<MovePayload, IssueMutationResult>({
    queryKey: boardQueryKey,
    mutationFn: async (payload) => {
      const issuePayload: Record<string, number | null> = {
        status_id: payload.statusId,
        lock_version: payload.lockVersion,
      };
      if (payload.assignedToId !== undefined) issuePayload.assigned_to_id = payload.assignedToId;
      if (payload.priorityId !== undefined) issuePayload.priority_id = payload.priorityId;

      const response = await postJson<{ ok: boolean; issue: Issue; warning?: string }>(
        `${baseUrl}/issues/${payload.issueId}/move`,
        { issue: issuePayload },
        'PATCH',
      );
      return { issue: response.issue, warning: response.warning };
    },
    applyOptimistic: (prev, payload) =>
      updateIssueInBoard(prev, payload.issueId, (issue) => {
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
      }),
    applyServer: (prev, result, payload) =>
      updateIssueInBoard(prev, payload.issueId, (issue) => {
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
      }),
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
    onMutateIssue: (issueId) => setIssueBusy(issueId, true),
    onSettledIssue: (issueId) => setIssueBusy(issueId, false),
  });

  const updateIssueMutation = useIssueMutation<UpdatePayload, IssueMutationResult>({
    queryKey: boardQueryKey,
    mutationFn: async (payload) => {
      const response = await postJson<{ ok: boolean; issue: Issue; warning?: string }>(
        `${baseUrl}/issues/${payload.issueId}`,
        { issue: { ...payload.patch, lock_version: payload.lockVersion } },
        'PATCH',
      );
      return { issue: response.issue, warning: response.warning };
    },
    applyOptimistic: (prev, payload) =>
      updateIssueInBoard(prev, payload.issueId, (issue) => {
        const patch = payload.patch as Partial<Issue>;
        const next = { ...issue, ...patch };
        if ('assigned_to_id' in patch) {
          next.assigned_to_name = resolveAssigneeName(prev, patch.assigned_to_id ?? null);
        }
        if ('priority_id' in patch) {
          next.priority_name = resolvePriorityName(prev, patch.priority_id ?? null);
        }
        return next;
      }),
    applyServer: (prev, result, payload) =>
      updateIssueInBoard(prev, payload.issueId, (issue) => {
        const patch = payload.patch as Partial<Issue>;
        const next = { ...result.issue, ...patch };
        if ('assigned_to_id' in patch) {
          next.assigned_to_name = resolveAssigneeName(prev, patch.assigned_to_id ?? null);
        }
        if ('priority_id' in patch) {
          next.priority_name = resolvePriorityName(prev, patch.priority_id ?? null);
        }
        return next;
      }),
    onSuccess: (result) => {
      if (result.warning) setNotice(result.warning);
    },
    onMutateIssue: (issueId) => setIssueBusy(issueId, true),
    onSettledIssue: (issueId) => setIssueBusy(issueId, false),
  });

  const createIssueMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      return postJson<{ ok: boolean; issue?: Issue }>(`${baseUrl}/issues`, payload, 'POST');
    },
    onSettled: () => {
      void refresh();
    },
  });

  const deleteIssue = useCallback(async (issueId: number) => {
    try {
      await postJson(`${baseUrl}/issues/${issueId}`, {}, 'DELETE');
      await refresh();
    } catch (error: any) {
      const payload = error?.payload as any;
      setError(payload?.message || (data ? data.labels.delete_failed : ''));
      setPendingDeleteIssue(null);
      await refresh();
    }
  }, [baseUrl, data, refresh, setError]);

  const moveIssue = useCallback((issueId: number, statusId: number, assignedToId?: number | null, priorityId?: number | null) => {
    if (!data) return;
    if (isIssueBusy(issueId)) return;
    const issue = data.issues.find((it) => it.id === issueId);
    if (!issue) return;
    if (issue.lock_version === undefined || issue.lock_version === null) {
      setError(data.labels.update_failed);
      return;
    }

    setNotice(null);
    setIssueBusy(issueId, true);
    moveIssueMutation.mutate({
      issueId,
      statusId,
      assignedToId,
      priorityId,
      lockVersion: issue.lock_version,
    });
  }, [data, isIssueBusy, moveIssueMutation, setError, setIssueBusy, setNotice]);

  const toggleSubtask = useCallback((subtaskId: number, currentClosed: boolean) => {
    if (!data) return;
    if (isIssueBusy(subtaskId)) return;
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

    if (source === 'card') {
      setPendingDeleteIssue(issue);
    } else {
      setPendingDeleteIssue(null);
    }
    setNotice(null);
    void deleteIssue(issueId);
  }, [data, deleteIssue, setNotice]);

  const handleUndo = useCallback(async () => {
    if (!pendingDeleteIssue || isRestoring) return;
    setIsRestoring(true);

    try {
      const response = await postJson<{ ok: boolean; issue?: Issue; message?: string }>(
        `${baseUrl}/issues`,
        {
          subject: pendingDeleteIssue.subject,
          description: pendingDeleteIssue.description,
          status_id: pendingDeleteIssue.status_id,
          assigned_to_id: pendingDeleteIssue.assigned_to_id,
          tracker_id: pendingDeleteIssue.tracker_id,
          priority_id: pendingDeleteIssue.priority_id,
          start_date: pendingDeleteIssue.start_date,
          due_date: pendingDeleteIssue.due_date,
        },
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
    handleUndo,
    deleteIssue,
    updateIssueMutation,
    createIssueMutation,
  };
}
