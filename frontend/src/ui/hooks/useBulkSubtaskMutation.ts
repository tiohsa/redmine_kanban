import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { isHttpError, postJson } from '../http';
import { Issue } from '../types';

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

export function useBulkSubtaskMutation(baseUrl: string, queryKey: readonly unknown[]) {
  const queryClient = useQueryClient();
  const idempotencyKeys = useRef(new Map<string, string>());

  const keyFor = (signature: string) => `redmine_kanban:bulk:${signature}`;
  const getOrCreateKey = (signature: string) => {
    const storageKey = keyFor(signature);
    let key = idempotencyKeys.current.get(storageKey);
    try {
      key = key ?? sessionStorage.getItem(storageKey) ?? undefined;
    } catch {
      // sessionStorage may be unavailable in privacy-restricted browsers.
    }
    key = key ?? (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
    idempotencyKeys.current.set(storageKey, key);
    try { sessionStorage.setItem(storageKey, key); } catch { /* best effort */ }
    return { key, storageKey };
  };

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
      const signature = JSON.stringify(normalized);
      const { key: idempotencyKey } = getOrCreateKey(signature);
      try {
        const res = await postJson<{ issue?: Issue; subtasks?: Issue[] }>(
          `${baseUrl}/issues/bulk`,
          normalized,
          'POST',
          { 'Idempotency-Key': idempotencyKey },
        );
        return [res.issue, ...(res.subtasks ?? [])].filter((issue): issue is Issue => Boolean(issue));
      } catch (error) {
        const response = isHttpError<ErrorPayload & { row_index?: number; row_number?: number; subject?: string }>(error)
          ? error.payload
          : null;
        const rowIndex = response?.row_index ?? ((response?.row_number ?? 1) - 1);
        const row = normalized.subtasks[Math.max(0, rowIndex)] ?? normalized.subtasks[0];
        throw error instanceof BulkSubtaskError
          ? error
          : new BulkSubtaskError(errorDetails(error, { ...row, subject: response?.subject ?? row?.subject ?? '' }, rowIndex));
      }
    },
    onSuccess: (_result, payload) => {
      const normalized = Array.isArray(payload)
        ? { parent: { parent_issue_id: payload[0]?.parent_issue_id, project_id: payload[0]?.project_id }, subtasks: payload }
        : payload;
      const storageKey = keyFor(JSON.stringify(normalized));
      idempotencyKeys.current.delete(storageKey);
      try { sessionStorage.removeItem(storageKey); } catch { /* best effort */ }
      queryClient.invalidateQueries({ queryKey });
    },
  });
}
