/**
 * Remembers which clues this browser has already played, so the next board can lead with ones
 * nobody has seen. It lives in the host's localStorage: another device starts from scratch.
 */

/** clue key -> when it was last played (epoch ms). */
export type SeenMap = Record<string, number>;

export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const SEEN_KEY = 'jeepy.seenClues.v1';
const AVOID_KEY = 'jeepy.avoidSeen.v1';
/** Hand-written clues get remembered too, so keep the newest few thousand and drop the rest. */
export const MAX_SEEN = 5000;

function browserStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Blocked storage (private mode, sandboxed frames): the game works, it just doesn't remember.
    return null;
  }
}

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/** cyrb53: a small, well-spread 53-bit string hash. Not for security, just for stable keys. */
function hash(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * A clue's identity: its category plus its text. No ids to author or keep in sync, and the host
 * page can compute the same key from the clue it is showing. Editing a clue makes it a new clue.
 */
export function clueKey(category: string, clue: string): string {
  return hash(`${normalize(category)}|${normalize(clue)}`).toString(36);
}

export function loadSeen(store: Store | null = browserStore()): SeenMap {
  if (!store) return {};
  try {
    const parsed: unknown = JSON.parse(store.getItem(SEEN_KEY) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const seen: SeenMap = {};
    for (const [key, when] of Object.entries(parsed)) {
      if (typeof when === 'number') seen[key] = when;
    }
    return seen;
  } catch {
    return {};
  }
}

function saveSeen(seen: SeenMap, store: Store): void {
  const entries = Object.entries(seen);
  const kept =
    entries.length > MAX_SEEN
      ? Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_SEEN))
      : seen;
  try {
    store.setItem(SEEN_KEY, JSON.stringify(kept));
  } catch {
    // Full or blocked: forgetting what was played is better than breaking the game.
  }
}

/** Record that a clue was played. */
export function markSeen(
  category: string,
  clue: string,
  now = Date.now(),
  store: Store | null = browserStore(),
): void {
  if (!store) return;
  const seen = loadSeen(store);
  seen[clueKey(category, clue)] = now;
  saveSeen(seen, store);
}

export function countSeen(store: Store | null = browserStore()): number {
  return Object.keys(loadSeen(store)).length;
}

export function clearSeen(store: Store | null = browserStore()): void {
  try {
    store?.removeItem(SEEN_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Whether new boards should lead with clues this browser hasn't played. On by default. */
export function loadAvoidSeen(store: Store | null = browserStore()): boolean {
  try {
    return store?.getItem(AVOID_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function saveAvoidSeen(avoid: boolean, store: Store | null = browserStore()): void {
  try {
    store?.setItem(AVOID_KEY, String(avoid));
  } catch {
    // Not remembered: it falls back to the default next time.
  }
}
