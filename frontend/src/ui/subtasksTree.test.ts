import { describe, expect, it } from 'vitest';
import type { Subtask } from './types';
import { flattenSubtasks } from './subtasksTree';

const child = (id: number, start_date?: string | null, due_date?: string | null): Subtask => ({ id, subject: String(id), status_id: 1, is_closed: false, start_date, due_date });
const ids = (children: Subtask[]) => flattenSubtasks(children).map(row => row.subtask.id);

describe('subtask display order', () => {
  it('orders by start, due, then ID', () => {
    expect(ids([child(30, '2026-09-11'), child(20, '2026-09-10', '2026-09-12'), child(10, '2026-09-10', '2026-09-12'), child(40, '2026-09-10', '2026-09-11')])).toEqual([40, 10, 20, 30]);
  });
  it('puts absent dates last and compares due dates when starts are absent', () => {
    expect(ids([child(50), child(40, null, '2026-09-12'), child(30, '', '2026-09-11'), child(20, '2026-09-10'), child(10, '2026-09-10', '2026-09-12')])).toEqual([10, 20, 30, 40, 50]);
    expect(ids([child(30, '', ''), child(20, null, null), child(10)])).toEqual([10, 20, 30]);
  });
  it.each(['bad', '2026-2-01', '2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00', '0000-01-01'])('treats invalid date %s as absent', invalid => {
    expect(ids([child(1, invalid), child(2, '2026-09-10')])).toEqual([2, 1]);
    expect(ids([child(1, null, invalid), child(2, null, '2026-09-10')])).toEqual([2, 1]);
  });
  it('handles leap years without timezone conversion', () => {
    expect(ids([child(1, '1900-02-29'), child(2, '2000-02-29'), child(3, '2024-02-29')])).toEqual([2, 3, 1]);
  });
  it('sorts only siblings recursively without mutating inputs', () => {
    const b = { ...child(20), subtasks: [child(22), child(21)] };
    const a = { ...child(10), subtasks: [child(12), child(11)] };
    const input = [b, a];
    const before = structuredClone(input);
    Object.freeze(input); Object.freeze(a.subtasks); Object.freeze(b.subtasks);
    expect(flattenSubtasks(input).map(({ depth, subtask }) => [depth, subtask.id])).toEqual([[0, 10], [1, 11], [1, 12], [0, 20], [1, 21], [1, 22]]);
    expect(input).toEqual(before);
    expect(flattenSubtasks(input)[0].subtask).toBe(a);
  });
});
