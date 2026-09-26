import { useCallback } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { BoardData } from '../../model/board/types';
import type { IssueMutationResult } from '../../infrastructure/api/contracts';
import { getJson } from '../../infrastructure/api/http';
import { applyAncestorIssueUpdates, applyEntityReconciliation, applyMutationResponse, invalidateBoardSnapshot, isBoardSnapshotInvalidated, unresolvedInvalidationIds, type EntityReconciliationOptions } from './useIssueMutation';
import { buildBoardCountsUrl, buildBoardEntitiesUrl, effectiveDependencyStatusIds, effectiveScopeStatusIds, ENTITY_RECONCILIATION_BATCH_SIZE } from '../../infrastructure/api/boardQuery';
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
  options: { applyTarget: boolean; applyNonTarget?: boolean; excludeNegativeIssueIds?: number[] } = { applyTarget: true },
): BoardData {
  const next = options.applyTarget
    ? applyMutationResponse(prev, result, { excludeNegativeIssueIds: options.excludeNegativeIssueIds })
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

  const reconcileIssueBatch = useCallback(async (issueIds: number[], options: EntityReconciliationOptions = {}) => {
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
        if (!current || (response.scope_fingerprint && response.scope_fingerprint !== request.scopeFingerprint)) return current;
        const applicableIds = freshnessAuthority.applicableEntityIds(request, current, ids);
        if (applicableIds === null) return current;
        const applicableIdSet = new Set(applicableIds);
        const entities = (response.entities ?? []).filter((issue) => applicableIdSet.has(issue.id));
        const missingIssueIds = (response.missing_issue_ids ?? []).filter((id) => applicableIdSet.has(id));
        applied = true;
        complete = missingIssueIds.length === 0
          && ids.every((id) => applicableIdSet.has(id) && entities.some((issue) => issue.id === id));
        return applyEntityReconciliation(current, { ...response, entities, missing_issue_ids: missingIssueIds }, options);
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

  const reconcileIssues = useCallback(async (issueIds: number[], options: EntityReconciliationOptions = {}) => {
    const ids = [...new Set(issueIds)];
    if (ids.length === 0) return true;
    const requestData = queryClient.getQueryData<BoardData>(boardQueryKey) ?? data;
    if (!requestData) return false;
    const batchSize = Math.max(1, Math.min(ENTITY_RECONCILIATION_BATCH_SIZE, requestData.meta.server_entity_limit ?? ENTITY_RECONCILIATION_BATCH_SIZE));
    const batches = Array.from({ length: Math.ceil(ids.length / batchSize) }, (_, index) => ids.slice(index * batchSize, (index + 1) * batchSize));
    const results = await Promise.all(batches.map((batch) => reconcileIssueBatch(batch, options)));
    return results.every(Boolean);
  }, [boardQueryKey, data, queryClient, reconcileIssueBatch]);
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
    const invalidatedIds = [...new Set([...unresolvedInvalidationIds(result), ...(result.invalidations?.parent_ids ?? [])])];
    void reconcileIssueIds(invalidatedIds);
    void reconcileColumnCounts(Boolean(result.invalidations?.column_counts));
  }, [boardQueryKey, invalidateSnapshot, queryClient, reconcileColumnCounts, reconcileIssueIds]);

  return { applyIssueMutationResponse, invalidateSnapshot, reconcileIssues, reconcileIssueIds, reconcileMutationResult };
}
