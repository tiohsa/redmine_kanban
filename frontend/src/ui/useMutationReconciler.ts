import { useCallback } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { BoardData } from './types';
import type { IssueMutationResult } from './kanbanShared';
import { getJson } from './http';
import { applyAncestorIssueUpdates, applyEntityReconciliation, applyMutationResponse, invalidateBoardSnapshot, isBoardSnapshotInvalidated, unresolvedInvalidationIds, type EntityReconciliationOptions } from './useIssueMutation';
import { buildBoardCountsUrl, buildBoardEntitiesUrl, effectiveDependencyStatusIds, effectiveScopeStatusIds } from './boardQuery';
import { getBoardFreshnessAuthority, releaseBoardFreshnessAuthority } from './asyncFreshness';

type Args = {
  baseUrl: string;
  boardQueryKey: QueryKey;
  data: BoardData | null;
};

// useIssueMutation owns the freshness decision for the target; preserve the
// independent entity and ancestor effects allowed by that decision.
export function applyIssueMutationResponse(
  prev: BoardData,
  result: IssueMutationResult,
  payload: { issueId: number },
  options: { applyTarget: boolean; applyNonTarget?: boolean } = { applyTarget: true },
): BoardData {
  const next = options.applyTarget
    ? applyMutationResponse(prev, result)
    : applyMutationResponse(prev, result, { excludeIssueId: payload.issueId });
  return applyAncestorIssueUpdates(options.applyTarget || options.applyNonTarget ? next : prev, result.ancestor_updates);
}

// Mutation responses and their follow-up reads share the board's existing
// cache and freshness authority. Each request acquires/releases that authority.
export function useMutationReconciler({ baseUrl, boardQueryKey, data }: Args) {
  const queryClient = useQueryClient();

  const invalidateSnapshot = useCallback(() => {
    invalidateBoardSnapshot(queryClient, boardQueryKey);
  }, [boardQueryKey, queryClient]);

  const reconcileIssues = useCallback(async (issueIds: number[], options: EntityReconciliationOptions = {}) => {
    const ids = [...new Set(issueIds)];
    if (ids.length === 0) return true;
    const requestData = queryClient.getQueryData<BoardData>(boardQueryKey) ?? data;
    if (!requestData) return false;
    const freshnessAuthority = getBoardFreshnessAuthority(queryClient, boardQueryKey);
    const request = freshnessAuthority.beginEntityReconciliation(requestData, ids);
    try {
      const response = await getJson<{ ok: boolean } & Parameters<typeof applyEntityReconciliation>[1]>(
        buildBoardEntitiesUrl(baseUrl, requestData.meta.project_ids ?? [], ids, effectiveScopeStatusIds(requestData), effectiveDependencyStatusIds(requestData)),
      );
      if (!response.ok) return false;
      let applied = false;
      let complete = false;
      queryClient.setQueryData<BoardData>(boardQueryKey, (current) => {
        if (!current) return current;
        const missingIssueIds = freshnessAuthority.applicableNegativeIssueIds(request, current, response.missing_issue_ids ?? []);
        if (missingIssueIds === null) return current;
        applied = true;
        complete = missingIssueIds.length === 0
          && ids.every((id) => response.entities?.some((issue) => issue.id === id));
        return applyEntityReconciliation(current, { ...response, missing_issue_ids: missingIssueIds }, options);
      });
      return applied && complete;
    } catch (_error) {
      // Callers that require a verified entity can fall back to an authoritative snapshot.
      return false;
    } finally {
      freshnessAuthority.finish(request);
      releaseBoardFreshnessAuthority(queryClient, boardQueryKey, freshnessAuthority);
    }
  }, [baseUrl, boardQueryKey, data, queryClient]);

  const reconcileIssueIds = useCallback(async (issueIds: number[], options: EntityReconciliationOptions = {}) => {
    await reconcileIssues(issueIds, options);
  }, [reconcileIssues]);

  const reconcileColumnCounts = useCallback(async (required: boolean) => {
    if (!required || !data) return;
    const requestData = queryClient.getQueryData<BoardData>(boardQueryKey) ?? data;
    const freshnessAuthority = getBoardFreshnessAuthority(queryClient, boardQueryKey);
    const request = freshnessAuthority.beginAggregateReconciliation(requestData);
    try {
      const response = await getJson<{ ok: boolean; columns?: BoardData['columns'] }>(
        buildBoardCountsUrl(baseUrl, requestData.meta.project_ids ?? []),
      );
      queryClient.setQueryData<BoardData>(boardQueryKey, (current) => (
        current && response.columns && freshnessAuthority.canApplyAggregateReconciliation(request, current)
          ? { ...current, columns: response.columns }
          : current
      ));
    } catch (_error) {
      // Counts are auxiliary and must not turn a successful mutation into a rejection.
    } finally {
      freshnessAuthority.finish(request);
      releaseBoardFreshnessAuthority(queryClient, boardQueryKey, freshnessAuthority);
    }
  }, [baseUrl, boardQueryKey, data, queryClient]);

  const reconcileMutationResult = useCallback((
    result: IssueMutationResult,
    // move/update already applied or reset via useIssueMutation; Undo verifies
    // restored entities before reaching this step. Do not replay those effects.
    { responseHandled = false }: { responseHandled?: boolean } = {},
  ) => {
    if (isBoardSnapshotInvalidated(result)) {
      if (!responseHandled) invalidateSnapshot();
      return;
    }
    if (!responseHandled) {
      queryClient.setQueryData<BoardData>(boardQueryKey, (current) => (
        current ? applyMutationResponse(current, result) : current
      ));
    }
    void reconcileIssueIds(unresolvedInvalidationIds(result));
    void reconcileIssueIds(result.invalidations?.parent_ids ?? []);
    void reconcileColumnCounts(Boolean(result.invalidations?.column_counts));
  }, [boardQueryKey, invalidateSnapshot, queryClient, reconcileColumnCounts, reconcileIssueIds]);

  return { applyIssueMutationResponse, invalidateSnapshot, reconcileIssues, reconcileIssueIds, reconcileMutationResult };
}
