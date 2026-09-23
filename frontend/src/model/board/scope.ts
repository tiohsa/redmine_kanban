import type { BoardData } from './types';

export function effectiveScopeStatusIds(data: BoardData): number[] {
  return data.meta.scope_status_ids ?? data.columns.map((column) => column.id);
}

export function effectiveDependencyStatusIds(data: BoardData): number[] {
  return data.meta.dependency_status_ids ?? effectiveScopeStatusIds(data);
}
