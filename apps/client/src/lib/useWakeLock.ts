import { useEffect } from 'react';

/**
 * Keep the screen on while `enabled`. The browser drops the lock whenever the tab is hidden, so
 * it is requested again each time the page becomes visible. Needs HTTPS or localhost; elsewhere
 * (plain http on a LAN address) the API is missing and this quietly does nothing.
 */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return;

    let cancelled = false;
    let sentinel: WakeLockSentinel | null = null;

    const acquire = async () => {
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (cancelled) {
          await lock.release();
          return;
        }
        sentinel = lock;
      } catch {
        // Refused (low battery, background tab). It is retried on the next visibilitychange.
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void sentinel?.release().catch(() => undefined);
    };
  }, [enabled]);
}
