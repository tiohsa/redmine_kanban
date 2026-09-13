import { useEffect, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { BoardData } from './types';
import type { Filters } from './boardFilters';

export function normalizeProjectIds(projectIds: number[], allowedProjectIds: Set<number>): number[] {
  return projectIds.filter((projectId) => allowedProjectIds.has(projectId));
}

export function normalizeAssigneeIds(assigneeIds: string[], allowedAssigneeIds: Set<string>): string[] {
  return assigneeIds.filter((assigneeId) => assigneeId === 'unassigned' || allowedAssigneeIds.has(assigneeId));
}

export function normalizeTrackerIds(trackerIds: number[], allowedTrackerIds: Set<number>): number[] {
  return trackerIds.filter((trackerId) => allowedTrackerIds.has(trackerId));
}

export function resolveDefaultCreateProjectId(
  selectedProjectIds: number[],
  creatableProjectIds: Set<number>,
  fallbackProjectId: number | undefined,
): number | null {
  const selectedCreatableProjectId = selectedProjectIds.find((projectId) => creatableProjectIds.has(projectId));
  if (selectedCreatableProjectId) return selectedCreatableProjectId;
  if (fallbackProjectId && creatableProjectIds.has(fallbackProjectId)) return fallbackProjectId;
  return null;
}

type Args = {
  data: BoardData | null;
  filters: Filters;
  setFilters: Dispatch<SetStateAction<Filters>>;
  viewableProjectsEnabled: boolean;
};

export function useBoardFilterNormalization({ data, filters, setFilters, viewableProjectsEnabled }: Args) {
  const projectOptions = useMemo(
    () => (viewableProjectsEnabled ? data?.lists.viewable_projects : data?.lists.projects) ?? [],
    [data, viewableProjectsEnabled],
  );
  const allowedProjectIds = useMemo(() => new Set(projectOptions.map((project) => project.id)), [projectOptions]);
  const allowedAssigneeIds = useMemo(
    () => new Set((data?.lists.assignees ?? []).filter((assignee) => assignee.id !== null).map((assignee) => String(assignee.id))),
    [data],
  );
  const allowedTrackerIds = useMemo(
    () => new Set((data?.lists.trackers ?? []).map((tracker) => tracker.id)),
    [data],
  );
  const creatableProjectIds = useMemo(
    () => new Set((data?.lists.creatable_projects ?? []).map((project) => project.id)),
    [data],
  );

  useEffect(() => {
    if (!data) return;
    const normalizedProjectIds = normalizeProjectIds(filters.projectIds, allowedProjectIds);
    if (normalizedProjectIds.length === filters.projectIds.length) return;
    setFilters((previous) => ({ ...previous, projectIds: normalizedProjectIds }));
  }, [allowedProjectIds, data, filters.projectIds, setFilters]);

  useEffect(() => {
    if (!data) return;
    const normalizedAssigneeIds = normalizeAssigneeIds(filters.assigneeIds, allowedAssigneeIds);
    if (normalizedAssigneeIds.length === filters.assigneeIds.length) return;
    setFilters((previous) => ({ ...previous, assigneeIds: normalizedAssigneeIds }));
  }, [allowedAssigneeIds, data, filters.assigneeIds, setFilters]);

  useEffect(() => {
    if (!data) return;
    const normalizedTrackerIds = normalizeTrackerIds(filters.trackerIds, allowedTrackerIds);
    if (normalizedTrackerIds.length === filters.trackerIds.length) return;
    setFilters((previous) => ({ ...previous, trackerIds: normalizedTrackerIds }));
  }, [allowedTrackerIds, data, filters.trackerIds, setFilters]);

  return { allowedProjectIds, creatableProjectIds, projectOptions };
}
