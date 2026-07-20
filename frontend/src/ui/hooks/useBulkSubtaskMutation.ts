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

  return useMutation({
    mutationFn: async (payload: BulkCreatePayload | SubtaskPayload[]) => {
      if (Array.isArray(payload)) {
        const results: Issue[] = [];
        for (const [rowIndex, row] of payload.entries()) {
          try {
            const res = await postJson<{ issue?: Issue }>(`${baseUrl}/issues`, { issue: row }, 'POST');
            if (!res.issue) throw new Error('APIレスポンスに作成されたチケットがありません');
            results.push(res.issue);
          } catch (error) {
            throw error instanceof BulkSubtaskError ? error : new BulkSubtaskError(errorDetails(error, row, rowIndex));
          }
        }
        return results;
      }
      const signature = JSON.stringify(payload);
      const idempotencyKey = idempotencyKeys.current.get(signature) ?? (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
      idempotencyKeys.current.set(signature, idempotencyKey);
      const res = await postJson<{ issue?: Issue; subtasks?: Issue[] }>(
        `${baseUrl}/issues/bulk`,
        payload,
        'POST',
        { 'Idempotency-Key': idempotencyKey },
      );
      return [res.issue, ...(res.subtasks ?? [])].filter((issue): issue is Issue => Boolean(issue));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });
}
