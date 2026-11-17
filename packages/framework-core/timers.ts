export type CancelTimer = () => void;

export function scheduleOnce(callback: () => void, delayMs: number): CancelTimer {
  const timerId = setTimeout(callback, delayMs);
  return () => {
    clearTimeout(timerId);
  };
}

export function scheduleInterval(callback: () => void, intervalMs: number): CancelTimer {
  const intervalId = setInterval(callback, intervalMs);
  return () => {
    clearInterval(intervalId);
  };
}
