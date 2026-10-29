import { defaultClueValue, makeId } from '@jeopardy/shared';
import type { Board } from '@jeopardy/shared';
import { pickClue, shuffle } from './pick';
import type { Rng } from './pick';
import { clueKey } from './seen';
import type { SeenMap } from './seen';
import { TIER_COUNT } from './types';
import type { CategoryPack, FinalClue, PoolClue } from './types';

export const DEFAULT_ROWS = 5;

/** Daily Doubles per round: one in the first round, two in the second. */
const DAILY_DOUBLES = [1, 2];

const dailyDoublesFor = (roundIndex: number) => DAILY_DOUBLES[roundIndex] ?? DAILY_DOUBLES[1] ?? 2;

/**
 * Which difficulty tier a row draws from. Five rows use all five tiers in order. Fewer rows skip
 * tiers evenly (four rows skip the middle one), and more rows draw some tiers more than once.
 */
export function tierForRow(row: number, rows: number): number {
  if (rows <= 1) return Math.floor(TIER_COUNT / 2);
  return Math.round((row * (TIER_COUNT - 1)) / (rows - 1));
}

// ---------------------------------------------------------------------------------------------
// Collisions: no two clues on a board should share an answer or give each other away.
// ---------------------------------------------------------------------------------------------

/** A clue prepared for comparison: normalizing text is the slow part, so it's done once. */
interface Placed {
  /** The clue as lowercase words, padded with spaces so whole-word matching is a plain includes(). */
  text: string;
  /** What's left of the answer once the question wording is stripped. */
  core: string;
}

const QUESTION_LEAD = /^(what|who|where|when|which)\s+(is|are|was|were)\s+/;

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** The part of an answer worth matching: "What is the Eiffel Tower? (Also: …)" -> "eiffel tower". */
export function answerCore(answer: string): string {
  return words(
    answer
      .toLowerCase()
      .replace(/\(.*?\)/g, ' ')
      .replace(QUESTION_LEAD, '')
      .replace(/^(the|a|an)\s+/, ''),
  );
}

const prepare = (clue: string, answer: string): Placed => ({
  text: ` ${words(clue)} `,
  core: answerCore(answer),
});

// Short answers ("88", "Q") would match half the board, so they're not worth checking.
const mentionsCore = (text: string, core: string) => core.length >= 4 && text.includes(` ${core} `);

/** Whether `text` contains `core` as whole words. Used to catch a clue that gives its answer away. */
export function mentions(text: string, core: string): boolean {
  return mentionsCore(` ${words(text)} `, core);
}

function collidesPrepared(a: Placed, b: Placed): boolean {
  if (a.core !== '' && a.core === b.core) return true;
  return mentionsCore(b.text, a.core) || mentionsCore(a.text, b.core);
}

/** Whether two clues share an answer, or one names the other's answer. */
export function collides(
  a: { clue: string; answer: string },
  b: { clue: string; answer: string },
): boolean {
  return collidesPrepared(prepare(a.clue, a.answer), prepare(b.clue, b.answer));
}

const collidesAny = (candidate: Placed, placed: readonly Placed[]) =>
  placed.some((other) => collidesPrepared(candidate, other));

// ---------------------------------------------------------------------------------------------
// Building a board
// ---------------------------------------------------------------------------------------------

export interface PlannedCategory {
  /** What the column is called on the board. */
  name: string;
  pack: CategoryPack;
}

export interface PlannedRound {
  name: string;
  categories: PlannedCategory[];
}

export interface BuildInput {
  title: string;
  rounds: PlannedRound[];
  /** Candidates for Final Jeopardy. One is drawn. */
  finals?: readonly FinalClue[];
  /** Clues per category. Default 5. */
  rows?: number;
  seen?: SeenMap;
  avoidSeen?: boolean;
  rng?: Rng;
}

function placeDailyDoubles(round: Board['rounds'][number], count: number, rng: Rng): void {
  const rows = round.categories[0]?.clues.length ?? 0;
  const columns = round.categories.length;
  if (rows === 0 || columns === 0) return;
  // Daily Doubles hide in the lower rows, as on the show.
  const firstRow = rows >= 3 ? 2 : Math.min(1, rows - 1);
  for (const column of shuffle([...Array(columns).keys()], rng).slice(0, count)) {
    const row = firstRow + Math.floor(rng() * (rows - firstRow));
    const clue = round.categories[column]?.clues[row];
    if (clue) clue.dailyDouble = true;
  }
}

/**
 * Deal a board from category packs: one clue per row, drawn from the tier that row stands for.
 * The result is an ordinary Board, so it can be edited, exported and hosted like any other.
 */
export function buildBoard(input: BuildInput): Board {
  const rng = input.rng ?? Math.random;
  const rows = input.rows ?? DEFAULT_ROWS;
  const seen = input.seen ?? {};
  const avoidSeen = input.avoidSeen ?? true;
  const placed: Placed[] = [];
  const taken = new Set<string>();

  const rounds: Board['rounds'] = input.rounds.map((plan, roundIndex) => ({
    name: plan.name,
    categories: plan.categories.map(({ name, pack }) => ({
      name,
      clues: Array.from({ length: rows }, (_, row) => {
        const keyOf = (clue: PoolClue) => clueKey(name, clue[0]);
        const options = {
          seen,
          avoidSeen,
          rng,
          skip: taken,
          accept: (clue: PoolClue) => !collidesAny(prepare(clue[0], clue[1]), placed),
        };
        // If the tier is somehow used up (more rows than candidates), borrow from any tier.
        const pick =
          pickClue(pack.tiers[tierForRow(row, rows)] ?? [], keyOf, options) ??
          pickClue(pack.tiers.flat(), keyOf, options);
        const [clue, answer] = pick ?? ['', ''];
        if (pick) taken.add(keyOf(pick));
        placed.push(prepare(clue, answer));
        return { value: defaultClueValue(roundIndex, row), clue, answer };
      }),
    })),
  }));

  rounds.forEach((round, index) => placeDailyDoubles(round, dailyDoublesFor(index), rng));

  const final = pickClue(input.finals ?? [], (f) => clueKey(f.category, f.clue), {
    seen,
    avoidSeen,
    rng,
    accept: (f) => !collidesAny(prepare(f.clue, f.answer), placed),
  });

  return {
    id: makeId(),
    title: input.title,
    rounds,
    final: final
      ? { category: final.category, clue: final.clue, answer: final.answer }
      : { category: '', clue: '', answer: '' },
  };
}

// ---------------------------------------------------------------------------------------------
// Redrawing part of an existing board
// ---------------------------------------------------------------------------------------------

export interface RedrawOptions {
  seen?: SeenMap;
  avoidSeen?: boolean;
  rng?: Rng;
}

/**
 * Swap one clue for another from the same category and tier. Value and Daily Double stay put.
 * Changes `draft` in place. Returns false when the pack has nothing else to offer.
 */
export function redrawCell(
  draft: Board,
  pack: CategoryPack,
  roundIndex: number,
  column: number,
  row: number,
  options: RedrawOptions = {},
): boolean {
  const category = draft.rounds[roundIndex]?.categories[column];
  const target = category?.clues[row];
  if (!category || !target) return false;

  const name = category.name;
  const keyOf = (clue: PoolClue) => clueKey(name, clue[0]);
  const others: Placed[] = [];
  const taken = new Set<string>();
  draft.rounds.forEach((round, ri) =>
    round.categories.forEach((other, ci) =>
      other.clues.forEach((clue, ki) => {
        if (!(ri === roundIndex && ci === column && ki === row)) {
          others.push(prepare(clue.clue, clue.answer));
        }
        // Includes this cell's own clue, so a redraw always changes something.
        if (other.name === name) taken.add(clueKey(name, clue.clue));
      }),
    ),
  );
  if (draft.final.clue) others.push(prepare(draft.final.clue, draft.final.answer));

  const tier = pack.tiers[tierForRow(row, category.clues.length)] ?? [];
  const pick = pickClue(tier, keyOf, {
    seen: options.seen ?? {},
    avoidSeen: options.avoidSeen ?? true,
    rng: options.rng ?? Math.random,
    skip: taken,
    accept: (clue) => !collidesAny(prepare(clue[0], clue[1]), others),
  });
  if (!pick) return false;
  target.clue = pick[0];
  target.answer = pick[1];
  return true;
}

/** Redraw every clue in a column. Returns how many changed. */
export function redrawColumn(
  draft: Board,
  pack: CategoryPack,
  roundIndex: number,
  column: number,
  options: RedrawOptions = {},
): number {
  const rows = draft.rounds[roundIndex]?.categories[column]?.clues.length ?? 0;
  let changed = 0;
  for (let row = 0; row < rows; row++) {
    if (redrawCell(draft, pack, roundIndex, column, row, options)) changed++;
  }
  return changed;
}

/**
 * Put a library category into a column: rename it and deal a clue for every row. Values and Daily
 * Doubles stay where they are. Changes `draft` in place and returns how many rows got a clue.
 */
export function applyCategory(
  draft: Board,
  pack: CategoryPack,
  name: string,
  roundIndex: number,
  column: number,
  options: RedrawOptions = {},
): number {
  const category = draft.rounds[roundIndex]?.categories[column];
  if (!category) return 0;
  category.name = name;
  // Start blank, so a row that can't be filled shows up as missing instead of keeping a clue from
  // the topic that used to be here.
  for (const clue of category.clues) {
    clue.clue = '';
    clue.answer = '';
  }
  return redrawColumn(draft, pack, roundIndex, column, options);
}

/** Clear a round's Daily Doubles and scatter fresh ones in the lower rows. */
export function redealDailyDoubles(draft: Board, roundIndex: number, rng: Rng = Math.random): void {
  const round = draft.rounds[roundIndex];
  if (!round) return;
  for (const category of round.categories) {
    for (const clue of category.clues) delete clue.dailyDouble;
  }
  placeDailyDoubles(round, dailyDoublesFor(roundIndex), rng);
}

/**
 * Swap the Final Jeopardy clue for another from the library, one that doesn't give away (or share
 * an answer with) anything on the board. Changes `draft` in place. Returns false when the library
 * has nothing else to offer.
 */
export function drawFinal(
  draft: Board,
  finals: readonly FinalClue[],
  options: RedrawOptions = {},
): boolean {
  const onBoard = draft.rounds.flatMap((round) =>
    round.categories.flatMap((category) =>
      category.clues.map((clue) => prepare(clue.clue, clue.answer)),
    ),
  );
  const pick = pickClue(finals, (f) => clueKey(f.category, f.clue), {
    seen: options.seen ?? {},
    avoidSeen: options.avoidSeen ?? true,
    rng: options.rng ?? Math.random,
    // So drawing again always changes something.
    skip: new Set([clueKey(draft.final.category, draft.final.clue)]),
    accept: (f) => !collidesAny(prepare(f.clue, f.answer), onBoard),
  });
  if (!pick) return false;
  draft.final = { category: pick.category, clue: pick.clue, answer: pick.answer };
  return true;
}
