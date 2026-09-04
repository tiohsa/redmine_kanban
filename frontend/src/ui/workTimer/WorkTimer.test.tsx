// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Issue } from '../types';
import { createTimerSession, stop } from './timerDomain';
import { GlobalTimer, TimerStartModal } from './WorkTimer';

const labels = {
  work_timer: '作業タイマー', timer_duration: '予定工数', timer_minutes: '%{count}分', timer_auto_stop: '時間になったら自動停止',
  timer_start: 'タイマーを開始', timer_remaining: '残り', timer_elapsed: '経過', timer_overrun: '超過', timer_stop: 'タイマーを停止',
  timer_extend: 'タイマーを延長', timer_pending: '未登録の作業時間があります', timer_record: '作業時間を記録', timer_manage: '未登録作業を管理',
  timer_resume: 'タイマーを再開（+15分）', timer_discard: '破棄', timer_discard_confirm: 'この未登録作業時間を破棄しますか？',
  timer_pending_record_desc: 'Redmineの作業時間入力フォームを開いて、この作業時間を登録します。', timer_or: 'または',
  timer_pending_resume_section: '作業を続ける', timer_pending_resume_desc: 'タイマーを再開し、記録前に作業時間を追加します。',
  timer_editing: '作業時間を入力中', timer_submitting: '作業時間を登録処理中', timer_unknown: '作業時間の登録結果を確認できませんでした。',
  cancel: 'キャンセル', close: '閉じる',
};
const callbacks = () => ({ onExtend: vi.fn(), onStop: vi.fn(), onRecord: vi.fn(), onResume: vi.fn(), onDiscard: vi.fn(), onResolveUnknown: vi.fn(), onRecover: vi.fn() });

describe('WorkTimer UI', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(31_000); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('renders the start dialog with 30 minutes selected and pill choices', () => {
    const onStart = vi.fn();
    render(<TimerStartModal labels={labels} startIssue={{ id: 337, subject: '長いチケット件名', can_log_time: true } as Issue} autoStop={false} onCloseStart={() => {}} onStart={onStart} />);
    expect(screen.getByText('作業タイマー')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '#337 長いチケット件名' })).toBeTruthy();
    expect(screen.getByText('予定工数')).toBeTruthy();
    expect(screen.getAllByTestId(/timer-duration-button-/).map((button) => button.textContent)).toEqual(['5分', '10分', '15分', '30分', '60分']);
    const selected = screen.getByRole('button', { name: '30分' });
    expect(selected.getAttribute('aria-pressed')).toBe('true');
    expect(selected.className).toContain('is-selected');
    expect(screen.getByLabelText('時間になったら自動停止')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'タイマーを開始' }));
    expect(onStart).toHaveBeenCalledWith(30, false);
  });

  it('renders the dark running timer with quick and dropdown extension actions', () => {
    const actions = callbacks();
    const session = createTimerSession(2, 'Add ingredients categories', 30, false, 7, 1_000);
    render(<GlobalTimer labels={labels} session={session} remoteOwner={false} {...actions} />);
    expect(screen.getByTestId('global-timer').className).toContain('rk-work-timer-running');
    expect(screen.getByTestId('global-timer-subject').textContent).toContain('#2 Add ingredients categories');
    expect(screen.getByTestId('global-timer-remaining').textContent).toContain('残り 0:29:30');
    expect(screen.getByTestId('global-timer-elapsed').textContent).toContain('経過 0:00:30');
    fireEvent.click(screen.getByRole('button', { name: '+15分' }));
    expect(actions.onExtend).toHaveBeenCalledWith(15);
    fireEvent.click(screen.getByRole('button', { name: 'タイマーを延長' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '+30分' }));
    expect(actions.onExtend).toHaveBeenCalledWith(30);
    expect(screen.getByRole('button', { name: 'タイマーを停止' })).toBeTruthy();
  });

  it('renders the warm pending timer and opens all pending management actions', () => {
    const actions = callbacks();
    const session = stop(createTimerSession(2, 'Pending task', 30, false, 7, 1_000), 9_000);
    render(<GlobalTimer labels={labels} session={session} remoteOwner={false} {...actions} />);
    expect(screen.getByTestId('global-timer').className).toContain('rk-work-timer-pending');
    expect(screen.getByTestId('global-timer-pending-text').textContent).toContain('未登録の作業時間があります: 0:00:08');
    expect(screen.getByRole('button', { name: /作業時間を記録/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '未登録作業を管理' }));
    const pendingModal = screen.getByTestId('pending-work-modal');
    expect(pendingModal).toBeTruthy();
    expect(screen.getByRole('heading', { name: '未登録の作業時間があります' })).toBeTruthy();
    expect(within(pendingModal).getByText('#2 Pending task')).toBeTruthy();
    expect(screen.getByTestId('pending-work-elapsed-value').textContent).toBe('0:00:08');
    expect(screen.getByText('Redmineの作業時間入力フォームを開いて、この作業時間を登録します。')).toBeTruthy();
    expect(screen.getByTestId('pending-work-record-button')).toBeTruthy();
    expect(screen.getByText('または')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '作業を続ける' })).toBeTruthy();
    expect(screen.getByTestId('pending-work-resume-options').textContent).toBe('+5分+10分+15分+30分+60分');
    fireEvent.click(screen.getByTestId('pending-work-discard-button'));
    expect(screen.getByTestId('pending-work-discard-confirm-panel')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    fireEvent.click(screen.getByTestId('pending-work-resume-button-30'));
    expect(actions.onResume).toHaveBeenCalledWith(30);
  });

  it('keeps the running surface and shows red overrun text when expired', () => {
    const actions = callbacks();
    render(<GlobalTimer labels={labels} session={{ ...createTimerSession(2, 'Expired task', 5, false, 7, 1_000), state: 'expired', deadlineAt: 30_000 }} remoteOwner={false} {...actions} />);
    expect(screen.getByTestId('global-timer').className).toContain('rk-work-timer-running');
    expect(screen.getByTestId('global-timer-overrun').textContent).toBe('超過 0:00:01');
    expect(screen.getByRole('button', { name: 'タイマーを停止' })).toBeTruthy();
  });

  it.each(['editing', 'submitting', 'unknown'] as const)('shows the %s recording state without offering resume or discard', (phase) => {
    const actions = callbacks();
    const session = {
      ...stop(createTimerSession(2, 'Pending task', 30, false, 7, 1_000), 9_000),
      recordingAttempt: { id: 'attempt', ownerTabId: 'this-tab', openedAt: 9_000, phase },
    };
    render(<GlobalTimer labels={labels} session={session} remoteOwner={false} {...actions} />);
    expect(screen.getByTestId('global-timer-pending-text').textContent).toContain(labels[`timer_${phase}`]);
    fireEvent.click(screen.getByTestId('global-timer-manage-button'));
    expect(within(screen.getByTestId('pending-work-modal')).getByText(labels[`timer_${phase}`])).toBeTruthy();
    expect(screen.queryByTestId('pending-work-resume-options')).toBeNull();
    expect(screen.queryByTestId('pending-work-discard-button')).toBeNull();
    expect(screen.queryByTestId('pending-work-record-button')).toBeNull();
    if (phase === 'unknown') {
      fireEvent.click(screen.getByRole('button', { name: 'Re-enter' }));
      expect(actions.onResolveUnknown).toHaveBeenCalledWith('unregistered');
    }
  });

  it('keeps recovery available for a recording owned by another tab', () => {
    const actions = callbacks();
    const session = {
      ...stop(createTimerSession(2, 'Pending task', 30, false, 7, 1_000), 9_000),
      recordingAttempt: { id: 'attempt', ownerTabId: 'other-tab', openedAt: 9_000, phase: 'submitting' as const },
    };
    render(<GlobalTimer labels={labels} session={session} remoteOwner {...actions} />);
    fireEvent.click(screen.getByTestId('global-timer-manage-button'));
    fireEvent.click(screen.getByRole('button', { name: 'Recover in this tab' }));
    expect(actions.onRecover).toHaveBeenCalledOnce();
  });
});
