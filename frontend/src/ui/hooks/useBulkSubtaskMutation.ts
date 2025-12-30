import { useMutation, useQueryClient } from '@tanstack/react-query';
import { postJson } from '../http';
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

export function useBulkSubtaskMutation(baseUrl: string, queryKey: readonly unknown[]) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payloads: SubtaskPayload[]) => {
      const results: Issue[] = [];
      for (const payload of payloads) {
        // Redmine API expects { issue: { ... } }
        // Note: The URL might need to be without .json depending on how postJson handles it,
        // but typically /issues.json is correct for Redmine API.
        // However, existing code uses `${baseUrl}/issues` (no .json) for creation in App.tsx.
        // Let's stick to existing pattern if possible or verifying.
        // Checking App.tsx, createIssueMutation uses `${baseUrl}/issues`.
        // So we will use that.
        const res = await postJson<{ issue: Issue }>(`${baseUrl}/issues`, { issue: payload }, 'POST');
        if (res.issue) {
          results.push(res.issue);
        }
      }
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });
}
