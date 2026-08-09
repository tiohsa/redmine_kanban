function serializeNumberSelection(values: Iterable<number>): string {
  return Array.from(new Set(values)).filter(Number.isFinite).sort((a, b) => a - b).join(',');
}

export function buildBoardQueryKey(
  baseUrl: string,
  projectIds: number[],
  issueStatusIds: number[],
  excludeStatusIds: Iterable<number>,
  maximumBoardEntityCount = 1500,
) {
  return [
    'kanban',
    'board',
    baseUrl,
    serializeNumberSelection(projectIds),
    serializeNumberSelection(issueStatusIds),
    serializeNumberSelection(excludeStatusIds),
    maximumBoardEntityCount,
  ] as const;
}

export function buildBoardDataUrl(
  baseUrl: string,
  projectIds: number[],
  issueStatusIds: number[],
  excludeStatusIds: Iterable<number>,
  maximumBoardEntityCount = 1500,
): string {
  const params = new URLSearchParams();
  appendNumberParams(params, 'project_ids[]', projectIds);
  appendNumberParams(params, 'issue_status_ids[]', issueStatusIds);
  appendNumberParams(params, 'exclude_status_ids[]', excludeStatusIds);
  params.append('board_entity_limit', String(maximumBoardEntityCount));
  return `${baseUrl}/data?${params.toString()}`;
}

export function buildBoardCountsUrl(baseUrl: string, projectIds: number[]): string {
  const params = new URLSearchParams();
  appendNumberParams(params, 'project_ids[]', projectIds);
  return `${baseUrl}/counts?${params.toString()}`;
}

export function buildBoardEntitiesUrl(baseUrl: string, projectIds: number[], issueIds: number[], scopeStatusIds: number[] = []): string {
  const params = new URLSearchParams();
  appendNumberParams(params, 'project_ids[]', projectIds);
  appendNumberParams(params, 'ids[]', issueIds);
  appendScopeStatusParams(params, scopeStatusIds);
  return `${baseUrl}/issues/entities?${params.toString()}`;
}

export function appendScopeStatusParams(params: URLSearchParams, scopeStatusIds: Iterable<number>): void {
  params.append('scope_status_ids_present', '1');
  appendNumberParams(params, 'scope_status_ids[]', scopeStatusIds);
}

function appendNumberParams(params: URLSearchParams, key: string, values: Iterable<number>) {
  Array.from(new Set(values))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)
    .forEach((value) => params.append(key, String(value)));
}
