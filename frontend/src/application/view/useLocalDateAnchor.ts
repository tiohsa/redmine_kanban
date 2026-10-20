import { useCallback, useEffect, useState } from 'react';
import { localDateAnchor } from '../../model/board/filterScope';

const RESUME_EVENTS = ['focus', 'pageshow'] as const;

/** Keeps date-only filter identity aligned with the user's local calendar day. */
export function useLocalDateAnchor(): { dateAnchor: string; syncDateAnchor: () => boolean } {
  const [dateAnchor, setDateAnchor] = useState(() => localDateAnchor());
  const syncDateAnchor = useCallback(() => {
    const currentDateAnchor = localDateAnchor();
    setDateAnchor(currentDateAnchor);
    return currentDateAnchor !== dateAnchor;
  }, [dateAnchor]);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const scheduleMidnightSync = () => {
      clearTimeout(timeout);
      const now = new Date();
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timeout = setTimeout(() => {
        syncDateAnchor();
        scheduleMidnightSync();
      }, Math.max(1, nextMidnight.getTime() - now.getTime()));
    };
    const syncAndReschedule = () => {
      syncDateAnchor();
      scheduleMidnightSync();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') syncAndReschedule();
    };

    syncDateAnchor();
    scheduleMidnightSync();
    RESUME_EVENTS.forEach((event) => window.addEventListener(event, syncAndReschedule));
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      clearTimeout(timeout);
      RESUME_EVENTS.forEach((event) => window.removeEventListener(event, syncAndReschedule));
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [syncDateAnchor]);

  return { dateAnchor, syncDateAnchor };
}
