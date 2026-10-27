import { describe, expect, it } from 'vitest';
import {
  boardDraftSchema,
  boardSchema,
  createEmptyBoard,
  defaultClueValue,
  describeBoardIssues,
  eventSchemas,
  topClueValue,
} from './index';

function filledBoard() {
  const board = createEmptyBoard('Test');
  board.rounds.forEach((round) =>
    round.categories.forEach((category, c) => {
      category.name = `Category ${c + 1}`;
      category.clues.forEach((clue, i) => {
        clue.clue = `Clue ${i + 1}`;
        clue.answer = `Answer ${i + 1}`;
      });
    }),
  );
  board.final = { category: 'Final', clue: 'A clue', answer: 'An answer' };
  return board;
}

describe('room codes', () => {
  const parse = (code: string) => eventSchemas['room:join'].safeParse({ code, name: 'Ann' });

  it('accepts codes case-insensitively and upper-cases them', () => {
    const result = parse(' abcd ');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.code).toBe('ABCD');
  });

  it('rejects the letters I and O, and wrong lengths', () => {
    expect(parse('ABCI').success).toBe(false);
    expect(parse('ABOD').success).toBe(false);
    expect(parse('ABC').success).toBe(false);
    expect(parse('ABCDE').success).toBe(false);
  });
});

describe('player names', () => {
  const parse = (name: string) => eventSchemas['room:join'].safeParse({ code: 'ABCD', name });

  it('trims and enforces 1-16 characters', () => {
    expect(parse('  Ann  ').success).toBe(true);
    expect(parse('   ').success).toBe(false);
    expect(parse('a'.repeat(16)).success).toBe(true);
    expect(parse('a'.repeat(17)).success).toBe(false);
  });
});

describe('board schema', () => {
  it('accepts a complete board', () => {
    expect(boardSchema.safeParse(filledBoard()).success).toBe(true);
  });

  it('rejects blank text in strict mode but allows it in a draft', () => {
    const empty = createEmptyBoard();
    expect(boardSchema.safeParse(empty).success).toBe(false);
    expect(boardDraftSchema.safeParse(empty).success).toBe(true);
  });

  it('requires every category in a round to have the same number of clues', () => {
    const board = filledBoard();
    board.rounds[0]?.categories[0]?.clues.pop();
    expect(boardSchema.safeParse(board).success).toBe(false);
  });

  it('allows only one or two rounds', () => {
    const board = filledBoard();
    board.rounds.push(JSON.parse(JSON.stringify(board.rounds[0])));
    expect(boardSchema.safeParse(board).success).toBe(false);
    board.rounds = [];
    expect(boardSchema.safeParse(board).success).toBe(false);
  });

  it('describes issues with a readable path', () => {
    const board = filledBoard();
    board.rounds[1]!.categories[2]!.clues[3]!.answer = '';
    const issues = describeBoardIssues(board);
    expect(issues).toEqual(['Round 2 > Category 3 > Clue 4 > answer: Required']);
  });
});

describe('board helpers', () => {
  it('uses 200-1000 for round 1 and 400-2000 for round 2', () => {
    expect([0, 1, 2, 3, 4].map((i) => defaultClueValue(0, i))).toEqual([200, 400, 600, 800, 1000]);
    expect([0, 1, 2, 3, 4].map((i) => defaultClueValue(1, i))).toEqual([
      400, 800, 1200, 1600, 2000,
    ]);
  });

  it('finds the top clue value', () => {
    const board = createEmptyBoard();
    expect(topClueValue(board.rounds[0]!)).toBe(1000);
    expect(topClueValue(board.rounds[1]!)).toBe(2000);
  });
});
