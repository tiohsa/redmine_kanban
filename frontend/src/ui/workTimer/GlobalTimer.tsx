import { useEffect, useState } from 'react';
import { PendingWorkModal } from './PendingWorkModal';
import { TIMER_INTERVAL_MINUTES } from './timerTypes';
import type { TimerIntervalMinutes, TimerSession } from './timerTypes';
import { WorkTimerIcon } from './WorkTimerIcon';
import { recordingStatusLabel } from './recordingStatusLabel';

type Props = {
  labels: Record<string, string>; session: TimerSession | null; remoteOwner: boolean;
  onExtend: (minutes: TimerIntervalMinutes) => void; onStop: () => void; onRecord: () => void; onResume: (minutes: TimerIntervalMinutes) => void; onDiscard: () => void;
  onResolveUnknown: (resolution: 'recorded' | 'unregistered') => void; onRecover: () => void;
};
const duration = (milliseconds: number) => { const seconds = Math.floor(Math.max(0, milliseconds) / 1000); return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; };
const minuteLabel = (labels: Record<string, string>, minutes: number) => `+${(labels.timer_minutes ?? '%{count} min').replace('%{count}', String(minutes))}`;

export function GlobalTimer({ labels, session, onExtend, onStop, onRecord, onResume, onDiscard, onResolveUnknown, onRecover, remoteOwner }: Props) {
  const [now, setNow] = useState(Date.now());
  const [isExtendMenuOpen, setIsExtendMenuOpen] = useState(false);
  const [isManageOpen, setIsManageOpen] = useState(false);
  useEffect(() => { if (!session || session.state === 'stopped_pending_record') return; setNow(Date.now()); const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, [session]);
  useEffect(() => { if (!session) setIsManageOpen(false); }, [session]);
  if (!session) return null;
  const elapsed = session.segments.reduce((total, part) => total + Math.max(0, (part.stoppedAt ?? now) - part.startedAt), 0);
  const remaining = session.deadlineAt ? Math.max(0, session.deadlineAt - now) : 0;
  const overrun = session.deadlineAt ? Math.max(0, now - session.deadlineAt) : 0;
  const isPending = session.state === 'stopped_pending_record';
  const isExpired = session.state === 'expired';
  const needsManagement = Boolean(session.recordingAttempt);

  return <>
    <aside className={`rk-work-timer rk-work-timer-${isPending ? 'pending' : 'running'}`} aria-label={labels.work_timer ?? 'Work timer'} data-testid="global-timer" data-state={session.state}>
      <div className="rk-work-timer-status-icon" data-testid="global-timer-icon"><WorkTimerIcon state={isPending ? 'pending' : 'running'} /></div>
      <div className="rk-work-timer-details">
        <strong className="rk-work-timer-subject" title={`#${session.issueId} ${session.subject}`} data-testid="global-timer-subject">#{session.issueId} {session.subject}</strong>
        <div className="rk-work-timer-time">
          {isPending ? <span className="rk-work-timer-warning" data-testid="global-timer-pending-text">{recordingStatusLabel(labels, session.recordingAttempt) ?? (labels.timer_pending ?? 'There is unrecorded work time')}: <b>{duration(elapsed)}</b></span> : <>
            <span className={isExpired ? 'rk-work-timer-overrun' : 'rk-work-timer-remaining'} data-testid={isExpired ? 'global-timer-overrun' : 'global-timer-remaining'}>{isExpired ? (labels.timer_overrun ?? 'Overrun') : (labels.timer_remaining ?? 'Remaining')} {duration(isExpired ? overrun : remaining)}</span>
            <span aria-hidden="true">/</span><span data-testid="global-timer-elapsed">{labels.timer_elapsed ?? 'Elapsed'} {duration(elapsed)}</span>
          </>}
        </div>
      </div>
      <div className="rk-work-timer-actions">
        {isPending ? <>
          <button type="button" className="rk-timer-button rk-timer-button-primary" data-testid="global-timer-record-button" onClick={needsManagement ? () => setIsManageOpen(true) : onRecord}>📝 {needsManagement ? (labels.timer_recover_action ?? 'Review recording') : (labels.timer_record ?? 'Record work time')}</button>
          <button type="button" className="rk-timer-button rk-timer-button-secondary" data-testid="global-timer-manage-button" onClick={() => setIsManageOpen(true)}>{labels.timer_manage ?? 'Manage pending work'}</button>
        </> : <>
          <button type="button" className="rk-timer-button rk-timer-button-dark-secondary" data-testid="global-timer-quick-extend" onClick={() => onExtend(15)}>{minuteLabel(labels, 15)}</button>
          <div className="rk-work-timer-extend">
            <button type="button" className="rk-timer-button rk-timer-button-icon" aria-label={labels.timer_extend ?? 'Extend timer'} aria-expanded={isExtendMenuOpen} data-testid="global-timer-extend-menu-toggle" onClick={() => setIsExtendMenuOpen((open) => !open)}>▾</button>
            {isExtendMenuOpen ? <div className="rk-work-timer-extend-menu" role="menu" data-testid="global-timer-extend-menu">{TIMER_INTERVAL_MINUTES.map((minutes) => <button key={minutes} type="button" role="menuitem" onClick={() => { setIsExtendMenuOpen(false); onExtend(minutes); }}>{minuteLabel(labels, minutes)}</button>)}</div> : null}
          </div>
          <button type="button" className="rk-timer-button rk-timer-button-danger" data-testid="global-timer-stop-button" onClick={onStop}>{labels.timer_stop ?? 'Stop timer'}</button>
        </>}
      </div>
    </aside>
    {isManageOpen && isPending ? <PendingWorkModal labels={labels} session={session} remoteOwner={remoteOwner} onClose={() => setIsManageOpen(false)} onRecord={() => { setIsManageOpen(false); onRecord(); }} onResume={(minutes) => { setIsManageOpen(false); onResume(minutes); }} onDiscard={() => { setIsManageOpen(false); onDiscard(); }} onRecover={() => { setIsManageOpen(false); onRecover(); }} onResolveUnknown={(resolution) => { setIsManageOpen(false); onResolveUnknown(resolution); }} /> : null}
  </>;
}
