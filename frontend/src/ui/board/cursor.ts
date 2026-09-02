export type BoardCursor = 'default' | 'pointer' | 'move';

export type BoardCursorPhase = 'idle' | 'dragging' | 'pending-drop';

export type BoardCursorHitKind =
  | 'card'
  | 'add'
  | 'delete'
  | 'subtask_check'
  | 'subtask_subject'
  | 'subtask_row'
  | 'subtask_edit'
  | 'subtask_delete'
  | 'subtask_area'
  | 'card_subject'
  | 'edit'
  | 'work_timer'
  | 'cell'
  | 'visibility'
  | 'priority'
  | 'date'
  | 'progress'
  | 'lane_header'
  | 'empty';

type CursorOptions = {
  phase: BoardCursorPhase;
  hitKind?: BoardCursorHitKind | null;
};

export function getBoardCursor({ phase, hitKind = 'empty' }: CursorOptions): BoardCursor {
  if (phase === 'dragging') return 'move';
  if (phase === 'pending-drop') return 'default';

  switch (hitKind) {
    case 'card':
    case 'subtask_row':
    case 'subtask_area':
      return 'move';
    case 'add':
    case 'delete':
    case 'subtask_check':
    case 'subtask_subject':
    case 'subtask_edit':
    case 'subtask_delete':
    case 'card_subject':
    case 'edit':
    case 'work_timer':
    case 'visibility':
    case 'priority':
    case 'date':
    case 'progress':
      return 'pointer';
    case 'empty':
    default:
      return 'default';
  }
}
