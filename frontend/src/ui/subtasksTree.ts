import type { Subtask } from './types';

export type FlattenedSubtaskRow = {
  depth: number;
  subtask: Subtask;
};

export function flattenSubtasks(subtasks?: Subtask[], depth = 0): FlattenedSubtaskRow[] {
  if (!subtasks || subtasks.length === 0) return [];

  const rows: FlattenedSubtaskRow[] = [];
  for (const subtask of subtasks) {
    rows.push({ depth, subtask });
    if (subtask.subtasks?.length) {
      rows.push(...flattenSubtasks(subtask.subtasks, depth + 1));
    }
  }
  return rows;
}

export function findSubtaskInTree(subtasks: Subtask[] | undefined, subtaskId: number): Subtask | null {
  if (!subtasks || subtasks.length === 0) return null;

  for (const subtask of subtasks) {
    if (subtask.id === subtaskId) return subtask;
    const nested = findSubtaskInTree(subtask.subtasks, subtaskId);
    if (nested) return nested;
  }
  return null;
}

export function updateSubtasksTree(
  subtasks: Subtask[] | undefined,
  targetId: number,
  patch: Partial<Subtask>
): Subtask[] | undefined {
  return updateSubtasksTreeWith(subtasks, targetId, (subtask) => ({ ...subtask, ...patch }));
}

export function updateSubtasksTreeWith(
  subtasks: Subtask[] | undefined,
  targetId: number,
  updater: (subtask: Subtask) => Subtask,
): Subtask[] | undefined {
  if (!subtasks?.length) return subtasks;

  let changed = false;
  const next = subtasks.map((subtask) => {
    let current = subtask;
    if (subtask.id === targetId) {
      current = updater(current);
      changed = true;
    }

    const nested = updateSubtasksTreeWith(current.subtasks, targetId, updater);
    if (nested !== current.subtasks) {
      current = { ...current, subtasks: nested };
      changed = true;
    }

    return current;
  });

  return changed ? next : subtasks;
}

export function mapSubtasksTree(
  subtasks: Subtask[] | undefined,
  updater: (subtask: Subtask) => Subtask,
): Subtask[] | undefined {
  if (!subtasks?.length) return subtasks;

  let changed = false;
  const next = subtasks.map((subtask) => {
    let current = updater(subtask);
    if (current !== subtask) changed = true;
    const nested = mapSubtasksTree(current.subtasks, updater);
    if (nested !== current.subtasks) {
      current = { ...current, subtasks: nested };
      changed = true;
    }
    return current;
  });

  return changed ? next : subtasks;
}
