/** Difficulty tiers. A board's rows map onto them: tier 1 is the easiest ($200), tier 5 the hardest. */
export const TIER_COUNT = 5;

/** Candidate clues per tier. More means fewer repeats from one game night to the next. */
export const CLUES_PER_TIER = 6;

/** A clue and its answer, as stored in the category files. */
export type PoolClue = readonly [clue: string, answer: string];

/** Everything one category can draw from: CLUES_PER_TIER candidates for each of TIER_COUNT tiers. */
export interface CategoryPack {
  id: string;
  tiers: PoolClue[][];
}

/** What the builder needs to show a category before its clues are loaded. */
export interface CategoryInfo {
  id: string;
  /** As shown on the board. Also how a board's column is matched back to its pack. */
  name: string;
  group: string;
  blurb: string;
}

/** A standalone Final Jeopardy clue. */
export interface FinalClue {
  category: string;
  clue: string;
  answer: string;
}

/** A ready-made mix of categories: the library's version of a full-board preset. */
export interface Recipe {
  id: string;
  title: string;
  blurb: string;
  round1: string[];
  round2: string[];
}
