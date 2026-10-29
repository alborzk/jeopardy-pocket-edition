import { describe, expect, it } from 'vitest';
import { pickClue, shuffle } from './pick';
import { seeded } from './test-utils';

const key = (item: string) => item;
const run = (
  pool: string[],
  options: Partial<Parameters<typeof pickClue<string>>[2]> = {},
  seeds = 60,
) =>
  Array.from({ length: seeds }, (_, seed) =>
    pickClue(pool, key, { seen: {}, avoidSeen: true, rng: seeded(seed), ...options }),
  );

describe('pickClue', () => {
  it('leads with clues that have never been played', () => {
    const picks = run(['a', 'b', 'c'], { seen: { a: 1, b: 2 } });
    expect(new Set(picks)).toEqual(new Set(['c']));
  });

  it('spreads its picks across the unseen clues', () => {
    expect(new Set(run(['a', 'b', 'c', 'd'], { seen: { a: 1 } }))).toEqual(
      new Set(['b', 'c', 'd']),
    );
  });

  it('reuses the clue played longest ago once everything has been played', () => {
    const picks = run(['a', 'b', 'c'], { seen: { a: 30, b: 10, c: 20 } });
    expect(new Set(picks)).toEqual(new Set(['b']));
  });

  it('chooses randomly among clues tied for oldest, and only those', () => {
    const picks = new Set(run(['a', 'b', 'c'], { seen: { a: 5, b: 5, c: 9 } }));
    expect(picks).toEqual(new Set(['a', 'b']));
  });

  it('ignores what was played when asked to', () => {
    const picks = new Set(run(['a', 'b'], { seen: { a: 1, b: 2 }, avoidSeen: false }));
    expect(picks).toEqual(new Set(['a', 'b']));
  });

  it('never picks a skipped clue, and gives up when all are skipped', () => {
    expect(new Set(run(['a', 'b', 'c'], { skip: new Set(['a', 'b']) }))).toEqual(new Set(['c']));
    expect(
      pickClue(['a'], key, { seen: {}, avoidSeen: true, rng: seeded(1), skip: new Set(['a']) }),
    ).toBeUndefined();
  });

  it('avoids unacceptable clues, even over unseen ones', () => {
    // "c" is unseen but unacceptable, so a played-but-fine clue wins.
    const picks = run(['a', 'b', 'c'], { seen: { a: 1, b: 2 }, accept: (item) => item !== 'c' });
    expect(new Set(picks)).toEqual(new Set(['a']));
  });

  it('would rather take an unacceptable clue than leave a hole', () => {
    const picks = run(['a', 'b'], { accept: () => false });
    expect(picks.every((pick) => pick === 'a' || pick === 'b')).toBe(true);
  });

  it('returns undefined for an empty pool', () => {
    expect(run([])[0]).toBeUndefined();
  });
});

describe('shuffle', () => {
  it('returns every item exactly once and leaves its input alone', () => {
    const input = ['a', 'b', 'c', 'd', 'e'];
    const result = shuffle(input, seeded(3));
    expect([...result].sort()).toEqual(input);
    expect(input).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('is repeatable for the same seed', () => {
    expect(shuffle([1, 2, 3, 4, 5, 6], seeded(9))).toEqual(shuffle([1, 2, 3, 4, 5, 6], seeded(9)));
  });
});
