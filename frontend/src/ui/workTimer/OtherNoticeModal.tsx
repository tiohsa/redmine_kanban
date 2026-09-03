import type { TimerSession } from './timerTypes';
import { WorkTimerIcon } from './WorkTimerIcon';

type Props = { labels: Record<string, string>; session: TimerSession | null; onClose: () => void };

export function OtherNoticeModal({ labels, session, onClose }: Props) {
  if (!session) return null;
  const pending = session.state === 'stopped_pending_record';
  return (
    <div className="rk-modal-backdrop rk-work-timer-backdrop" role="dialog" aria-modal="true" aria-labelledby="rk-other-timer-title" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="rk-work-timer-modal rk-other-timer-modal">
        <header className="rk-work-timer-modal-header">
          <div className={`rk-work-timer-eyebrow${pending ? ' rk-work-timer-eyebrow-warning' : ''}`}><WorkTimerIcon state={pending ? 'pending' : 'running'} size={18} /><span>{labels.work_timer ?? 'Work timer'}</span></div>
          <h2 id="rk-other-timer-title">{pending ? (labels.timer_pending_elsewhere ?? 'There is unrecorded work time') : (labels.timer_running_elsewhere ?? 'Another work timer is running')}</h2>
        </header>
        <p>#{session.issueId} {session.subject}</p>
        <footer className="rk-work-timer-modal-footer"><button type="button" className="rk-timer-button rk-timer-button-primary" onClick={onClose}>{labels.close ?? 'Close'}</button></footer>
      </section>
    </div>
  );
}
