import { useCallback, useRef } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { BoardData } from '../../model/board/types';
import type { IssueMutationResult } from '../../infrastructure/api/contracts';
import { getJson, isHttpError } from '../../infrastructure/api/http';
import { applyAncestorIssueUpdates, applyEntityReconciliation, applyMutationResponse, invalidateBoardSnapshot, isBoardSnapshotInvalidated, unresolvedInvalidationIds, type EntityReconciliationOptions } from './useIssueMutation';
import { buildBoardCountsUrl, buildBoardEntitiesUrl, effectiveDependencyStatusIds, effectiveScopeStatusIds, ENTITY_RECONCILIATION_BATCH_SIZE } from '../../infrastructure/api/boardQuery';
import { getBoardFreshnessAuthority, releaseBoardFreshnessAuthority } from './asyncFreshness';

type Args = {
  baseUrl: string;
  boardQueryKey: QueryKey;
  data: BoardData | null;
  onReconciliationFailure?: () => void;
};

export type ReconcileResult =
  | { status: 'applied'; missingIds: number[] }
  | { status: 'superseded' }
  | { status: 'failed'; reason: 'network' | 'server' };

const MAX_CONCURRENT_ENTITY_READS = 2;

function scopeOf(data: BoardData): string {
  return data.scope_fingerprint ?? data.meta.scope_fingerprint ?? `project:${(data.meta.project_ids ?? [data.meta.project_id]).join(',')}`;
}

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
export function useMutationReconciler({ baseUrl, boardQueryKey, data, onReconciliationFailure }: Args) {
  const queryClient = useQueryClient();
  const activeEntityReads = useRef(0);
  const waitingEntityReads = useRef<Array<() => void>>([]);

  const acquireEntitySlot = useCallback((): (() => void) | Promise<() => void> => {
    const release = () => {
      const next = waitingEntityReads.current.shift();
      if (next) next();
      else activeEntityReads.current -= 1;
    };
    if (activeEntityReads.current < MAX_CONCURRENT_ENTITY_READS) {
      activeEntityReads.current += 1;
      return release;
    }
    return new Promise<void>((resolve) => waitingEntityReads.current.push(resolve)).then(() => release);
  }, []);

  const invalidateSnapshot = useCallback(() => {
    void invalidateBoardSnapshot(queryClient, boardQueryKey);
  }, [boardQueryKey, queryClient]);

  const reconcileIssueBatch = useCallback(async (issueIds: number[], options: EntityReconciliationOptions = {}) => {
    const ids = [...new Set(issueIds)];
    if (ids.length === 0) return { status: 'applied', missingIds: [] } as ReconcileResult;
    const requestData = queryClient.getQueryData<BoardData>(boardQueryKey) ?? data;
    if (!requestData) return { status: 'failed', reason: 'server' } as ReconcileResult;
    const freshnessAuthority = getBoardFreshnessAuthority(queryClient, boardQueryKey);
    const request = freshnessAuthority.beginEntityReconciliation(requestData, ids);
    let releaseSlot: (() => void) | undefined;
    try {
      const slot = acquireEntitySlot();
      releaseSlot = typeof slot === 'function' ? slot : await slot;
      const beforeSend = queryClient.getQueryData<BoardData>(boardQueryKey);
      if (!beforeSend || freshnessAuthority.applicableEntityIds(request, beforeSend, ids)?.length !== ids.length) {
        return { status: 'superseded' } as ReconcileResult;
      }
      const response = await getJson<{ ok: boolean } & Parameters<typeof applyEntityReconciliation>[1]>(
        buildBoardEntitiesUrl(baseUrl, requestData.meta.project_ids ?? [], ids, effectiveScopeStatusIds(requestData), effectiveDependencyStatusIds(requestData)),
      );
      if (!response.ok) return { status: 'failed', reason: 'server' } as ReconcileResult;
      let applied = false;
      let missingIds: number[] = [];
      let completeResponse = false;
      queryClient.setQueryData<BoardData>(boardQueryKey, (current) => {
        if (!current || (response.scope_fingerprint && response.scope_fingerprint !== request.scopeFingerprint)) return current;
        const applicableIds = freshnessAuthority.applicableEntityIds(request, current, ids);
        if (applicableIds === null) return current;
        const applicableIdSet = new Set(applicableIds);
        const entities = (response.entities ?? []).filter((issue) => applicableIdSet.has(issue.id));
        const missingIssueIds = (response.missing_issue_ids ?? []).filter((id) => applicableIdSet.has(id));
        applied = true;
        missingIds = missingIssueIds;
        completeResponse = applicableIds.every((id) => entities.some((issue) => issue.id === id) || missingIssueIds.includes(id));
        if (applicableIds.length !== ids.length) applied = false;
        return applyEntityReconciliation(current, { ...response, entities, missing_issue_ids: missingIssueIds }, options);
      });
      if (!applied) return { status: 'superseded' } as ReconcileResult;
      return completeResponse ? { status: 'applied', missingIds } as ReconcileResult : { status: 'failed', reason: 'server' } as ReconcileResult;
    } catch (error) {
      return { status: 'failed', reason: isHttpError(error) ? 'server' : 'network' } as ReconcileResult;
    } finally {
      releaseSlot?.();
      freshnessAuthority.finish(request);
      releaseBoardFreshnessAuthority(queryClient, boardQueryKey, freshnessAuthority);
    }
  }, [acquireEntitySlot, baseUrl, boardQueryKey, data, queryClient]);

  const reconcileIssuesResult = useCallback(async (issueIds: number[], options: EntityReconciliationOptions = {}) => {
    const ids = [...new Set(issueIds)];
    if (ids.length === 0) return { status: 'applied', missingIds: [] } as ReconcileResult;
    const requestData = queryClient.getQueryData<BoardData>(boardQueryKey) ?? data;
    if (!requestData) return { status: 'failed', reason: 'server' } as ReconcileResult;
    const batchSize = Math.max(1, Math.min(ENTITY_RECONCILIATION_BATCH_SIZE, requestData.meta.server_entity_limit ?? ENTITY_RECONCILIATION_BATCH_SIZE));
    const batches = Array.from({ length: Math.ceil(ids.length / batchSize) }, (_, index) => ids.slice(index * batchSize, (index + 1) * batchSize));
    const authority = getBoardFreshnessAuthority(queryClient, boardQueryKey);
    const guard = authority.beginEntityReconciliation(requestData, []);
    const results: ReconcileResult[] = new Array(batches.length);
    let nextIndex = 0;
    try {
      await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_ENTITY_READS, batches.length) }, async () => {
        while (nextIndex < batches.length) {
          const index = nextIndex++;
          const current = queryClient.getQueryData<BoardData>(boardQueryKey);
          if (!current || scopeOf(current) !== scopeOf(requestData) || authority.currentGeneration !== guard.generation) {
            results[index] = { status: 'superseded' };
            continue;
          }
          results[index] = await reconcileIssueBatch(batches[index]!, options);
        }
      }));
    } finally {
      authority.finish(guard);
      releaseBoardFreshnessAuthority(queryClient, boardQueryKey, authority);
    }
    const failed = results.find((result) => result.status === 'failed');
    if (failed) return failed;
    if (results.some((result) => result.status === 'superseded')) return { status: 'superseded' } as ReconcileResult;
    return { status: 'applied', missingIds: results.flatMap((result) => result.status === 'applied' ? result.missingIds : []) } as ReconcileResult;
  }, [boardQueryKey, data, queryClient, reconcileIssueBatch]);
  const reconcileIssues = useCallback(async (issueIds: number[], options: EntityReconciliationOptions = {}) => {
    const result = await reconcileIssuesResult(issueIds, options);
    return result.status === 'applied' && result.missingIds.length === 0;
  }, [reconcileIssuesResult]);
  const reconcileIssueIds = useCallback(async (issueIds: number[], options: EntityReconciliationOptions = {}) => {
    const initial = queryClient.getQueryData<BoardData>(boardQueryKey);
    const first = await reconcileIssuesResult(issueIds, options);
    if (first.status !== 'failed' || !initial) return first;
    const current = queryClient.getQueryData<BoardData>(boardQueryKey);
    if (!current || scopeOf(current) !== scopeOf(initial)) return { status: 'superseded' } as ReconcileResult;
    const retry = await reconcileIssuesResult(issueIds, options);
    if (retry.status !== 'failed') return retry;
    const latest = queryClient.getQueryData<BoardData>(boardQueryKey);
    if (latest && scopeOf(latest) === scopeOf(initial)) {
      await invalidateBoardSnapshot(queryClient, boardQueryKey);
      const refreshed = queryClient.getQueryData<BoardData>(boardQueryKey);
      if (!refreshed && onReconciliationFailure) onReconciliationFailure();
    }
    return retry;
  }, [boardQueryKey, onReconciliationFailure, queryClient, reconcileIssuesResult]);

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
