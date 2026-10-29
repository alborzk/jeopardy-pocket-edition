import type { SeenMap } from './seen';

/** A random number in [0, 1). Injectable so tests can be deterministic. */
export type Rng = () => number;

export function choose<T>(items: readonly T[], rng: Rng): T {
  return items[Math.floor(rng() * items.length)] as T;
}

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return result;
}

export interface PickOptions<T> {
  seen: SeenMap;
  /** Lead with clues that have never been played here. */
  avoidSeen: boolean;
  rng: Rng;
  /** Keys that are already taken, for example clues already on the board. */
  skip?: ReadonlySet<string>;
  /** Clues worth avoiding, such as one that gives away another clue's answer. */
  accept?: (item: T) => boolean;
}

/**
 * Draw one clue from a pool. Preference order: not already on the board, doesn't collide with
 * another clue, never played here. When everything has been played it takes the one played longest
 * ago, so a pool never runs dry. Returns undefined only when every candidate is taken.
 */
export function pickClue<T>(
  pool: readonly T[],
  keyOf: (item: T) => string,
  options: PickOptions<T>,
): T | undefined {
  const { seen, avoidSeen, rng, skip, accept } = options;
  const available = pool.filter((item) => !skip?.has(keyOf(item)));
  if (available.length === 0) return undefined;

  const acceptable = accept ? available.filter(accept) : available;
  // A collision is worth avoiding, but never worth leaving a hole in the board.
  const usable = acceptable.length > 0 ? acceptable : available;
  if (!avoidSeen) return choose(usable, rng);

  const unseen = usable.filter((item) => seen[keyOf(item)] === undefined);
  if (unseen.length > 0) return choose(unseen, rng);

  const lastPlayed = (item: T) => seen[keyOf(item)] ?? 0;
  const oldest = Math.min(...usable.map(lastPlayed));
  return choose(
    usable.filter((item) => lastPlayed(item) === oldest),
    rng,
  );
}
