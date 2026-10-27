import { useSyncExternalStore } from 'react';

// A single shared ticker so every countdown on screen updates together.
let current = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      listeners.forEach((l) => l());
    }, 100);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) clearInterval(timer);
  };
}

/** The local clock, re-rendered every 100ms. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => current);
}

/**
 * Milliseconds left on a server deadline. `offset` is serverNow - localNow from the latest
 * snapshot, so a phone with a wrong clock still counts down correctly. While the game is
 * frozen there is no deadline, so the frozen remainder is shown instead.
 */
export function useRemaining(
  deadline: number | null,
  offset: number,
  frozenRemainingMs: number | null,
): number | null {
  const now = useNow();
  if (deadline !== null) return Math.max(0, deadline - (now + offset));
  return frozenRemainingMs;
}
