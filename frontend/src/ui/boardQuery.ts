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
) {
  return [
    'kanban',
    'board',
    baseUrl,
    serializeNumberSelection(projectIds),
    serializeNumberSelection(issueStatusIds),
    serializeNumberSelection(excludeStatusIds),
  ] as const;
}

export function buildBoardDataUrl(
  baseUrl: string,
  projectIds: number[],
  issueStatusIds: number[],
  excludeStatusIds: Iterable<number>,
): string {
  const params = new URLSearchParams();

  appendNumberParams(params, 'project_ids[]', projectIds);
  appendNumberParams(params, 'issue_status_ids[]', issueStatusIds);
  appendNumberParams(params, 'exclude_status_ids[]', excludeStatusIds);

  const query = params.toString();
  return `${baseUrl}/data${query ? `?${query}` : ''}`;
}

function appendNumberParams(params: URLSearchParams, key: string, values: Iterable<number>) {
  Array.from(new Set(values))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)
    .forEach((value) => params.append(key, String(value)));
}
