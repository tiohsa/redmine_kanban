export { effectiveScopeStatusIds, effectiveDependencyStatusIds } from '../../model/board/scope';
import { canonicalBoardFilterScope, type BoardFilterScope } from '../../model/board/filterScope';

export const ENTITY_RECONCILIATION_BATCH_SIZE = 100;

function canonicalIds(values: Iterable<number>): number[] {
  return Array.from(new Set(values)).filter((value) => Number.isSafeInteger(value) && value > 0).sort((a, b) => a - b);
}

export function buildBoardMetadataQueryKey(baseUrl: string, currentUserId: number, language: string, projectIds?: Iterable<number>) {
  return ['kanban', 'metadata', baseUrl, currentUserId, language, projectIds === undefined ? 'base' : canonicalIds(projectIds).join(',')] as const;
}

export function buildBoardMetadataUrl(baseUrl: string, projectIds: Iterable<number>): string {
  const params = new URLSearchParams();
  appendNumberParams(params, 'project_ids[]', canonicalIds(projectIds));
  const query = params.toString();
  return `${baseUrl}/metadata${query ? `?${query}` : ''}`;
}

function serializeNumberSelection(values: Iterable<number>): string {
  return Array.from(new Set(values)).filter(Number.isFinite).sort((a, b) => a - b).join(',');
}

export function buildBoardQueryKey(
  baseUrl: string,
  projectIds: number[],
  issueStatusIds: number[],
  excludeStatusIds: Iterable<number>,
  filterScope?: BoardFilterScope,
) {
  return [
    'kanban',
    'board',
    baseUrl,
    serializeNumberSelection(projectIds),
    serializeNumberSelection(issueStatusIds),
    serializeNumberSelection(excludeStatusIds),
    JSON.stringify(canonicalBoardFilterScope(filterScope ?? EMPTY_FILTER_SCOPE)),
  ] as const;
}

export function buildBoardDataUrl(
  baseUrl: string,
  projectIds: number[],
  issueStatusIds: number[],
  excludeStatusIds: Iterable<number>,
  filterScope?: BoardFilterScope,
): string {
  const params = new URLSearchParams();
  appendNumberParams(params, 'project_ids[]', projectIds);
  appendNumberParams(params, 'issue_status_ids[]', issueStatusIds);
  appendNumberParams(params, 'exclude_status_ids[]', excludeStatusIds);
  appendBoardFilterScopeParams(params, filterScope ?? EMPTY_FILTER_SCOPE);
  return `${baseUrl}/data?${params.toString()}`;
}

export type BoardMutationScope = {
  projectIds: Iterable<number>;
  scopeStatusIds?: Iterable<number>;
  dependencyStatusIds?: Iterable<number>;
  filterScope?: BoardFilterScope;
};

export function buildBoardMutationUrl(baseUrl: string, path: string, scope: BoardMutationScope): string {
  const params = new URLSearchParams();
  appendBoardMutationScopeParams(params, scope);
  return `${baseUrl}${path}?${params.toString()}`;
}

export function appendBoardMutationScopeParams(params: URLSearchParams, scope: BoardMutationScope): void {
  appendNumberParams(params, 'project_ids[]', scope.projectIds);
  appendScopeStatusParams(params, scope.scopeStatusIds ?? []);
  appendDependencyStatusParams(params, scope.dependencyStatusIds ?? scope.scopeStatusIds ?? []);
  appendBoardFilterScopeParams(params, scope.filterScope ?? EMPTY_FILTER_SCOPE);
}

export function buildBoardCountsUrl(
  baseUrl: string,
  projectIds: number[],
  filterScope?: BoardFilterScope,
  scopeStatusIds?: Iterable<number>,
  dependencyStatusIds?: Iterable<number>,
): string {
  const params = new URLSearchParams();
  appendNumberParams(params, 'project_ids[]', projectIds);
  if (scopeStatusIds !== undefined) appendScopeStatusParams(params, scopeStatusIds);
  if (dependencyStatusIds !== undefined) appendDependencyStatusParams(params, dependencyStatusIds);
  appendBoardFilterScopeParams(params, filterScope ?? EMPTY_FILTER_SCOPE);
  return `${baseUrl}/counts?${params.toString()}`;
}

export function buildBoardEntitiesUrl(baseUrl: string, projectIds: number[], issueIds: number[], scopeStatusIds: number[] = [], dependencyStatusIds = scopeStatusIds, filterScope?: BoardFilterScope): string {
  const params = new URLSearchParams();
  appendNumberParams(params, 'project_ids[]', projectIds);
  appendNumberParams(params, 'ids[]', issueIds);
  appendScopeStatusParams(params, scopeStatusIds);
  appendDependencyStatusParams(params, dependencyStatusIds);
  appendBoardFilterScopeParams(params, filterScope ?? EMPTY_FILTER_SCOPE);
  return `${baseUrl}/issues/entities?${params.toString()}`;
}

const EMPTY_FILTER_SCOPE: BoardFilterScope = {
  q: '', assignee_ids: [], include_unassigned: false, tracker_ids: [],
  priority_filter_enabled: false, priority_ids: [], include_no_priority: false, due: 'all',
};

export function appendBoardFilterScopeParams(params: URLSearchParams, rawScope: BoardFilterScope): void {
  const scope = canonicalBoardFilterScope(rawScope);
  params.set('filter_q', scope.q);
  appendNumberParams(params, 'filter_assignee_ids[]', scope.assignee_ids);
  params.set('filter_include_unassigned', scope.include_unassigned ? '1' : '0');
  appendNumberParams(params, 'filter_tracker_ids[]', scope.tracker_ids);
  params.set('filter_priority_enabled', scope.priority_filter_enabled ? '1' : '0');
  appendNumberParams(params, 'filter_priority_ids[]', scope.priority_ids);
  params.set('filter_include_no_priority', scope.include_no_priority ? '1' : '0');
  params.set('filter_due', scope.due);
  if (scope.due_days !== undefined) params.set('filter_due_days', String(scope.due_days));
  if (scope.date_anchor) params.set('filter_date_anchor', scope.date_anchor);
}

export function appendScopeStatusParams(params: URLSearchParams, scopeStatusIds: Iterable<number>): void {
  params.append('scope_status_ids_present', '1');
  appendNumberParams(params, 'scope_status_ids[]', scopeStatusIds);
}

export function appendDependencyStatusParams(params: URLSearchParams, dependencyStatusIds: Iterable<number>): void {
  params.append('dependency_status_ids_present', '1');
  appendNumberParams(params, 'dependency_status_ids[]', dependencyStatusIds);
}

function appendNumberParams(params: URLSearchParams, key: string, values: Iterable<number>) {
  Array.from(new Set(values))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)
    .forEach((value) => params.append(key, String(value)));
}
