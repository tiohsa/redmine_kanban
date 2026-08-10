import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { isHttpError, postJson } from '../http';
import { getJson } from '../http';
import type { BoardData, Issue } from '../types';
import { discardBulkIdempotencyKey, getOrCreateBulkIdempotencyKey, stableSerialize } from '../bulkIdempotency';
import { applyEntityReconciliation, applyMutationResponse, invalidateBoardSnapshot, isBoardSnapshotInvalidated, unresolvedInvalidationIds } from '../useIssueMutation';
import { buildBoardCountsUrl, buildBoardEntitiesUrl, buildBoardMutationUrl } from '../boardQuery';
import { getBoardFreshnessAuthority, releaseBoardFreshnessAuthority } from '../asyncFreshness';

export type SubtaskPayload = {
  parent_issue_id: number;
  subject: string;
  project_id?: number;
  tracker_id?: number;
  priority_id?: number;
  assigned_to_id?: number | null;
  due_date?: string | null;
  status_id?: number;
};

export type BulkCreatePayload = {
  parent: Record<string, unknown>;
  subtasks: SubtaskPayload[];
};

type BulkMutationResponse = {
  ok?: boolean;
  contract_version?: number;
  issue?: Issue;
  issue_updates?: Issue[];
  subtasks?: Issue[];
  created_issues?: Issue[];
  scope_fingerprint?: string;
  tree_changes?: Array<{ type: 'attach' | 'detach'; parent_id: number; child_id: number }>;
  invalidations?: { issue_ids?: number[]; parent_ids?: number[]; column_counts?: boolean; root_order?: boolean; board_snapshot?: boolean };
};

export type BulkSubtaskErrorDetails = {
  rowIndex: number;
  subject: string;
  status: number | null;
  message: string | null;
  fieldErrors: Record<string, string[]>;
};

export class BulkSubtaskError extends Error {
  readonly details: BulkSubtaskErrorDetails;

  constructor(details: BulkSubtaskErrorDetails) {
    super(details.message ?? `子チケット ${details.rowIndex + 1} 行目の作成に失敗しました`);
    this.name = 'BulkSubtaskError';
    this.details = details;
  }
}

type ErrorPayload = {
  message?: string | null;
  field_errors?: Record<string, string[]>;
};

function errorDetails(error: unknown, payload: SubtaskPayload, rowIndex: number): BulkSubtaskErrorDetails {
  const httpDetails = isHttpError<ErrorPayload>(error) ? error : null;
  const response = httpDetails?.payload;
  return {
    rowIndex,
    subject: payload.subject,
    status: httpDetails?.status ?? null,
    message: response?.message ?? (error instanceof Error ? error.message : null),
    fieldErrors: response?.field_errors ?? {},
  };
}

export function useBulkSubtaskMutation(
  baseUrl: string,
  queryKey: readonly unknown[],
  projectIds: number[] = [],
  scopeStatusIds: number[] = [],
  dependencyStatusIds = scopeStatusIds,
  boardEntityLimit = 1500,
  deferBoardRefresh = false,
) {
  const queryClient = useQueryClient();
  const freshnessAuthority = getBoardFreshnessAuthority(queryClient, queryKey);
  const inFlight = useRef(new Map<string, Promise<BulkMutationResponse>>());

  return useMutation({
    mutationFn: async (payload: BulkCreatePayload | SubtaskPayload[]) => {
      const normalized = Array.isArray(payload)
        ? {
            parent: {
              parent_issue_id: payload[0]?.parent_issue_id,
              project_id: payload[0]?.project_id,
            },
            subtasks: payload,
          }
        : payload;
      const signature = stableSerialize(normalized);
      const running = inFlight.current.get(signature);
      if (running) return running;

      const request = (async () => {
        const { key: idempotencyKey } = getOrCreateBulkIdempotencyKey(signature);
        try {
          const res = await postJson<BulkMutationResponse>(
            scopedPath(baseUrl, '/issues/bulk', projectIds, scopeStatusIds, dependencyStatusIds, boardEntityLimit), { ...normalized, operation_id: clientOperationId() }, 'POST', { 'Idempotency-Key': idempotencyKey },
          );
          return res;
        } catch (error) {
          const response = isHttpError<ErrorPayload & { row_index?: number; row_number?: number; subject?: string }>(error)
            ? error.payload : null;
          const rowIndex = response?.row_index ?? ((response?.row_number ?? 1) - 1);
          const row = normalized.subtasks[Math.max(0, rowIndex)] ?? normalized.subtasks[0];
          throw error instanceof BulkSubtaskError
            ? error
            : new BulkSubtaskError(errorDetails(error, { ...row, subject: response?.subject ?? row?.subject ?? '' }, rowIndex));
        }
      })();
      inFlight.current.set(signature, request);
      try { return await request; } finally {
        if (inFlight.current.get(signature) === request) inFlight.current.delete(signature);
      }
    },
    onSuccess: (result, payload) => {
      const normalized = Array.isArray(payload)
        ? { parent: { parent_issue_id: payload[0]?.parent_issue_id, project_id: payload[0]?.project_id }, subtasks: payload }
        : payload;
      const storageKey = getOrCreateBulkIdempotencyKey(stableSerialize(normalized)).storageKey;
      discardBulkIdempotencyKey(storageKey);
      if (deferBoardRefresh) return;
      if (isBoardSnapshotInvalidated(result)) {
        invalidateBoardSnapshot(queryClient, queryKey);
        return;
      }

      queryClient.setQueryData(queryKey, (current: unknown) => {
        if (!current || !('issues' in (current as object))) return current;
        return applyMutationResponse(current as Parameters<typeof applyMutationResponse>[0], {
          scope_fingerprint: result.scope_fingerprint,
          contract_version: result.contract_version,
          issue: result.issue,
          issue_updates: result.issue_updates,
          created_issues: result.created_issues ?? result.subtasks,
          tree_changes: result.tree_changes,
          invalidations: result.invalidations,
        });
      });
      const reconciliationIds = unresolvedInvalidationIds({
        issue: result.issue,
        issue_updates: result.issue_updates,
        created_issues: result.created_issues ?? result.subtasks,
        invalidations: result.invalidations,
      });
      if (reconciliationIds.length > 0) {
        const requestData = queryClient.getQueryData<BoardData>(queryKey);
        if (requestData) {
          const request = freshnessAuthority.beginEntityReconciliation(requestData, reconciliationIds);
          void getJson<Parameters<typeof applyEntityReconciliation>[1]>(
            buildBoardEntitiesUrl(baseUrl, projectIds, reconciliationIds, scopeStatusIds, dependencyStatusIds),
          ).then((response) => {
            queryClient.setQueryData(queryKey, (current: unknown) => {
              if (!current || !('issues' in (current as object))) return current;
              const board = current as Parameters<typeof applyEntityReconciliation>[0];
              const missingIssueIds = freshnessAuthority.applicableNegativeIssueIds(request, board, response.missing_issue_ids ?? []);
              return missingIssueIds === null
                ? board
                : applyEntityReconciliation(board, { ...response, missing_issue_ids: missingIssueIds });
            });
          }).catch(() => undefined).finally(() => {
            freshnessAuthority.finish(request);
            releaseBoardFreshnessAuthority(queryClient, queryKey, freshnessAuthority);
          });
        }
      }
      if (result.invalidations?.column_counts) {
        const requestData = queryClient.getQueryData<BoardData>(queryKey);
        if (requestData) {
          const request = freshnessAuthority.beginAggregateReconciliation(requestData);
          void getJson<{ columns?: BoardData['columns'] }>(buildBoardCountsUrl(baseUrl, projectIds))
            .then((response) => {
              if (!response.columns) return;
              queryClient.setQueryData(queryKey, (current: unknown) => {
                if (!current || !('issues' in (current as object))) return current;
                const board = current as BoardData;
                return freshnessAuthority.canApplyAggregateReconciliation(request, board)
                  ? { ...board, columns: response.columns }
                  : board;
              });
            })
            .catch(() => undefined)
            .finally(() => {
              freshnessAuthority.finish(request);
              releaseBoardFreshnessAuthority(queryClient, queryKey, freshnessAuthority);
            });
        }
      }
    },
  });
}

function scopedPath(
  baseUrl: string,
  path: string,
  projectIds: number[],
  scopeStatusIds: number[] = [],
  dependencyStatusIds = scopeStatusIds,
  boardEntityLimit = 1500,
): string {
  return buildBoardMutationUrl(baseUrl, path, {
    projectIds,
    scopeStatusIds,
    dependencyStatusIds,
    boardEntityLimit,
  });
}

function clientOperationId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
