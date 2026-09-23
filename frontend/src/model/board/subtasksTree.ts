import type { Subtask } from './types';

export type FlattenedSubtaskRow = {
  depth: number;
  subtask: Subtask;
};

function normalizeDateOnly(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] ? value : null;
}

function compareDateNullLast(a: string | null | undefined, b: string | null | undefined): number {
  const left = normalizeDateOnly(a);
  const right = normalizeDateOnly(b);
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left < right ? -1 : 1;
}

export function compareSubtasksForDisplay(a: Subtask, b: Subtask): number {
  return compareDateNullLast(a.start_date, b.start_date)
    || compareDateNullLast(a.due_date, b.due_date)
    || a.id - b.id;
}

export function flattenSubtasks(subtasks?: Subtask[], depth = 0): FlattenedSubtaskRow[] {
  if (!subtasks || subtasks.length === 0) return [];

  const rows: FlattenedSubtaskRow[] = [];
  for (const subtask of [...subtasks].sort(compareSubtasksForDisplay)) {
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
