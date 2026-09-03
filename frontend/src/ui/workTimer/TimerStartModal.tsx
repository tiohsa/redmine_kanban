import { useEffect, useState } from 'react';
import type { Issue } from '../types';
import { TIMER_INTERVAL_MINUTES } from './timerTypes';
import type { TimerIntervalMinutes } from './timerTypes';
import { WorkTimerIcon } from './WorkTimerIcon';

type Props = { labels: Record<string, string>; startIssue: Issue | null; autoStop: boolean; onCloseStart: () => void; onStart: (minutes: TimerIntervalMinutes, autoStop: boolean) => void };
const minuteLabel = (labels: Record<string, string>, minutes: number) => (labels.timer_minutes ?? '%{count} min').replace('%{count}', String(minutes));

export function TimerStartModal({ labels, startIssue, autoStop: initialAutoStop, onCloseStart, onStart }: Props) {
  const [minutes, setMinutes] = useState<TimerIntervalMinutes>(30);
  const [autoStop, setAutoStop] = useState(initialAutoStop);
  useEffect(() => { setMinutes(30); setAutoStop(initialAutoStop); }, [initialAutoStop, startIssue?.id]);
  useEffect(() => { if (!startIssue) return; const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onCloseStart(); }; window.addEventListener('keydown', closeOnEscape); return () => window.removeEventListener('keydown', closeOnEscape); }, [onCloseStart, startIssue]);
  if (!startIssue) return null;
  return (
    <div className="rk-modal-backdrop rk-work-timer-backdrop" role="dialog" aria-modal="true" aria-labelledby="rk-work-timer-start-title" data-testid="timer-start-modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onCloseStart(); }}>
      <section className="rk-work-timer-modal" data-testid="timer-start-modal">
        <header className="rk-work-timer-modal-header">
          <div id="rk-work-timer-start-title" className="rk-work-timer-eyebrow"><WorkTimerIcon state="start" size={18} /><span>{labels.work_timer ?? 'Work timer'}</span></div>
          <h2 title={`#${startIssue.id} ${startIssue.subject}`}>#{startIssue.id} {startIssue.subject}</h2>
        </header>
        <fieldset className="rk-work-timer-duration">
          <legend>{labels.timer_duration ?? 'Duration'}</legend>
          <div className="rk-work-timer-duration-options">
            {TIMER_INTERVAL_MINUTES.map((value) => <button key={value} type="button" className={`rk-work-timer-duration-button${minutes === value ? ' is-selected' : ''}`} aria-pressed={minutes === value} data-testid={`timer-duration-button-${value}`} onClick={() => setMinutes(value)}>{minuteLabel(labels, value)}</button>)}
          </div>
        </fieldset>
        <label className="rk-work-timer-autostop"><input type="checkbox" checked={autoStop} data-testid="timer-autostop-checkbox" onChange={(event) => setAutoStop(event.target.checked)} /><span>{labels.timer_auto_stop ?? 'Stop automatically when time is up'}</span></label>
        <footer className="rk-work-timer-modal-footer">
          <button type="button" className="rk-timer-button rk-timer-button-light" onClick={onCloseStart}>{labels.cancel ?? 'Cancel'}</button>
          <button type="button" className="rk-timer-button rk-timer-button-primary" onClick={() => onStart(minutes, autoStop)}>{labels.timer_start ?? 'Start timer'}</button>
        </footer>
      </section>
    </div>
  );
}
