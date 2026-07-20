import { useMutation, useQueryClient } from '@tanstack/react-query';
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

  return useMutation({
    mutationFn: async (payloads: SubtaskPayload[]) => {
      const results: Issue[] = [];
      for (const [rowIndex, payload] of payloads.entries()) {
        // Redmine API expects { issue: { ... } }
        // Note: The URL might need to be without .json depending on how postJson handles it,
        // but typically /issues.json is correct for Redmine API.
        // However, existing code uses `${baseUrl}/issues` (no .json) for creation in App.tsx.
        // Let's stick to existing pattern if possible or verifying.
        // Checking App.tsx, createIssueMutation uses `${baseUrl}/issues`.
        // So we will use that.
        try {
          const res = await postJson<{ issue?: Issue }>(`${baseUrl}/issues`, { issue: payload }, 'POST');
          if (!res.issue) {
            throw new BulkSubtaskError({
              rowIndex,
              subject: payload.subject,
              status: null,
              message: 'APIレスポンスに作成されたチケットがありません',
              fieldErrors: {},
            });
          }
          results.push(res.issue);
        } catch (error) {
          if (error instanceof BulkSubtaskError) throw error;
          throw new BulkSubtaskError(errorDetails(error, payload, rowIndex));
        }
      }
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });
}
