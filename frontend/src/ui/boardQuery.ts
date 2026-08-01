function serializeNumberSelection(values: Iterable<number>): string {
  return Array.from(new Set(values))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)
    .join(',');
}

export function buildBoardQueryKey(
  baseUrl: string,
  projectIds: number[],
  issueStatusIds: number[],
  excludeStatusIds: Iterable<number>,
  issueLimit?: number,
) {
  return [
    'kanban',
    'board',
    baseUrl,
    serializeNumberSelection(projectIds),
    serializeNumberSelection(issueStatusIds),
    serializeNumberSelection(excludeStatusIds),
    issueLimit ?? 'default',
  ] as const;
}

export function buildBoardDataUrl(
  baseUrl: string,
  projectIds: number[],
  issueStatusIds: number[],
  excludeStatusIds: Iterable<number>,
  issueLimit?: number,
): string {
  const params = new URLSearchParams();

  appendNumberParams(params, 'project_ids[]', projectIds);
  appendNumberParams(params, 'issue_status_ids[]', issueStatusIds);
  appendNumberParams(params, 'exclude_status_ids[]', excludeStatusIds);
  if (issueLimit && Number.isFinite(issueLimit) && issueLimit > 0) {
    params.append('issue_limit', String(issueLimit));
  }

  const query = params.toString();
  return `${baseUrl}/data${query ? `?${query}` : ''}`;
}

export function buildBoardIssuesUrl(
  baseUrl: string,
  projectIds: number[],
  issueStatusIds: number[],
  excludeStatusIds: Iterable<number>,
  issueLimit: number,
  offset: number,
  treeParentId?: number,
): string {
  const params = new URLSearchParams();

  appendNumberParams(params, 'project_ids[]', projectIds);
  appendNumberParams(params, 'issue_status_ids[]', issueStatusIds);
  appendNumberParams(params, 'exclude_status_ids[]', excludeStatusIds);
  params.append('issue_limit', String(issueLimit));
  params.append('offset', String(Math.max(0, offset)));
  if (treeParentId && Number.isFinite(treeParentId) && treeParentId > 0) {
    params.append('tree_parent_id', String(treeParentId));
  }

  return `${baseUrl}/issues?${params.toString()}`;
}

export function buildBoardIssuesCursorUrl(
  baseUrl: string,
  projectIds: number[],
  issueStatusIds: number[],
  excludeStatusIds: Iterable<number>,
  issueLimit: number,
  cursor: string,
  treeParentId?: number,
): string {
  const params = new URLSearchParams();

  appendNumberParams(params, 'project_ids[]', projectIds);
  appendNumberParams(params, 'issue_status_ids[]', issueStatusIds);
  appendNumberParams(params, 'exclude_status_ids[]', excludeStatusIds);
  params.append('issue_limit', String(issueLimit));
  params.append('cursor', cursor);
  if (treeParentId && Number.isFinite(treeParentId) && treeParentId > 0) {
    params.append('tree_parent_id', String(treeParentId));
  }

  return `${baseUrl}/issues?${params.toString()}`;
}

export function buildBoardTreeUrl(
  baseUrl: string,
  projectIds: number[],
  issueStatusIds: number[],
  excludeStatusIds: Iterable<number>,
  issueLimit: number,
  parentId: number,
): string {
  const params = new URLSearchParams();
  appendNumberParams(params, 'project_ids[]', projectIds);
  appendNumberParams(params, 'issue_status_ids[]', issueStatusIds);
  appendNumberParams(params, 'exclude_status_ids[]', excludeStatusIds);
  params.append('issue_limit', String(issueLimit));
  params.append('tree_parent_id', String(parentId));
  return `${baseUrl}/issues?${params.toString()}`;
}

export function buildBoardCountsUrl(baseUrl: string, projectIds: number[]): string {
  const params = new URLSearchParams();
  appendNumberParams(params, 'project_ids[]', projectIds);
  return `${baseUrl}/counts?${params.toString()}`;
}

export function buildBoardEntitiesUrl(baseUrl: string, projectIds: number[], issueIds: number[]): string {
  const params = new URLSearchParams();
  appendNumberParams(params, 'project_ids[]', projectIds);
  appendNumberParams(params, 'ids[]', issueIds);
  return `${baseUrl}/issues/entities?${params.toString()}`;
}

function appendNumberParams(params: URLSearchParams, key: string, values: Iterable<number>) {
  Array.from(new Set(values))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)
    .forEach((value) => params.append(key, String(value)));
}
