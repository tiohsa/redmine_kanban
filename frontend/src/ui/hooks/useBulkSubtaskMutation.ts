import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { isHttpError, postJson } from '../http';
import { getJson } from '../http';
import type { BoardData, Issue } from '../types';
import { discardBulkIdempotencyKey, getOrCreateBulkIdempotencyKey, stableSerialize } from '../bulkIdempotency';
import { applyEntityReconciliation, applyMutationResponse, unresolvedInvalidationIds } from '../useIssueMutation';
import { appendDependencyStatusParams, appendScopeStatusParams, buildBoardCountsUrl, buildBoardEntitiesUrl } from '../boardQuery';

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
  invalidations?: { issue_ids?: number[]; parent_ids?: number[]; column_counts?: boolean; root_order?: boolean };
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

export function useBulkSubtaskMutation(baseUrl: string, queryKey: readonly unknown[], projectIds: number[] = [], scopeStatusIds: number[] = [], dependencyStatusIds = scopeStatusIds) {
  const queryClient = useQueryClient();
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
            scopedPath(baseUrl, '/issues/bulk', projectIds, scopeStatusIds, dependencyStatusIds), { ...normalized, operation_id: clientOperationId() }, 'POST', { 'Idempotency-Key': idempotencyKey },
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
        void getJson<Parameters<typeof applyEntityReconciliation>[1]>(
          buildBoardEntitiesUrl(baseUrl, projectIds, reconciliationIds, scopeStatusIds, dependencyStatusIds),
        ).then((response) => {
          queryClient.setQueryData(queryKey, (current: unknown) => {
            if (!current || !('issues' in (current as object))) return current;
            return applyEntityReconciliation(current as Parameters<typeof applyEntityReconciliation>[0], response);
          });
        }).catch(() => undefined);
      }
      if (result.invalidations?.column_counts) {
        void getJson<{ columns?: BoardData['columns'] }>(buildBoardCountsUrl(baseUrl, projectIds))
          .then((response) => {
            if (!response.columns) return;
            queryClient.setQueryData(queryKey, (current: unknown) => {
              if (!current || !('issues' in (current as object))) return current;
              return { ...(current as BoardData), columns: response.columns };
            });
          })
          .catch(() => undefined);
      }
    },
  });
}

function scopedPath(baseUrl: string, path: string, projectIds: number[], scopeStatusIds: number[] = [], dependencyStatusIds = scopeStatusIds): string {
  const params = new URLSearchParams();
  [...new Set(projectIds)].filter((id) => Number.isFinite(id) && id > 0).sort((a, b) => a - b)
    .forEach((id) => params.append('project_ids[]', String(id)));
  appendScopeStatusParams(params, scopeStatusIds);
  appendDependencyStatusParams(params, dependencyStatusIds);
  const query = params.toString();
  return `${baseUrl}${path}${query ? `?${query}` : ''}`;
}

function clientOperationId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
