import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { BoardData, Issue } from '../../model/board/types';
import { findIssueInBoard } from '../../model/board/selectors';
import { normalizeTrackerId, resolveClosedState } from '../../model/issue/issue';

export type FreshnessRequestKind = 'entity' | 'aggregate';

export type FreshnessRequest = {
  readonly id: number;
  readonly kind: FreshnessRequestKind;
  readonly generation: number;
  readonly scopeFingerprint: string;
  readonly entitySnapshots: ReadonlyMap<number, string>;
};

function scopeFingerprint(data: BoardData): string {
  return data.scope_fingerprint
    ?? data.meta.scope_fingerprint
    ?? `project:${(data.meta.project_ids ?? [data.meta.project_id]).join(',')}`;
}

function snapshotIssue(data: BoardData, issueId: number): string {
  const issue = findIssueInBoard(data, issueId);
  return issue ? JSON.stringify(canonicalIssue(issue, data.columns)) : 'missing';
}

function canonicalIssue(issue: Issue, columns: BoardData['columns']): Issue & { is_closed: boolean } {
  return {
    ...issue,
    is_closed: resolveClosedState(issue, columns),
    ...(issue.tracker_id === undefined ? {} : { tracker_id: normalizeTrackerId(issue.tracker_id) }),
    subtasks: (issue.subtasks ?? []).map((child) => canonicalIssue(child as Issue, columns)),
  };
}

export class BoardFreshnessAuthority {
  private generation = 0;
  private nextRequestId = 0;
  private latestAggregateRequestId = 0;
  private latestEntityRequestIds = new Map<number, number>();
  private currentScopeFingerprint: string | undefined;
  private activeRequests = new Set<number>();
  private entityAbortControllers = new Map<number, AbortController>();
  private invalidationListeners = new Set<() => void>();

  beginEntityReconciliation(data: BoardData, issueIds: Iterable<number>): FreshnessRequest {
    this.syncScope(data);
    const ids = [...new Set(issueIds)];
    const request = this.begin('entity', data, new Map(ids.map((id) => [id, snapshotIssue(data, id)])));
    for (const id of ids) this.latestEntityRequestIds.set(id, request.id);
    for (const [requestId, controller] of this.entityAbortControllers) {
      if (requestId !== request.id && this.activeRequests.has(requestId)
        && [...request.entitySnapshots.keys()].some((id) => this.activeRequestEntityIds.get(requestId)?.has(id))) controller.abort();
    }
    return request;
  }

  private activeRequestEntityIds = new Map<number, ReadonlySet<number>>();

  attachEntityAbortController(request: FreshnessRequest, controller: AbortController): void {
    if (request.kind !== 'entity' || !this.activeRequests.has(request.id)) return;
    this.entityAbortControllers.set(request.id, controller);
    this.activeRequestEntityIds.set(request.id, new Set(request.entitySnapshots.keys()));
  }

  beginAggregateReconciliation(data: BoardData): FreshnessRequest {
    this.syncScope(data);
    const request = this.begin('aggregate', data, new Map());
    this.latestAggregateRequestId = request.id;
    return request;
  }

  canApplyEntityReconciliation(
    request: FreshnessRequest,
    current: BoardData,
    negativeIssueIds: Iterable<number>,
  ): boolean {
    return this.applicableNegativeIssueIds(request, current, negativeIssueIds) !== null;
  }

  applicableEntityIds(request: FreshnessRequest, current: BoardData, issueIds: Iterable<number>): number[] | null {
    if (!this.isCurrent(request, current) || request.kind !== 'entity') return null;
    return [...new Set(issueIds)].filter((issueId) => (
      request.entitySnapshots.has(issueId)
      && this.latestEntityRequestIds.get(issueId) === request.id
      && request.entitySnapshots.get(issueId) === snapshotIssue(current, issueId)
    ));
  }

  applicableNegativeIssueIds(
    request: FreshnessRequest,
    current: BoardData,
    negativeIssueIds: Iterable<number>,
  ): number[] | null {
    return this.applicableEntityIds(request, current, negativeIssueIds);
  }

  canApplyAggregateReconciliation(request: FreshnessRequest, current: BoardData): boolean {
    return this.isCurrent(request, current)
      && request.kind === 'aggregate'
      && request.id === this.latestAggregateRequestId;
  }

  finish(request: FreshnessRequest): void {
    this.activeRequests.delete(request.id);
    this.entityAbortControllers.delete(request.id);
    this.activeRequestEntityIds.delete(request.id);
    for (const issueId of request.entitySnapshots.keys()) {
      if (this.latestEntityRequestIds.get(issueId) === request.id) this.latestEntityRequestIds.delete(issueId);
    }
  }

  invalidate(): void {
    this.generation += 1;
    this.entityAbortControllers.forEach((controller) => controller.abort());
    this.entityAbortControllers.clear();
    this.activeRequestEntityIds.clear();
    for (const listener of this.invalidationListeners) listener();
    this.latestAggregateRequestId = 0;
    this.latestEntityRequestIds.clear();
    this.activeRequests.clear();
  }

  get activeRequestCount(): number {
    return this.activeRequests.size;
  }

  get currentGeneration(): number {
    return this.generation;
  }

  onInvalidate(listener: () => void): () => void {
    this.invalidationListeners.add(listener);
    return () => this.invalidationListeners.delete(listener);
  }

  observe(data: BoardData): void {
    this.syncScope(data);
  }

  private begin(
    kind: FreshnessRequestKind,
    data: BoardData,
    entitySnapshots: ReadonlyMap<number, string>,
  ): FreshnessRequest {
    const request: FreshnessRequest = {
      id: ++this.nextRequestId,
      kind,
      generation: this.generation,
      scopeFingerprint: scopeFingerprint(data),
      entitySnapshots,
    };
    this.activeRequests.add(request.id);
    return request;
  }

  private syncScope(data: BoardData): void {
    const nextScopeFingerprint = scopeFingerprint(data);
    if (this.currentScopeFingerprint && this.currentScopeFingerprint !== nextScopeFingerprint) this.invalidate();
    this.currentScopeFingerprint = nextScopeFingerprint;
  }

  private isCurrent(request: FreshnessRequest, current: BoardData): boolean {
    this.syncScope(current);
    return request.generation === this.generation
      && request.scopeFingerprint === scopeFingerprint(current)
      && this.activeRequests.has(request.id);
  }
}

const authoritiesByClient = new WeakMap<object, Map<string, BoardFreshnessAuthority>>();

function authorityKey(queryKey: QueryKey): string {
  return JSON.stringify(queryKey);
}

export function getBoardFreshnessAuthority(queryClient: QueryClient, queryKey: QueryKey): BoardFreshnessAuthority {
  let authorities = authoritiesByClient.get(queryClient);
  if (!authorities) {
    authorities = new Map();
    authoritiesByClient.set(queryClient, authorities);
  }
  const key = authorityKey(queryKey);
  let authority = authorities.get(key);
  if (!authority) {
    authority = new BoardFreshnessAuthority();
    authorities.set(key, authority);
  }
  return authority;
}

export function releaseBoardFreshnessAuthority(
  queryClient: QueryClient,
  queryKey: QueryKey,
  authority: BoardFreshnessAuthority,
): void {
  if (authority.activeRequestCount > 0) return;
  const authorities = authoritiesByClient.get(queryClient);
  if (authorities?.get(authorityKey(queryKey)) === authority) authorities.delete(authorityKey(queryKey));
}
