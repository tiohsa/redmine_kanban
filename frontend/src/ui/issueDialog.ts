import type { BoardData } from './types';

export type ModalContext = { statusId: number; laneId?: string | number; issueId?: number; projectId?: number };

export function buildDefaultIssueCreateUrl(
  baseUrl: string,
  projectId: number | undefined,
  effectiveLaneType: BoardData['meta']['lane_type'] | undefined,
  ctx: ModalContext,
): string {
  const projectUrl = baseUrl.replace(/\/kanban$/, '');
  const params = new URLSearchParams();
  const effectiveProjectId = ctx.projectId ?? projectId;

  if (effectiveProjectId) {
    params.append('project_id', String(effectiveProjectId));
  }
  if (ctx.statusId) {
    params.append('issue[status_id]', String(ctx.statusId));
  }
  if (ctx.laneId && effectiveLaneType === 'assignee' && ctx.laneId !== 'unassigned' && ctx.laneId !== 'none') {
    params.append('issue[assigned_to_id]', String(ctx.laneId));
  }
  if (ctx.laneId !== undefined && effectiveLaneType === 'priority') {
    if (ctx.laneId === 'no_priority') {
      params.append('issue[priority_id]', '');
    } else if (ctx.laneId !== 'none') {
      params.append('issue[priority_id]', String(ctx.laneId));
    }
  }

  const query = params.toString();
  return query ? `${projectUrl}/issues/new?${query}` : `${projectUrl}/issues/new`;
}
