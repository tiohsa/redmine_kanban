import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BoardData, ToolbarViewModel } from '../../model/board/types';
import { canonicalBoardFilterScope, type BoardFilterScope } from '../../model/board/filterScope';
import { getJson, isHttpError } from '../../infrastructure/api/http';
import { parseBoardMetadata } from '../../infrastructure/api/boardMetadata';
import { buildBoardDataUrl, buildBoardQueryKey } from '../../infrastructure/api/boardQuery';
import { normalizeBoardData, parseBoardSnapshotV3 } from '../../infrastructure/api/boardSnapshot';
import { getBoardFreshnessAuthority, releaseBoardFreshnessAuthority } from './asyncFreshness';

type Args = {
  baseUrl: string;
  projectIds: number[];
  statusIds: number[];
  hiddenStatusIds: Iterable<number>;
  preferencesReady: boolean;
  initialLabels: Record<string, string>;
  currentUserId: number;
  viewableProjectsEnabled?: boolean;
  filterScope?: BoardFilterScope;
};

const EMPTY_FILTER_SCOPE: BoardFilterScope = {
  q: '', assignee_ids: [], include_unassigned: false, tracker_ids: [],
  priority_filter_enabled: false, priority_ids: [], include_no_priority: false, due: 'all',
};

function emptyPresentationBoard(previous: BoardData): BoardData {
  return {
    ...previous,
    ok: false,
    contract_version: undefined,
    scope_fingerprint: undefined,
    meta: {
      ...previous.meta,
      can_move: false, can_create: false, can_delete: false,
      complete: false, entity_count: 0, scope_fingerprint: undefined,
    },
    columns: previous.columns.map(({ count: _count, ...column }) => column),
    issues: [],
    entities: [],
    tree: { root_ids: [], children_by_parent_id: {} },
  };
}

export function useBoardSnapshot({
  baseUrl,
  projectIds,
  statusIds,
  hiddenStatusIds,
  preferencesReady,
  initialLabels,
  currentUserId,
  viewableProjectsEnabled = false,
  filterScope = EMPTY_FILTER_SCOPE,
}: Args) {
  const queryClient = useQueryClient();
  const [loadFailure, setLoadFailure] = useState<{ error: unknown; scope: string; message: string } | null>(null);
  const metadataQuery = useQuery({
    queryKey: ['kanban', 'metadata', baseUrl, currentUserId, document.documentElement.lang],
    queryFn: async () => {
      return parseBoardMetadata(await getJson<unknown>(`${baseUrl}/metadata`));
    },
    enabled: preferencesReady,
    retry: false,
  });
  const permissionLost = isHttpError(metadataQuery.error) && [401, 403, 404].includes(metadataQuery.error.status);
  const requestedScope = useMemo(() => ({
    projectIds: [...new Set(projectIds)].sort((a, b) => a - b),
    statusIds: [...new Set(statusIds)].sort((a, b) => a - b),
    hiddenStatusIds: [...new Set(hiddenStatusIds)].sort((a, b) => a - b),
    filterScope: canonicalBoardFilterScope(filterScope),
  }), [filterScope, hiddenStatusIds, projectIds, statusIds]);
  const requestedScopeKey = JSON.stringify(requestedScope);
  const [settledScopeKey, setSettledScopeKey] = useState(requestedScopeKey);
  const [settledScope, setSettledScope] = useState(requestedScope);
  useEffect(() => {
    if (settledScopeKey === requestedScopeKey) return;
    const timer = window.setTimeout(() => {
      setSettledScope(JSON.parse(requestedScopeKey) as typeof requestedScope);
      setSettledScopeKey(requestedScopeKey);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [requestedScopeKey, settledScopeKey]);
  const queryProjectIds = settledScope.projectIds;
  const queryStatusIds = settledScope.statusIds;
  const queryHiddenStatusIds = settledScope.hiddenStatusIds;
  const queryFilterScope = settledScope.filterScope;
  const boardQueryKey = useMemo(
    () => buildBoardQueryKey(baseUrl, queryProjectIds, queryStatusIds, queryHiddenStatusIds, queryFilterScope),
    [baseUrl, queryFilterScope, queryHiddenStatusIds, queryProjectIds, queryStatusIds],
  );
  const choices = metadataQuery.error ? undefined : metadataQuery.data;
  const selectedHiddenStatuses = queryHiddenStatusIds;
  const hasScopeSelection = queryProjectIds.length + queryStatusIds.length + selectedHiddenStatuses.length > 0;
  const scopeChoicesReady = !hasScopeSelection || Boolean(choices?.board);
  const invalidScope = Boolean(choices?.board && (
    queryProjectIds.some((id) => !(viewableProjectsEnabled ? choices.viewable_projects : choices.projects).some((p) => p.id === id)) ||
    [...queryStatusIds, ...queryHiddenStatusIds].some((id) => !choices.statuses.some((s) => s.id === id))
  ));
  const authority = useMemo(() => getBoardFreshnessAuthority(queryClient, boardQueryKey), [queryClient, boardQueryKey]);
  const subscribeRefresh = useCallback((listener: () => void) => authority.onSnapshotRefreshChange(listener), [authority]);
  const getRefreshState = useCallback(() => authority.snapshotRefreshState, [authority]);
  const snapshotRefreshState = useSyncExternalStore(subscribeRefresh, getRefreshState);
  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || JSON.stringify(event.query.queryKey) !== JSON.stringify(boardQueryKey)) return;
      if (event.action.type === 'success' && !event.action.manual) authority.commitSnapshotResult();
      if (event.action.type === 'error') authority.failSnapshotRefresh();
    });
    return () => {
      unsubscribe();
      releaseBoardFreshnessAuthority(queryClient, boardQueryKey, authority);
    };
  }, [authority, boardQueryKey, queryClient]);
  const boardQuery = useQuery<BoardData>({
    queryKey: boardQueryKey,
    placeholderData: (previousData) => previousData,
    queryFn: async ({ signal }) => {
      const generation = authority.currentGeneration;
      const result = normalizeBoardData(parseBoardSnapshotV3(await getJson<unknown>(
        buildBoardDataUrl(baseUrl, queryProjectIds, queryStatusIds, queryHiddenStatusIds, queryFilterScope), { signal },
      )));
      if (signal.aborted || generation !== authority.currentGeneration) throw new DOMException('Aborted', 'AbortError');
      authority.recordSnapshotResult(generation);
      return result;
    },
    retry: false,
    enabled: preferencesReady && scopeChoicesReady && !invalidScope && !permissionLost && requestedScopeKey === settledScopeKey,
  });

  const accessDenied = permissionLost || (isHttpError(boardQuery.error) && [401, 403, 404].includes(boardQuery.error.status));
  const displayBlocked = accessDenied || invalidScope || !scopeChoicesReady;
  const refreshing = snapshotRefreshState === 'refreshing';
  const transitioning = requestedScopeKey !== settledScopeKey || boardQuery.isPlaceholderData;
  const data = displayBlocked || snapshotRefreshState !== 'ready' || transitioning ? null : boardQuery.data ?? null;
  const presentationData = displayBlocked || snapshotRefreshState === 'failed'
    ? null : transitioning && boardQuery.data ? emptyPresentationBoard(boardQuery.data) : boardQuery.data ?? null;
  const metadata = accessDenied || metadataQuery.error ? null : metadataQuery.data;
  const toolbarData = useMemo<ToolbarViewModel>(() => presentationData ?? ({
    meta: {
      project_id: metadata?.board.id ?? 0,
      can_move: false,
      can_create: false,
      can_delete: false,
      complete: false,
      server_entity_limit: metadata?.server_entity_limit,
    },
    columns: metadata?.statuses ?? [],
    lists: {
      assignees: [], trackers: [], priorities: [], creatable_projects: [],
      projects: metadata?.projects ?? [], viewable_projects: metadata?.viewable_projects ?? [],
    },
    labels: initialLabels,
  }), [presentationData, initialLabels, metadata]);
  const errorScope = JSON.stringify(boardQueryKey);
  const suppressNextBoardErrorRef = useRef<string | null>(null);

  useEffect(() => {
    if (!boardQuery.error) {
      setLoadFailure(null);
      if (boardQuery.data && suppressNextBoardErrorRef.current === errorScope) suppressNextBoardErrorRef.current = null;
      return;
    }
    if (suppressNextBoardErrorRef.current === errorScope) {
      suppressNextBoardErrorRef.current = null;
      return;
    }
    const setLoadError = (message: string) => setLoadFailure((previous) => previous?.error === boardQuery.error && previous.scope === errorScope && previous.message === message ? previous : { error: boardQuery.error, scope: errorScope, message });
    const payload = isHttpError<{ error?: { code?: string; requested_entity_limit?: number; effective_entity_limit?: number; server_entity_limit?: number | null; count_at_least?: number; maximum_response_bytes?: number } }>(boardQuery.error)
      ? boardQuery.error.payload
      : null;
    const boardError = payload?.error;
    if (boardError?.code === 'BOARD_SCOPE_TOO_LARGE') {
      const limit = boardError.effective_entity_limit ?? boardError.requested_entity_limit ?? toolbarData.meta.server_entity_limit ?? 10000;
      const serverSuffix = boardError.server_entity_limit != null && boardError.requested_entity_limit && boardError.requested_entity_limit > boardError.server_entity_limit
        ? ` ${toolbarData.labels.board_server_limit_suffix.replace('%{limit}', boardError.server_entity_limit.toLocaleString())}`
        : '';
      setLoadError(toolbarData.labels.board_scope_too_large.replace('%{limit}', limit.toLocaleString()) + serverSuffix);
    } else if (boardError?.code === 'BOARD_RESPONSE_TOO_LARGE') {
      setLoadError(toolbarData.labels.board_response_too_large.replace('%{bytes}', (boardError.maximum_response_bytes ?? 0).toLocaleString()));
    } else if (boardError?.code === 'BOARD_QUERY_LIMIT_EXCEEDED') {
      setLoadError(toolbarData.labels.board_query_limit_exceeded);
    } else if (boardError?.code === 'BOARD_TOTAL_QUERY_LIMIT_EXCEEDED') {
      setLoadError(toolbarData.labels.board_total_query_limit_exceeded);
    } else {
      setLoadError(toolbarData.labels.load_failed);
    }
  }, [boardQuery.data, boardQuery.error, errorScope, toolbarData.labels, toolbarData.meta.server_entity_limit]);

  const refresh = useCallback(async (options: { suppressError?: boolean } = {}) => {
    // The pending scope will fetch after settling; never refresh its previous anchor.
    if (requestedScopeKey !== settledScopeKey) return;
    if (options.suppressError) suppressNextBoardErrorRef.current = JSON.stringify(boardQueryKey);
    await queryClient.invalidateQueries({ queryKey: boardQueryKey });
  }, [boardQueryKey, queryClient, requestedScopeKey, settledScopeKey]);

  return {
    boardQuery,
    metadata: metadata ?? null,
    metadataQuery,
    loadError: loadFailure?.error === boardQuery.error && loadFailure?.scope === errorScope ? loadFailure.message : null,
    dismissLoadError: () => setLoadFailure(null),
    boardQueryKey,
    data,
    presentationData,
    refreshing: refreshing || transitioning,
    loading: boardQuery.isLoading || transitioning,
    refresh,
    toolbarData,
  };
}
