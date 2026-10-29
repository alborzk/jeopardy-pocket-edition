import { describe, expect, it } from 'vitest';
import { boardSchema } from '@jeopardy/shared';
import type { Board } from '@jeopardy/shared';
import {
  answerCore,
  applyCategory,
  buildBoard,
  collides,
  drawFinal,
  redealDailyDoubles,
  redrawCell,
  redrawColumn,
  tierForRow,
} from './build';
import type { BuildInput } from './build';
import { clueKey } from './seen';
import type { SeenMap } from './seen';
import { fakeFinals, fakePack, seeded } from './test-utils';
import type { CategoryPack } from './types';

const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
const SECOND = ['Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima'];
const plan = (names: string[]) =>
  names.map((name) => ({ name, pack: fakePack(name.toLowerCase()) }));

function input(overrides: Partial<BuildInput> = {}): BuildInput {
  return {
    title: 'Test board',
    rounds: [
      { name: 'Round One', categories: plan(NAMES) },
      { name: 'Round Two', categories: plan(SECOND) },
    ],
    finals: fakeFinals(),
    rng: seeded(1),
    ...overrides,
  };
}

const tierOf = (clue: string) => Number(/tier(\d)/.exec(clue)?.[1]);
const clueNumber = (clue: string) => Number(/clue(\d)/.exec(clue)?.[1]);

describe('tierForRow', () => {
  it('uses every tier in order for five rows', () => {
    expect([0, 1, 2, 3, 4].map((row) => tierForRow(row, 5))).toEqual([0, 1, 2, 3, 4]);
  });

  it('skips tiers evenly for fewer rows', () => {
    expect([0, 1, 2, 3].map((row) => tierForRow(row, 4))).toEqual([0, 1, 3, 4]);
    expect([0, 1, 2].map((row) => tierForRow(row, 3))).toEqual([0, 2, 4]);
    expect([0, 1].map((row) => tierForRow(row, 2))).toEqual([0, 4]);
    expect(tierForRow(0, 1)).toBe(2);
  });

  it('repeats tiers for more rows, without leaving the tier range', () => {
    const tiers = Array.from({ length: 10 }, (_, row) => tierForRow(row, 10));
    expect(tiers[0]).toBe(0);
    expect(tiers[9]).toBe(4);
    expect(tiers.every((tier, i) => i === 0 || tier >= (tiers[i - 1] ?? 0))).toBe(true);
  });
});

describe('buildBoard', () => {
  it('deals a board that is ready to host', () => {
    const board = buildBoard(input());
    expect(boardSchema.safeParse(board).success).toBe(true);
    expect(board.title).toBe('Test board');
    expect(board.rounds.map((round) => round.name)).toEqual(['Round One', 'Round Two']);
    expect(board.rounds[0]?.categories.map((c) => c.name)).toEqual(NAMES);
    for (const round of board.rounds) {
      expect(round.categories).toHaveLength(6);
      for (const category of round.categories) expect(category.clues).toHaveLength(5);
    }
  });

  it('uses the standard values: 200-1000, then 400-2000', () => {
    const board = buildBoard(input());
    const values = (round: number) => board.rounds[round]?.categories[0]?.clues.map((c) => c.value);
    expect(values(0)).toEqual([200, 400, 600, 800, 1000]);
    expect(values(1)).toEqual([400, 800, 1200, 1600, 2000]);
  });

  it('draws each row from the matching tier, so value tracks difficulty', () => {
    const board = buildBoard(input());
    for (const round of board.rounds) {
      for (const category of round.categories) {
        category.clues.forEach((clue, row) => expect(tierOf(clue.clue)).toBe(row + 1));
      }
    }
  });

  it('uses fewer tiers for a shorter board', () => {
    const board = buildBoard(input({ rows: 4 }));
    const tiers = board.rounds[0]?.categories[0]?.clues.map((c) => tierOf(c.clue));
    expect(tiers).toEqual([1, 2, 4, 5]);
    expect(board.rounds[0]?.categories[0]?.clues.map((c) => c.value)).toEqual([200, 400, 600, 800]);
  });

  it('never repeats a clue within a column, even when rows share a tier', () => {
    const board = buildBoard(input({ rows: 10 }));
    for (const round of board.rounds) {
      for (const category of round.categories) {
        const clues = category.clues.map((c) => c.clue);
        expect(new Set(clues).size).toBe(10);
      }
    }
  });

  it('places one Daily Double in round one and two in round two, in the lower rows', () => {
    for (let seed = 0; seed < 60; seed++) {
      const board = buildBoard(input({ rng: seeded(seed) }));
      const doubles = board.rounds.map((round) =>
        round.categories.flatMap((category, column) =>
          category.clues.flatMap((clue, row) => (clue.dailyDouble ? [{ column, row }] : [])),
        ),
      );
      expect(doubles[0]).toHaveLength(1);
      expect(doubles[1]).toHaveLength(2);
      expect(new Set(doubles[1]?.map((d) => d.column)).size).toBe(2);
      for (const { row } of doubles.flat()) expect(row).toBeGreaterThanOrEqual(2);
    }
  });

  it('puts one Daily Double in a single-round board', () => {
    const board = buildBoard(input({ rounds: [{ name: 'Only', categories: plan(NAMES) }] }));
    const count = board.rounds[0]?.categories.flatMap((c) => c.clues).filter((c) => c.dailyDouble);
    expect(count).toHaveLength(1);
  });

  it('draws a Final Jeopardy clue from the bank', () => {
    const board = buildBoard(input());
    expect(board.final.clue).toMatch(/^final clue \d$/);
    expect(board.final.category).toMatch(/^Final \d$/);
  });

  it('gives different boards for different seeds and the same board for the same seed', () => {
    const strip = (board: Board) => ({ ...board, id: '' });
    const a = buildBoard(input({ rng: seeded(5) }));
    const b = buildBoard(input({ rng: seeded(5) }));
    const c = buildBoard(input({ rng: seeded(6) }));
    expect(strip(a)).toEqual(strip(b));
    expect(strip(a)).not.toEqual(strip(c));
  });

  it('gives every board its own id', () => {
    expect(buildBoard(input()).id).not.toBe(buildBoard(input()).id);
  });
});

describe('buildBoard and the seen memory', () => {
  const key = (category: string, tier: number, clue: number) =>
    clueKey(category, `${category.toLowerCase()} tier${tier} clue${clue}`);

  it('leads with clues that have not been played', () => {
    // In every tier, five of six clues have been played. Only clue 6 is new.
    const seen: SeenMap = {};
    for (const name of [...NAMES, ...SECOND]) {
      for (let tier = 1; tier <= 5; tier++) {
        for (let clue = 1; clue <= 5; clue++) seen[key(name, tier, clue)] = 100 + clue;
      }
    }
    const board = buildBoard(input({ seen }));
    for (const round of board.rounds) {
      for (const category of round.categories) {
        for (const clue of category.clues) expect(clueNumber(clue.clue)).toBe(6);
      }
    }
  });

  it('falls back to the longest-ago clue when everything has been played', () => {
    const seen: SeenMap = {};
    for (const name of NAMES) {
      for (let tier = 1; tier <= 5; tier++) {
        for (let clue = 1; clue <= 6; clue++) {
          // Clue 4 was played longest ago in every tier.
          seen[key(name, tier, clue)] = clue === 4 ? 1 : 1000 + clue;
        }
      }
    }
    const board = buildBoard(input({ seen, rounds: [{ name: 'One', categories: plan(NAMES) }] }));
    for (const category of board.rounds[0]?.categories ?? []) {
      for (const clue of category.clues) expect(clueNumber(clue.clue)).toBe(4);
    }
  });

  it('ignores the memory when told to', () => {
    const seen: SeenMap = {};
    for (const name of NAMES) {
      for (let tier = 1; tier <= 5; tier++) {
        for (let clue = 1; clue <= 5; clue++) seen[key(name, tier, clue)] = 100;
      }
    }
    const numbers = new Set<number>();
    for (let seed = 0; seed < 20; seed++) {
      const board = buildBoard(
        input({
          seen,
          avoidSeen: false,
          rng: seeded(seed),
          rounds: [{ name: 'One', categories: plan(NAMES) }],
        }),
      );
      for (const category of board.rounds[0]?.categories ?? []) {
        for (const clue of category.clues) numbers.add(clueNumber(clue.clue));
      }
    }
    expect(numbers.size).toBeGreaterThan(1);
  });

  it('draws the Final clue from the unseen ones too', () => {
    const finals = fakeFinals(3);
    const seen: SeenMap = {};
    for (const f of finals.slice(0, 2)) seen[clueKey(f.category, f.clue)] = 5;
    for (let seed = 0; seed < 20; seed++) {
      expect(buildBoard(input({ finals, seen, rng: seeded(seed) })).final.clue).toBe(
        'final clue 3',
      );
    }
  });
});

describe('collisions', () => {
  it('spots the same answer however it is phrased', () => {
    expect(
      collides(
        { clue: 'a', answer: 'What is the Eiffel Tower?' },
        { clue: 'b', answer: 'Eiffel Tower' },
      ),
    ).toBe(true);
    expect(
      collides(
        { clue: 'a', answer: 'Who is J.K. Rowling? (Also: Joanne Rowling)' },
        { clue: 'b', answer: 'Who is j k rowling' },
      ),
    ).toBe(true);
  });

  it('spots a clue that names another clue’s answer', () => {
    const paris = {
      clue: 'This city on the Seine is the capital of France.',
      answer: 'What is Paris?',
    };
    const france = { clue: 'Paris is the capital of this country.', answer: 'What is France?' };
    expect(collides(paris, france)).toBe(true);
    expect(collides(france, paris)).toBe(true);
  });

  it('matches whole words only', () => {
    const a = { clue: 'x', answer: 'What is Rome?' };
    const b = { clue: 'A chrome finish.', answer: 'What is shiny?' };
    expect(collides(a, b)).toBe(false);
  });

  it('ignores very short answers, which would match anything', () => {
    expect(
      collides(
        { clue: 'In 88 days', answer: 'What is 7?' },
        { clue: 'Piano keys', answer: 'What is 88?' },
      ),
    ).toBe(false);
  });

  it('leaves unrelated clues alone', () => {
    expect(
      collides(
        { clue: 'The largest ocean.', answer: 'What is the Pacific?' },
        { clue: 'Capital of Japan.', answer: 'What is Tokyo?' },
      ),
    ).toBe(false);
  });

  it('strips the question wording from an answer', () => {
    expect(answerCore('What is the Mona Lisa? (Also: La Gioconda)')).toBe('mona lisa');
    expect(answerCore('Who were the Beatles?')).toBe('beatles');
    expect(answerCore('How many? 88')).toBe('how many 88');
  });

  it('keeps colliding clues off one board when there is a choice', () => {
    const shared = (id: string, uniqueIndex: number): CategoryPack => {
      const pack = fakePack(id);
      // Every first-row candidate answers "Shared", except one.
      pack.tiers[0] = pack.tiers[0]!.map((clue, i) => [
        clue[0],
        i === uniqueIndex ? `What is Unique${id}?` : 'What is Shared?',
      ]);
      return pack;
    };
    for (let seed = 0; seed < 40; seed++) {
      const board = buildBoard({
        title: 't',
        rng: seeded(seed),
        rounds: [
          {
            name: 'One',
            categories: [
              { name: 'First', pack: fakePack('first') },
              { name: 'Second', pack: shared('second', 3) },
              { name: 'Third', pack: shared('third', 5) },
            ],
          },
        ],
      });
      const firstRow = board.rounds[0]?.categories.map((c) => c.clues[0]?.answer);
      // "Shared" can appear once at most.
      expect(firstRow?.filter((answer) => answer === 'What is Shared?').length).toBeLessThanOrEqual(
        1,
      );
    }
  });
});

describe('redrawing', () => {
  const board = () => buildBoard(input({ rng: seeded(2) }));

  it('swaps a clue for another from the same category and tier, keeping value and Daily Double', () => {
    for (let seed = 0; seed < 30; seed++) {
      const draft = board();
      const cell = draft.rounds[0]!.categories[2]!.clues[3]!;
      cell.dailyDouble = true;
      const before = cell.clue;
      expect(redrawCell(draft, fakePack('charlie'), 0, 2, 3, { rng: seeded(seed) })).toBe(true);
      expect(cell.clue).not.toBe(before);
      expect(cell.clue).toMatch(/^charlie tier4 clue\d$/);
      expect(cell.value).toBe(800);
      expect(cell.dailyDouble).toBe(true);
    }
  });

  it('prefers clues that have not been played', () => {
    const draft = board();
    const current = clueNumber(draft.rounds[0]!.categories[0]!.clues[0]!.clue);
    const seen: SeenMap = {};
    // Everything in tier 1 has been played except clue 6 (unless clue 6 is already on the board).
    const target = current === 6 ? 5 : 6;
    for (let clue = 1; clue <= 6; clue++) {
      if (clue !== target) seen[clueKey('Alpha', `alpha tier1 clue${clue}`)] = 10;
    }
    redrawCell(draft, fakePack('alpha'), 0, 0, 0, { seen, rng: seeded(1) });
    expect(clueNumber(draft.rounds[0]!.categories[0]!.clues[0]!.clue)).toBe(target);
  });

  it('says so when there is nothing else to offer', () => {
    const draft = board();
    const tiny: CategoryPack = {
      id: 'alpha',
      tiers: Array.from({ length: 5 }, (_, t) => [
        [`alpha tier${t + 1} clue1`, `What is alpha${t + 1}x1?`],
      ]),
    } as CategoryPack;
    const draftCell = draft.rounds[0]!.categories[0]!.clues[0]!;
    draftCell.clue = 'alpha tier1 clue1';
    draftCell.answer = 'What is alpha1x1?';
    expect(redrawCell(draft, tiny, 0, 0, 0)).toBe(false);
    expect(draftCell.clue).toBe('alpha tier1 clue1');
  });

  it('returns false for a cell that does not exist', () => {
    expect(redrawCell(board(), fakePack('alpha'), 0, 99, 0)).toBe(false);
  });

  it('redraws a whole column, changing every clue', () => {
    const draft = board();
    const before = draft.rounds[1]!.categories[4]!.clues.map((c) => c.clue);
    expect(redrawColumn(draft, fakePack('kilo'), 1, 4, { rng: seeded(8) })).toBe(5);
    const after = draft.rounds[1]!.categories[4]!.clues.map((c) => c.clue);
    after.forEach((clue, row) => {
      expect(clue).not.toBe(before[row]);
      expect(tierOf(clue)).toBe(row + 1);
    });
    expect(boardSchema.safeParse(draft).success).toBe(true);
  });
});

describe('applying a category to a column', () => {
  const board = () => buildBoard(input({ rng: seeded(2) }));

  it('renames the column and deals a clue from the right tier for every row', () => {
    const draft = board();
    expect(applyCategory(draft, fakePack('zulu'), 'Zulu', 0, 1, { rng: seeded(3) })).toBe(5);
    const column = draft.rounds[0]!.categories[1]!;
    expect(column.name).toBe('Zulu');
    column.clues.forEach((clue, row) => {
      expect(clue.clue).toMatch(/^zulu tier\d clue\d$/);
      expect(tierOf(clue.clue)).toBe(row + 1);
    });
    expect(boardSchema.safeParse(draft).success).toBe(true);
  });

  it('keeps values and Daily Doubles where they are', () => {
    const draft = board();
    const cell = draft.rounds[0]!.categories[1]!.clues[3]!;
    cell.dailyDouble = true;
    applyCategory(draft, fakePack('zulu'), 'Zulu', 0, 1, { rng: seeded(4) });
    expect(cell.dailyDouble).toBe(true);
    expect(cell.value).toBe(800);
  });

  it('leaves a row empty rather than keep a clue from the topic that used to be there', () => {
    const draft = board();
    const sparse: CategoryPack = {
      id: 'sparse',
      tiers: [[['sparse tier1 clue1', 'What is sparse1x1?']], [], [], [], []],
    };
    expect(applyCategory(draft, sparse, 'Sparse', 0, 2, { rng: seeded(5) })).toBe(1);
    const clues = draft.rounds[0]!.categories[2]!.clues;
    expect(clues[0]!.clue).toBe('sparse tier1 clue1');
    for (const clue of clues.slice(1)) expect([clue.clue, clue.answer]).toEqual(['', '']);
  });

  it('does not repeat a clue the same category already has elsewhere on the board', () => {
    for (let seed = 0; seed < 20; seed++) {
      const draft = board();
      const first = draft.rounds[0]!.categories[0]!.clues.map((c) => c.clue);
      applyCategory(draft, fakePack('alpha'), 'Alpha', 0, 3, { rng: seeded(seed) });
      const second = draft.rounds[0]!.categories[3]!.clues.map((c) => c.clue);
      expect(second.filter((clue) => first.includes(clue))).toEqual([]);
    }
  });

  it('does nothing for a column that does not exist', () => {
    const draft = board();
    const before = structuredClone(draft);
    expect(applyCategory(draft, fakePack('zulu'), 'Zulu', 0, 99)).toBe(0);
    expect(draft).toEqual(before);
  });
});

describe('re-rolling Daily Doubles', () => {
  const doublesIn = (draft: Board, round: number) =>
    draft.rounds[round]!.categories.flatMap((category, column) =>
      category.clues.flatMap((clue, row) => (clue.dailyDouble ? [{ column, row }] : [])),
    );

  it('replaces them with the standard number, in the lower rows', () => {
    for (let seed = 0; seed < 40; seed++) {
      const draft = buildBoard(input({ rng: seeded(100) }));
      redealDailyDoubles(draft, 1, seeded(seed));
      const doubles = doublesIn(draft, 1);
      expect(doubles).toHaveLength(2);
      expect(new Set(doubles.map((d) => d.column)).size).toBe(2);
      for (const { row } of doubles) expect(row).toBeGreaterThanOrEqual(2);
    }
  });

  it('clears doubles the host added by hand, and leaves the other round alone', () => {
    const draft = buildBoard(input({ rng: seeded(7) }));
    const roundOne = doublesIn(draft, 0);
    for (const clue of draft.rounds[1]!.categories[0]!.clues) clue.dailyDouble = true;
    redealDailyDoubles(draft, 1, seeded(1));
    expect(doublesIn(draft, 1)).toHaveLength(2);
    expect(doublesIn(draft, 0)).toEqual(roundOne);
  });

  it('puts one in the first round', () => {
    const draft = buildBoard(input({ rng: seeded(7) }));
    redealDailyDoubles(draft, 0, seeded(2));
    expect(doublesIn(draft, 0)).toHaveLength(1);
  });

  it('ignores a round that does not exist', () => {
    const draft = buildBoard(input({ rng: seeded(7) }));
    const before = structuredClone(draft);
    redealDailyDoubles(draft, 5);
    expect(draft).toEqual(before);
  });
});

describe('drawing a Final clue', () => {
  const board = () => buildBoard(input({ rng: seeded(2) }));

  it('swaps in a different clue from the bank', () => {
    for (let seed = 0; seed < 20; seed++) {
      const draft = board();
      const before = draft.final.clue;
      expect(drawFinal(draft, fakeFinals(3), { rng: seeded(seed) })).toBe(true);
      expect(draft.final.clue).not.toBe(before);
      expect(draft.final.clue).toMatch(/^final clue \d$/);
      expect(draft.final.answer).toMatch(/^What is final\dz\?$/);
    }
  });

  it('prefers a clue that has not been played', () => {
    const finals = fakeFinals(3);
    const draft = board();
    draft.final = { ...finals[0]! };
    const seen: SeenMap = { [clueKey(finals[1]!.category, finals[1]!.clue)]: 5 };
    for (let seed = 0; seed < 20; seed++) {
      const copy = structuredClone(draft);
      drawFinal(copy, finals, { seen, rng: seeded(seed) });
      expect(copy.final.clue).toBe(finals[2]!.clue);
    }
  });

  it('avoids a clue that gives away an answer on the board', () => {
    const draft = board();
    const answer = draft.rounds[0]!.categories[0]!.clues[0]!.answer;
    const giveaway = {
      category: 'Bad',
      clue: `It starts with ${answerCore(answer)}.`,
      answer: 'What is something?',
    };
    const fine = { category: 'Fine', clue: 'A different clue.', answer: 'What is unrelated?' };
    for (let seed = 0; seed < 20; seed++) {
      const copy = structuredClone(draft);
      drawFinal(copy, [giveaway, fine], { avoidSeen: false, rng: seeded(seed) });
      expect(copy.final.category).toBe('Fine');
    }
  });

  it('says so when the bank only has the clue already there', () => {
    const draft = board();
    const before = structuredClone(draft.final);
    expect(drawFinal(draft, [before])).toBe(false);
    expect(draft.final).toEqual(before);
  });
});
