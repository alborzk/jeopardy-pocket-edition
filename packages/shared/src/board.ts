import { z } from 'zod';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_CLUES,
  MAX_ANSWER_TEXT,
  MAX_CATEGORIES_PER_ROUND,
  MAX_CLUE_TEXT,
  MAX_CLUE_VALUE,
  MAX_CLUES_PER_CATEGORY,
  MAX_LABEL_TEXT,
  MAX_ROUNDS,
  ROUND_VALUE_STEP,
} from './constants';

export type Clue = { value: number; clue: string; answer: string; dailyDouble?: boolean };
export type Category = { name: string; clues: Clue[] };
export type Round = { name: string; categories: Category[] };
export type Board = {
  id: string;
  title: string;
  rounds: Round[];
  final: { category: string; clue: string; answer: string };
};

function buildBoardSchema(strict: boolean): z.ZodType<Board> {
  // A draft may have blank text while the host is still writing it. A strict board may not.
  const text = (max: number) =>
    strict ? z.string().trim().min(1, 'Required').max(max) : z.string().max(max);

  const clue = z.object({
    value: z.number().int().min(1, 'Must be at least 1').max(MAX_CLUE_VALUE),
    clue: text(MAX_CLUE_TEXT),
    answer: text(MAX_ANSWER_TEXT),
    dailyDouble: z.boolean().optional(),
  });

  const category = z.object({
    name: text(MAX_LABEL_TEXT),
    clues: z.array(clue).min(1).max(MAX_CLUES_PER_CATEGORY),
  });

  const round = z
    .object({
      name: text(MAX_LABEL_TEXT),
      categories: z.array(category).min(1).max(MAX_CATEGORIES_PER_ROUND),
    })
    .refine((r) => r.categories.every((c) => c.clues.length === r.categories[0]?.clues.length), {
      message: 'Every category in a round needs the same number of clues',
      path: ['categories'],
    });

  return z.object({
    id: z.string().min(1).max(64),
    title: text(MAX_LABEL_TEXT),
    rounds: z.array(round).min(1).max(MAX_ROUNDS),
    final: z.object({
      category: text(MAX_LABEL_TEXT),
      clue: text(MAX_CLUE_TEXT),
      answer: text(MAX_ANSWER_TEXT),
    }),
  });
}

/** Strict schema: every text field filled in. Used before a board goes into a room. */
export const boardSchema = buildBoardSchema(true);

/** Lenient schema: blank text allowed. Used for autosaved drafts in the editor. */
export const boardDraftSchema = buildBoardSchema(false);

export function makeId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultClueValue(roundIndex: number, clueIndex: number): number {
  const step = ROUND_VALUE_STEP[Math.min(roundIndex, ROUND_VALUE_STEP.length - 1)] ?? 200;
  return (clueIndex + 1) * step;
}

export function createEmptyRound(roundIndex: number, name: string): Round {
  return {
    name,
    categories: Array.from({ length: DEFAULT_CATEGORIES }, () => ({
      name: '',
      clues: Array.from({ length: DEFAULT_CLUES }, (_, i) => ({
        value: defaultClueValue(roundIndex, i),
        clue: '',
        answer: '',
      })),
    })),
  };
}

export function createEmptyBoard(title = 'Untitled board'): Board {
  return {
    id: makeId(),
    title,
    rounds: [createEmptyRound(0, 'Jeopardy!'), createEmptyRound(1, 'Double Jeopardy!')],
    final: { category: '', clue: '', answer: '' },
  };
}

/** Highest clue value in a round. Daily Double wagers can always go up to this. */
export function topClueValue(round: Round): number {
  let top = 0;
  for (const category of round.categories) {
    for (const clue of category.clues) top = Math.max(top, clue.value);
  }
  return top;
}

export function countClues(board: Board): number {
  return board.rounds.reduce(
    (total, round) => total + round.categories.reduce((sum, c) => sum + c.clues.length, 0),
    0,
  );
}

/** Human-readable validation problems, one per line, e.g. "Round 1 > Category 2 > Clue 3 > clue: Required". */
export function describeBoardIssues(board: unknown): string[] {
  const parsed = boardSchema.safeParse(board);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => {
    const parts = issue.path.map((segment, i) => {
      const previous = issue.path[i - 1];
      if (typeof segment === 'number') {
        if (previous === 'rounds') return `Round ${segment + 1}`;
        if (previous === 'categories') return `Category ${segment + 1}`;
        if (previous === 'clues') return `Clue ${segment + 1}`;
        return `#${segment + 1}`;
      }
      if (segment === 'rounds' || segment === 'categories' || segment === 'clues') return null;
      return segment;
    });
    const where = parts.filter((p): p is string => p !== null).join(' > ');
    return where ? `${where}: ${issue.message}` : issue.message;
  });
}
