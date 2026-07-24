import { describe, expect, it } from 'vitest';
import { draftsFromText, draftsToCreateInputs, draftsToText, extractSubjects, preserveDraftsForText, validateSubtaskInputs } from './bulkSubtasks';

describe('bulk subtask conversions', () => {
  it('normalizes lines and ignores empty rows', () => {
    expect(extractSubjects(' A \n\nB\r\n C ')).toEqual(['A', 'B', 'C']);
  });

  it('creates stable ids and applies the default tracker', () => {
    const result = draftsFromText('A\nB', 2);
    expect(result.drafts).toHaveLength(2);
    expect(result.drafts[0].id).not.toBe(result.drafts[1].id);
    expect(result.drafts.map((draft) => draft.trackerId)).toEqual([2, 2]);
  });

  it('restores by subject and duplicate occurrence, not by position', () => {
    const original = draftsFromText('A\nB\nA', 1).drafts.map((draft, index) => ({
      ...draft,
      trackerId: index + 10,
    }));
    const result = draftsFromText('A\nA\nB', 1, original);
    expect(result.drafts.map((draft) => draft.trackerId)).toEqual([10, 12, 11]);
    expect(result.restoredCount).toBe(3);
  });

  it('treats a renamed textarea row as new and does not restore deleted rows', () => {
    const original = draftsFromText('A\nB', 1).drafts.map((draft) => ({ ...draft, trackerId: 9 }));
    const result = draftsFromText('Changed', 2, original);
    expect(result.restoredCount).toBe(0);
    expect(result.newCount).toBe(1);
    expect(result.drafts[0].trackerId).toBe(2);
    expect(result.drafts.some((draft) => draft.subject === 'B')).toBe(false);
  });

  it('serializes only server-safe fields after filtering empty subjects', () => {
    const drafts = draftsFromText('A\n\nB', 1).drafts;
    expect(draftsToText(drafts)).toBe('A\nB');
    expect(draftsToCreateInputs(drafts)).toEqual([
      { clientId: drafts[0].id, subject: 'A', trackerId: 1 },
      { clientId: drafts[1].id, subject: 'B', trackerId: 1 },
    ]);
  });

  it('drops preserved rows removed from text before they can be restored', () => {
    const original = draftsFromText('A\nB', 1).drafts.map((draft, index) => ({ ...draft, trackerId: index + 10 }));
    const afterDelete = preserveDraftsForText('A', original);
    const afterReadd = draftsFromText('A\nB', 2, afterDelete);

    expect(afterReadd.drafts.map((draft) => draft.trackerId)).toEqual([10, 2]);
    expect(afterReadd.restoredCount).toBe(1);
  });

  it('keeps all rows when text is only reordered', () => {
    const original = draftsFromText('A\nB', 1).drafts;
    expect(preserveDraftsForText('B\nA', original)).toEqual(original);
  });

  it('counts only non-empty rows against the bulk limit', () => {
    const validRows = Array.from({ length: 50 }, (_, index) => ({ id: `row-${index}`, subject: `Row ${index}`, trackerId: 1 }));
    const withEmptyRow = draftsToCreateInputs([...validRows, { id: 'empty', subject: '  ', trackerId: 999 }]);
    expect(withEmptyRow).toHaveLength(50);
    expect(validateSubtaskInputs(withEmptyRow, new Set([1]), 'empty', 'invalid', 'too many')).toBeNull();

    const tooMany = draftsToCreateInputs([...validRows, { id: 'extra', subject: 'Extra', trackerId: 1 }]);
    expect(validateSubtaskInputs(tooMany, new Set([1]), 'empty', 'invalid', 'too many')).toBe('too many');
  });
});
