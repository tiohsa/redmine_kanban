import { describe, expect, it } from 'vitest';
import { transitionDragPhase, type DragLifecycleEvent, type DragPhase } from './dragInteraction';

describe('drag interaction phases', () => {
  const transition = (phase: DragPhase, ...events: DragLifecycleEvent[]) => events.reduce(
    (current, event) => transitionDragPhase(current, event),
  phase);

  it('moves from idle through pressed and dragging to pending drop', () => {
    expect(transition('idle', 'pointerdown', 'threshold-reached', 'pointerup-dispatch')).toBe('pending-drop');
  });

  it('clears active drag on pointer cancellation', () => {
    expect(transition('dragging', 'pointercancel')).toBe('idle');
  });

  it('keeps pending drop across normal pointer capture lifecycle events', () => {
    expect(transition('pending-drop', 'lostpointercapture', 'pointerleave')).toBe('pending-drop');
  });

  it('clears pending drop only after authoritative resolution, failure, or fallback', () => {
    expect(transition('pending-drop', 'target-observed')).toBe('idle');
    expect(transition('pending-drop', 'mutation-failed')).toBe('idle');
    expect(transition('pending-drop', 'fallback-timeout')).toBe('idle');
  });
});
