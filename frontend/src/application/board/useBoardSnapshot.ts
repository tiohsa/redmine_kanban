import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BoardMetadata, ToolbarViewModel } from '../../model/board/types';
import { getJson, isHttpError } from '../../infrastructure/api/http';
import { buildBoardDataUrl, buildBoardQueryKey } from '../../infrastructure/api/boardQuery';
import { normalizeBoardData, parseBoardSnapshotV3 } from '../../infrastructure/api/boardSnapshot';

type Args = {
  baseUrl: string;
  projectIds: number[];
  statusIds: number[];
  hiddenStatusIds: Iterable<number>;
  maximumBoardEntityCount: number;
  preferencesReady: boolean;
  initialLabels: Record<string, string>;
  currentUserId: number;
  viewableProjectsEnabled?: boolean;
};

export function useBoardSnapshot({
  baseUrl,
  projectIds,
  statusIds,
  hiddenStatusIds,
  maximumBoardEntityCount,
  preferencesReady,
  initialLabels,
  currentUserId,
  viewableProjectsEnabled = false,
}: Args) {
  const queryClient = useQueryClient();
  const [loadFailure, setLoadFailure] = useState<{ error: unknown; scope: string; message: string } | null>(null);
  const metadataQuery = useQuery({
    queryKey: ['kanban', 'metadata', baseUrl, currentUserId, document.documentElement.lang],
    queryFn: async () => {
      const result = await getJson<BoardMetadata>(`${baseUrl}/metadata`);
      if (!result?.ok || !result.board || !Array.isArray(result.projects) || !Array.isArray(result.viewable_projects) || !Array.isArray(result.statuses) || !Number.isSafeInteger(result.server_entity_limit)) throw new Error('Invalid board metadata');
      return result;
    },
    enabled: preferencesReady,
    retry: false,
  });
  const permissionLost = isHttpError(metadataQuery.error) && [401, 403, 404].includes(metadataQuery.error.status);
  const boardQueryKey = useMemo(
    () => buildBoardQueryKey(baseUrl, projectIds, statusIds, hiddenStatusIds, maximumBoardEntityCount),
    [baseUrl, hiddenStatusIds, maximumBoardEntityCount, projectIds, statusIds],
  );
  const choices = metadataQuery.error ? undefined : metadataQuery.data;
  const selectedHiddenStatuses = Array.from(hiddenStatusIds);
  const hasScopeSelection = projectIds.length + statusIds.length + selectedHiddenStatuses.length > 0;
  const scopeChoicesReady = !hasScopeSelection || Boolean(choices?.board);
  const invalidScope = Boolean(choices?.board && (
    projectIds.some((id) => !(viewableProjectsEnabled ? choices.viewable_projects : choices.projects).some((p) => p.id === id)) ||
    [...statusIds, ...selectedHiddenStatuses].some((id) => !choices.statuses.some((s) => s.id === id))
  ));
  const boardQuery = useQuery({
    queryKey: boardQueryKey,
    queryFn: async () => normalizeBoardData(
      parseBoardSnapshotV3(await getJson<unknown>(buildBoardDataUrl(baseUrl, projectIds, statusIds, hiddenStatusIds, maximumBoardEntityCount))),
    ),
    retry: false,
    enabled: preferencesReady && scopeChoicesReady && !invalidScope && !permissionLost,
  });

  const accessDenied = permissionLost || (isHttpError(boardQuery.error) && [401, 403, 404].includes(boardQuery.error.status));
  const data = accessDenied || invalidScope || !scopeChoicesReady ? null : boardQuery.data ?? null;
  const metadata = accessDenied || metadataQuery.error ? null : metadataQuery.data;
  const toolbarData = useMemo<ToolbarViewModel>(() => data ?? ({
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
  }), [data, initialLabels, metadata]);
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
    const payload = isHttpError<{ error?: { code?: string; requested_entity_limit?: number; effective_entity_limit?: number; server_entity_limit?: number; count_at_least?: number; maximum_response_bytes?: number } }>(boardQuery.error)
      ? boardQuery.error.payload
      : null;
    const boardError = payload?.error;
    if (boardError?.code === 'BOARD_SCOPE_TOO_LARGE') {
      const limit = boardError.effective_entity_limit ?? boardError.requested_entity_limit ?? maximumBoardEntityCount;
      const serverSuffix = boardError.server_entity_limit && boardError.requested_entity_limit && boardError.requested_entity_limit > boardError.server_entity_limit
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
  }, [boardQuery.data, boardQuery.error, errorScope, maximumBoardEntityCount, toolbarData.labels]);

  const refresh = useCallback(async (options: { suppressError?: boolean } = {}) => {
    if (options.suppressError) suppressNextBoardErrorRef.current = JSON.stringify(boardQueryKey);
    await queryClient.invalidateQueries({ queryKey: boardQueryKey });
  }, [boardQueryKey, queryClient]);

  return {
    boardQuery,
    metadata: metadata ?? null,
    metadataQuery,
    loadError: loadFailure?.error === boardQuery.error && loadFailure?.scope === errorScope ? loadFailure.message : null,
    dismissLoadError: () => setLoadFailure(null),
    boardQueryKey,
    data,
    loading: boardQuery.isLoading,
    refresh,
    toolbarData,
  };
}
