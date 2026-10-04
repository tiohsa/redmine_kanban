import type { BoardFilterOptions, BoardMetadata, Column, ProjectListItem } from '../../model/board/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isProject(value: unknown): value is ProjectListItem {
  return isRecord(value) && isPositiveId(value.id) && typeof value.name === 'string' &&
    Number.isSafeInteger(value.level) && (value.level as number) >= 0;
}

function isStatus(value: unknown): value is Column {
  return isRecord(value) && isPositiveId(value.id) && typeof value.name === 'string' && typeof value.is_closed === 'boolean';
}

function isProjectScopedOption(value: unknown): boolean {
  return isRecord(value) && isPositiveId(value.id) && typeof value.name === 'string' &&
    Array.isArray(value.available_project_ids) && value.available_project_ids.every(isPositiveId);
}

function isPriorityOption(value: unknown): boolean {
  return isRecord(value) && isPositiveId(value.id) && typeof value.name === 'string';
}

function isFilterOptions(value: unknown): value is BoardFilterOptions {
  return isRecord(value) && Array.isArray(value.assignees) && value.assignees.every(isProjectScopedOption) &&
    Array.isArray(value.trackers) && value.trackers.every(isProjectScopedOption) &&
    Array.isArray(value.priorities) && value.priorities.every(isPriorityOption);
}

export function parseBoardMetadata(value: unknown): BoardMetadata {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.board) || !isPositiveId(value.board.id) ||
    typeof value.board.identifier !== 'string' || typeof value.board.name !== 'string' ||
    !Number.isSafeInteger(value.server_entity_limit) || (value.server_entity_limit as number) < 1 ||
    !Array.isArray(value.projects) || !value.projects.every(isProject) ||
    !Array.isArray(value.viewable_projects) || !value.viewable_projects.every(isProject) ||
    !Array.isArray(value.statuses) || !value.statuses.every(isStatus) || !isFilterOptions(value.filter_options) ||
    typeof value.filter_options_complete !== 'boolean' ||
    (value.filter_options_complete && value.filter_options_error !== undefined) ||
    (!value.filter_options_complete && (!isRecord(value.filter_options_error) ||
      value.filter_options_error.code !== 'BOARD_FILTER_OPTIONS_TOO_LARGE' ||
      typeof value.filter_options_error.resource !== 'string' ||
      !Number.isSafeInteger(value.filter_options_error.limit) || (value.filter_options_error.limit as number) < 1)) ||
    (!value.filter_options_complete && (value.filter_options.assignees.length > 0 || value.filter_options.trackers.length > 0 || value.filter_options.priorities.length > 0))) {
    throw new Error('Invalid board metadata');
  }
  return value as unknown as BoardMetadata;
}
