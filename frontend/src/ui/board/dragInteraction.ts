export type DragPhase = 'idle' | 'pressed' | 'dragging' | 'pending-drop';

export type DragLifecycleEvent =
  | 'pointerdown'
  | 'threshold-reached'
  | 'pointerup-dispatch'
  | 'pointerup-rejected'
  | 'pointerup-cancel'
  | 'pointercancel'
  | 'lostpointercapture'
  | 'pointerleave'
  | 'target-observed'
  | 'mutation-failed'
  | 'fallback-timeout';

export function transitionDragPhase(phase: DragPhase, event: DragLifecycleEvent): DragPhase {
  switch (event) {
    case 'pointerdown':
      return phase === 'idle' ? 'pressed' : phase;
    case 'threshold-reached':
      return phase === 'pressed' ? 'dragging' : phase;
    case 'pointerup-dispatch':
      return phase === 'dragging' ? 'pending-drop' : phase;
    case 'pointerup-rejected':
      return phase === 'dragging' ? 'idle' : phase;
    case 'pointerup-cancel':
    case 'pointercancel':
    case 'lostpointercapture':
    case 'pointerleave':
      return phase === 'pending-drop' ? phase : 'idle';
    case 'target-observed':
    case 'mutation-failed':
    case 'fallback-timeout':
      return phase === 'pending-drop' ? 'idle' : phase;
  }
}
