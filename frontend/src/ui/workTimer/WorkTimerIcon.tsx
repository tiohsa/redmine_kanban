type WorkTimerIconProps = {
  state: 'start' | 'running' | 'pending';
  size?: number;
};

export function WorkTimerIcon({ state, size = 28 }: WorkTimerIconProps) {
  return (
    <svg aria-hidden="true" className={`rk-work-timer-icon rk-work-timer-icon-${state}`} width={size} height={size} viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="22.5" />
      {state === 'start' ? <path className="rk-work-timer-icon-fill" d="M19 15.5v17l14-8.5-14-8.5Z" /> : null}
      {state === 'running' ? <><path d="M19 8h10M24 8v5M31 13l3-3" /><circle cx="24" cy="26" r="12" /><path d="M24 18v8" /></> : null}
      {state === 'pending' ? <g transform="translate(1 1)"><path d="M14 21H9v-7M9.5 14.5A15 15 0 1 1 11 33" /><path d="M24 16v9l6 4" /></g> : null}
    </svg>
  );
}
