import type { Rng } from './pick';
import type { Store } from './seen';
import type { CategoryPack, FinalClue } from './types';

/** mulberry32: a tiny seeded generator, so a failing test can be replayed exactly. */
export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** localStorage stand-in. */
export function memoryStore(initial: Record<string, string> = {}): Store & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

/**
 * A pack whose clues say where they came from, so a test can tell which tier and which candidate a
 * board drew: "<id> tier3 clue5" with the answer "What is <id>3x5?".
 */
export function fakePack(id: string): CategoryPack {
  return {
    id,
    tiers: Array.from({ length: 5 }, (_, t) =>
      Array.from({ length: 6 }, (_, i) => [
        `${id} tier${t + 1} clue${i + 1}`,
        `What is ${id}${t + 1}x${i + 1}?`,
      ]),
    ),
  } as CategoryPack;
}

export function fakeFinals(count = 3): FinalClue[] {
  return Array.from({ length: count }, (_, i) => ({
    category: `Final ${i + 1}`,
    clue: `final clue ${i + 1}`,
    answer: `What is final${i + 1}z?`,
  }));
}
