import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BoardApiResponse, BoardData } from './types';
import { getJson, isHttpError } from './http';
import { buildBoardDataUrl, buildBoardQueryKey } from './boardQuery';
import { normalizeBoardData } from './kanbanShared';

type Args = {
  baseUrl: string;
  projectIds: number[];
  statusIds: number[];
  hiddenStatusIds: Iterable<number>;
  maximumBoardEntityCount: number;
  preferencesReady: boolean;
  initialLabels: Record<string, string>;
  agingWarnDays: number;
  agingDangerDays: number;
  agingExcludeClosed: boolean;
  setError: (value: string | null) => void;
};

export function useBoardSnapshot({
  baseUrl,
  projectIds,
  statusIds,
  hiddenStatusIds,
  maximumBoardEntityCount,
  preferencesReady,
  initialLabels,
  agingWarnDays,
  agingDangerDays,
  agingExcludeClosed,
  setError,
}: Args) {
  const queryClient = useQueryClient();
  const boardQueryKey = useMemo(
    () => buildBoardQueryKey(baseUrl, projectIds, statusIds, hiddenStatusIds, maximumBoardEntityCount),
    [baseUrl, hiddenStatusIds, maximumBoardEntityCount, projectIds, statusIds],
  );
  const boardQuery = useQuery({
    queryKey: boardQueryKey,
    queryFn: async () => normalizeBoardData(
      await getJson<BoardApiResponse>(buildBoardDataUrl(baseUrl, projectIds, statusIds, hiddenStatusIds, maximumBoardEntityCount)),
    ),
    retry: false,
    enabled: preferencesReady,
  });

  const data = boardQuery.data ?? null;
  const emptyBoardData = useMemo<BoardData>(() => ({
    ok: true,
    contract_version: 3,
    scope_fingerprint: `pending:${baseUrl}`,
    meta: {
      project_id: 0,
      project_ids: [],
      scope_status_ids: [],
      current_user_id: 0,
      can_move: false,
      can_create: false,
      can_delete: false,
      lane_type: 'assignee',
      aging_warn_days: agingWarnDays,
      aging_danger_days: agingDangerDays,
      aging_exclude_closed: agingExcludeClosed,
      complete: false,
      entity_count: 0,
      requested_entity_limit: maximumBoardEntityCount,
      effective_entity_limit: maximumBoardEntityCount,
      server_entity_limit: 5000,
    },
    columns: [],
    lanes: [],
    lists: { assignees: [], trackers: [], priorities: [], projects: [], viewable_projects: [], creatable_projects: [] },
    issues: [],
    labels: initialLabels,
  }), [agingDangerDays, agingExcludeClosed, agingWarnDays, baseUrl, initialLabels, maximumBoardEntityCount]);
  const toolbarData = data ?? emptyBoardData;
  const suppressNextBoardErrorRef = useRef(false);

  useEffect(() => {
    if (!boardQuery.error) {
      if (boardQuery.data) suppressNextBoardErrorRef.current = false;
      return;
    }
    if (suppressNextBoardErrorRef.current) {
      suppressNextBoardErrorRef.current = false;
      return;
    }
    const payload = isHttpError<{ error?: { code?: string; requested_entity_limit?: number; effective_entity_limit?: number; server_entity_limit?: number; count_at_least?: number; maximum_response_bytes?: number } }>(boardQuery.error)
      ? boardQuery.error.payload
      : null;
    const boardError = payload?.error;
    if (boardError?.code === 'BOARD_SCOPE_TOO_LARGE') {
      const limit = boardError.effective_entity_limit ?? boardError.requested_entity_limit ?? maximumBoardEntityCount;
      const serverSuffix = boardError.server_entity_limit && boardError.requested_entity_limit && boardError.requested_entity_limit > boardError.server_entity_limit
        ? ` ${toolbarData.labels.board_server_limit_suffix.replace('%{limit}', boardError.server_entity_limit.toLocaleString())}`
        : '';
      setError(toolbarData.labels.board_scope_too_large.replace('%{limit}', limit.toLocaleString()) + serverSuffix);
    } else if (boardError?.code === 'BOARD_RESPONSE_TOO_LARGE') {
      setError(toolbarData.labels.board_response_too_large.replace('%{bytes}', (boardError.maximum_response_bytes ?? 0).toLocaleString()));
    } else {
      setError(toolbarData.labels.load_failed);
    }
  }, [boardQuery.data, boardQuery.error, maximumBoardEntityCount, setError, toolbarData.labels]);

  const refresh = useCallback(async (options: { suppressError?: boolean } = {}) => {
    if (options.suppressError) suppressNextBoardErrorRef.current = true;
    await queryClient.invalidateQueries({ queryKey: boardQueryKey });
  }, [boardQueryKey, queryClient]);

  return {
    boardQuery,
    boardQueryKey,
    data,
    loading: boardQuery.isLoading,
    refresh,
    toolbarData,
  };
}
