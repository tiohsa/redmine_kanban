import type { Issue } from '../types';
import { findSubtaskInTree } from '../subtasksTree';

export type HitResult =
  | { kind: 'card'; issueId: number }
  | { kind: 'add'; statusId: number; laneId: string | number }
  | { kind: 'delete'; issueId: number }
  | { kind: 'subtask_check'; issueId: number; subtaskId: number }
  | { kind: 'subtask_subject'; issueId: number; subtaskId: number }
  | { kind: 'subtask_row'; issueId: number; subtaskId: number }
  | { kind: 'subtask_edit'; issueId: number; subtaskId: number }
  | { kind: 'subtask_delete'; issueId: number; subtaskId: number }
  | { kind: 'subtask_area'; issueId: number }
  | { kind: 'card_subject'; issueId: number }
  | { kind: 'edit'; issueId: number }
  | { kind: 'work_timer'; issueId: number }
  | { kind: 'cell'; statusId: number; laneId: string | number }
  | { kind: 'visibility'; statusId: number }
  | { kind: 'priority'; issueId: number }
  | { kind: 'date'; issueId: number }
  | { kind: 'progress'; issueId: number }
  | { kind: 'lane_header'; laneId: string | number }
  | { kind: 'empty' };

export type HoverState = { kind: 'card_subject' | 'subtask_subject'; id: string } | null;

export type HoverSnapshot = {
  hover: HoverState;
  hoveredCardIssueId: number | null;
  hoveredSubtaskKey: string | null;
};

export type DropAction = 'noop' | 'dispatch';
export type WorkflowHint = 'allowed' | 'denied' | 'unknown';
export type DropAssessment = {
  action: DropAction;
  workflowHint: WorkflowHint;
};

export type DropHintVisual = {
  glyph: '✓' | '!' | '?' | '';
  tone: 'allowed' | 'advisory' | 'neutral' | 'noop';
};

export function assessDrop(
  originStatusId: number,
  originLaneId: string | number,
  targetStatusId: number,
  targetLaneId: string | number,
  allowedStatusIds?: number[] | ReadonlySet<number>,
): DropAssessment {
  const isNoop = originStatusId === targetStatusId && originLaneId === targetLaneId;
  let workflowHint: WorkflowHint = 'unknown';
  if (Array.isArray(allowedStatusIds)) workflowHint = allowedStatusIds.includes(targetStatusId) ? 'allowed' : 'denied';
  if (allowedStatusIds instanceof Set) workflowHint = allowedStatusIds.has(targetStatusId) ? 'allowed' : 'denied';
  return { action: isNoop ? 'noop' : 'dispatch', workflowHint };
}

export function shouldDispatchDrop(assessment: DropAssessment): boolean {
  return assessment.action === 'dispatch';
}

export function getDropHintVisual(assessment: DropAssessment): DropHintVisual {
  if (assessment.action === 'noop') return { glyph: '', tone: 'noop' };
  if (assessment.workflowHint === 'allowed') return { glyph: '✓', tone: 'allowed' };
  if (assessment.workflowHint === 'denied') return { glyph: '!', tone: 'advisory' };
  return { glyph: '?', tone: 'neutral' };
}

export function canMoveIssue(issue?: Issue | null) {
  return !!issue?.permissions?.can_move;
}

export function canEditIssue(issue?: Issue | null) {
  return !!issue?.permissions?.can_edit;
}

export function canDeleteIssue(issue?: Issue | null) {
  return !!issue?.permissions?.can_delete;
}

export function getHoverSnapshot(hit: HitResult): HoverSnapshot {
  let hoveredCardIssueId: number | null = null;
  let hoveredSubtaskKey: string | null = null;
  let hover: HoverState = null;

  switch (hit.kind) {
    case 'card':
    case 'card_subject':
    case 'edit':
    case 'work_timer':
    case 'delete':
    case 'priority':
    case 'date':
    case 'progress':
      hoveredCardIssueId = hit.issueId;
      break;
    case 'subtask_row':
    case 'subtask_subject':
    case 'subtask_check':
    case 'subtask_edit':
    case 'subtask_delete':
      hoveredSubtaskKey = `${hit.issueId}:${hit.subtaskId}`;
      break;
    default:
      break;
  }

  if (hit.kind === 'card_subject') {
    hover = { kind: 'card_subject', id: String(hit.issueId) };
  } else if (hit.kind === 'subtask_subject') {
    hover = { kind: 'subtask_subject', id: `${hit.issueId}:${hit.subtaskId}` };
  }

  return { hover, hoveredCardIssueId, hoveredSubtaskKey };
}

export function getIssueFromHover(cardsById: Map<number, Issue>, hover: HoverState): Issue | undefined {
  if (!hover) return undefined;
  const issueId = hover.kind === 'card_subject' ? Number(hover.id) : Number(hover.id.split(':')[0]);
  return cardsById.get(issueId);
}

export function getTooltipTextFromHover(issue: Issue, hover: HoverState): string | undefined {
  if (!hover) return undefined;
  if (hover.kind === 'card_subject') return issue.subject;
  const subtaskId = Number(hover.id.split(':')[1]);
  return findSubtaskInTree(issue.subtasks, subtaskId)?.subject;
}

export function subtaskPermissions(issue: Issue | undefined, subtaskId: number) {
  return findSubtaskInTree(issue?.subtasks, subtaskId)?.permissions;
}
