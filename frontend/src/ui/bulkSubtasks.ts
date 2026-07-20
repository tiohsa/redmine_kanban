export const MAX_BULK_SUBTASKS = 50;

export type SubtaskDraft = {
  id: string;
  subject: string;
  trackerId: number;
};

export type SubtaskCreateInput = {
  clientId: string;
  subject: string;
  trackerId: number;
};

export type BulkSubtaskState = {
  mode: 'text' | 'table';
  text: string;
  defaultTrackerId: number | null;
  drafts: SubtaskDraft[];
  preservedDrafts: SubtaskDraft[];
};

export function normalizeSubject(subject: string): string {
  return subject.replace(/\r\n?/g, '\n').trim();
}

export function extractSubjects(text: string): string[] {
  return text.split(/\r\n?|\n/).map(normalizeSubject).filter(Boolean);
}

let nextDraftId = 0;
export function createDraftId(): string {
  nextDraftId += 1;
  return `subtask-${nextDraftId}`;
}

function occurrenceKey(subject: string, occurrence: number): string {
  return `${normalizeSubject(subject)}\u0000${occurrence}`;
}

export function draftsFromText(
  text: string,
  defaultTrackerId: number,
  preservedDrafts: SubtaskDraft[] = [],
): { drafts: SubtaskDraft[]; restoredCount: number; newCount: number } {
  const used = new Set<string>();
  const occurrences = new Map<string, number>();
  let restoredCount = 0;
  let newCount = 0;
  const drafts = extractSubjects(text).map((subject) => {
    const occurrence = (occurrences.get(subject) ?? 0) + 1;
    occurrences.set(subject, occurrence);
    const key = occurrenceKey(subject, occurrence);
    const preserved = preservedDrafts.find((draft) => {
      const candidateKey = occurrenceKey(draft.subject, occurrence);
      return candidateKey === key && !used.has(draft.id);
    });
    if (preserved) {
      used.add(preserved.id);
      restoredCount += 1;
      return { ...preserved, subject };
    }
    newCount += 1;
    return { id: createDraftId(), subject, trackerId: defaultTrackerId };
  });
  return { drafts, restoredCount, newCount };
}

export function draftsToText(drafts: SubtaskDraft[]): string {
  return drafts.map((draft) => normalizeSubject(draft.subject)).filter(Boolean).join('\n');
}

export function draftsToCreateInputs(drafts: SubtaskDraft[]): SubtaskCreateInput[] {
  return drafts
    .map((draft) => ({ clientId: draft.id, subject: normalizeSubject(draft.subject), trackerId: draft.trackerId }))
    .filter((draft) => draft.subject.length > 0);
}

export function validateSubtaskInputs(
  inputs: SubtaskCreateInput[],
  validTrackerIds: Set<number>,
  emptySubjectMessage: string,
  invalidTrackerMessage: string,
  maxMessage: string,
): string | null {
  if (inputs.length > MAX_BULK_SUBTASKS) return maxMessage;
  if (inputs.some((input) => !input.subject)) return emptySubjectMessage;
  if (inputs.some((input) => !validTrackerIds.has(input.trackerId))) return invalidTrackerMessage;
  return null;
}
