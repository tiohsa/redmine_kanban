import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { BoardData } from './types';
import { findIssueInBoard } from './kanbanShared';

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
  return issue ? JSON.stringify(issue) : 'missing';
}

export class BoardFreshnessAuthority {
  private generation = 0;
  private nextRequestId = 0;
  private latestAggregateRequestId = 0;
  private currentScopeFingerprint: string | undefined;
  private activeRequests = new Set<number>();

  beginEntityReconciliation(data: BoardData, issueIds: Iterable<number>): FreshnessRequest {
    this.syncScope(data);
    const ids = [...new Set(issueIds)];
    const request = this.begin('entity', data, new Map(ids.map((id) => [id, snapshotIssue(data, id)])));
    return request;
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

  applicableNegativeIssueIds(
    request: FreshnessRequest,
    current: BoardData,
    negativeIssueIds: Iterable<number>,
  ): number[] | null {
    if (!this.isCurrent(request, current) || request.kind !== 'entity') return null;
    return [...new Set(negativeIssueIds)].filter((issueId) => (
      request.entitySnapshots.get(issueId) === snapshotIssue(current, issueId)
    ));
  }

  canApplyAggregateReconciliation(request: FreshnessRequest, current: BoardData): boolean {
    return this.isCurrent(request, current)
      && request.kind === 'aggregate'
      && request.id === this.latestAggregateRequestId;
  }

  finish(request: FreshnessRequest): void {
    this.activeRequests.delete(request.id);
  }

  invalidate(): void {
    this.generation += 1;
    this.latestAggregateRequestId = 0;
    this.activeRequests.clear();
  }

  get activeRequestCount(): number {
    return this.activeRequests.size;
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
