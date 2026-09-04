import { useEffect, useState } from 'react';
import { elapsed } from './timerDomain';
import { TIMER_INTERVAL_MINUTES } from './timerTypes';
import type { TimerIntervalMinutes, TimerSession } from './timerTypes';
import { WorkTimerIcon } from './WorkTimerIcon';
import { recordingStatusLabel } from './recordingStatusLabel';

type Props = {
  labels: Record<string, string>;
  session: TimerSession;
  remoteOwner: boolean;
  onClose: () => void;
  onRecord: () => void;
  onResume: (minutes: TimerIntervalMinutes) => void;
  onDiscard: () => void;
  onRecover: () => void;
  onResolveUnknown: (resolution: 'recorded' | 'unregistered') => void;
};

const duration = (milliseconds: number) => {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};
const minuteLabel = (labels: Record<string, string>, minutes: number) => `+${(labels.timer_minutes ?? '%{count} min').replace('%{count}', String(minutes))}`;

export function PendingWorkModal({ labels, session, remoteOwner, onClose, onRecord, onResume, onDiscard, onRecover, onResolveUnknown }: Props) {
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false);
  const phase = session.recordingAttempt?.phase;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (isDiscardConfirmOpen) setIsDiscardConfirmOpen(false);
      else onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isDiscardConfirmOpen, onClose]);

  const elapsedText = duration(elapsed(session));
  const notice = recordingStatusLabel(labels, session.recordingAttempt);

  return (
    <div className="rk-modal-backdrop rk-work-timer-backdrop" role="dialog" aria-modal="true" aria-labelledby="rk-pending-work-title" data-testid="pending-work-modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="rk-work-timer-modal rk-pending-work-modal" data-testid="pending-work-modal">
        <header className="rk-pending-work-header">
          <WorkTimerIcon state="pending" size={30} />
          <div>
            <h2 id="rk-pending-work-title">{labels.timer_pending ?? 'There is unrecorded work time'}</h2>
            <p title={`#${session.issueId} ${session.subject}`}>#{session.issueId} {session.subject}</p>
          </div>
        </header>

        <div className="rk-pending-work-elapsed">
          <span>{labels.timer_elapsed ?? 'Elapsed'}:</span>
          <strong data-testid="pending-work-elapsed-value">{elapsedText}</strong>
        </div>

        {notice ? (
          <div className="rk-pending-work-state-card">
            <p>{notice}</p>
            {remoteOwner && phase !== 'unknown' ? <p>{labels.timer_other_tab ?? 'Work time is being entered in another tab.'}</p> : null}
            <div className="rk-pending-work-state-actions">
              {phase === 'unknown' ? <>
                <button type="button" className="rk-timer-button rk-timer-button-primary" onClick={() => onResolveUnknown('recorded')}>{labels.timer_mark_recorded ?? 'Mark recorded'}</button>
                <button type="button" className="rk-timer-button rk-timer-button-secondary" onClick={() => onResolveUnknown('unregistered')}>{labels.timer_reenter ?? 'Re-enter'}</button>
              </> : remoteOwner ? <button type="button" className="rk-timer-button rk-timer-button-primary" onClick={onRecover}>{labels.timer_recover ?? 'Recover in this tab'}</button> : null}
            </div>
          </div>
        ) : isDiscardConfirmOpen ? (
          <div className="rk-pending-work-discard-confirm" data-testid="pending-work-discard-confirm-panel">
            <p>{(labels.timer_discard_confirm ?? 'Discard this unrecorded work time?').replace('%{time}', elapsedText)}</p>
            <div>
              <button type="button" className="rk-timer-button rk-timer-button-secondary" onClick={() => setIsDiscardConfirmOpen(false)}>{labels.cancel ?? 'Cancel'}</button>
              <button type="button" className="rk-timer-button rk-timer-button-danger" data-testid="pending-work-discard-confirm" onClick={onDiscard}>{labels.timer_discard ?? 'Discard'}</button>
            </div>
          </div>
        ) : (
          <>
            <section className="rk-pending-work-section rk-pending-work-record-section" data-testid="pending-work-record-section">
              <p>{labels.timer_pending_record_desc ?? "Open Redmine's time-entry form and save this work time."}</p>
              <button type="button" className="rk-pending-work-record-button" data-testid="pending-work-record-button" onClick={onRecord}>📝 <span>{labels.timer_record ?? 'Record work time'}</span></button>
            </section>

            <div className="rk-pending-work-separator" data-testid="pending-work-or-separator"><span aria-hidden="true" /><b>{labels.timer_or ?? 'or'}</b><span aria-hidden="true" /></div>

            <section className="rk-pending-work-section rk-pending-work-resume-section" data-testid="pending-work-resume-section">
              <h3>{labels.timer_pending_resume_section ?? 'Continue working'}</h3>
              <p>{labels.timer_pending_resume_desc ?? 'Resume the timer and add more time before recording.'}</p>
              <div className="rk-pending-work-resume-options" data-testid="pending-work-resume-options">
                {TIMER_INTERVAL_MINUTES.map((minutes) => (
                  <button key={minutes} type="button" className="rk-pending-work-resume-button" data-testid={`pending-work-resume-button-${minutes}`} onClick={() => onResume(minutes)}>{minuteLabel(labels, minutes)}</button>
                ))}
              </div>
            </section>
          </>
        )}

        <footer className="rk-pending-work-footer">
          {!notice && !isDiscardConfirmOpen ? <button type="button" className="rk-pending-work-discard-button" data-testid="pending-work-discard-button" onClick={() => setIsDiscardConfirmOpen(true)}><span className="rk-icon" aria-hidden="true">delete_outline</span><span>{labels.timer_discard ?? 'Discard'}</span></button> : <span />}
          <button type="button" className="rk-timer-button rk-timer-button-light" data-testid="pending-work-close-button" onClick={onClose}>{labels.close ?? 'Close'}</button>
        </footer>
      </section>
    </div>
  );
}
