import { describe, expect, it } from 'vitest';
import { boardSchema } from '@jeopardy/shared';
import { CATEGORIES, findCategory } from './catalog';
import { PER_ROUND, dealBoard, surpriseCategories } from './deal';
import { RECIPES } from './recipes';
import { fakePack, seeded } from './test-utils';

const fakeLoad = async (ids: readonly string[]) => ids.map((id) => fakePack(id));

describe('surpriseCategories', () => {
  it('picks the requested number of different, real categories', () => {
    for (let seed = 0; seed < 30; seed++) {
      const ids = surpriseCategories(12, seeded(seed));
      expect(ids).toHaveLength(12);
      expect(new Set(ids).size).toBe(12);
      for (const id of ids) expect(findCategory(id)).toBeDefined();
    }
  });

  it('spreads the picks across groups', () => {
    for (let seed = 0; seed < 30; seed++) {
      const groups = surpriseCategories(12, seeded(seed)).map((id) => findCategory(id)?.group);
      for (const group of new Set(groups)) {
        expect(groups.filter((g) => g === group).length).toBeLessThanOrEqual(2);
      }
    }
  });

  it('leaves out the categories it is told to', () => {
    const exclude = CATEGORIES.slice(0, 30).map((c) => c.id);
    for (let seed = 0; seed < 20; seed++) {
      const ids = surpriseCategories(5, seeded(seed), exclude);
      expect(ids).toHaveLength(5);
      for (const id of ids) expect(exclude).not.toContain(id);
    }
  });

  it('relaxes the group limit rather than come up short', () => {
    expect(surpriseCategories(CATEGORIES.length, seeded(1))).toHaveLength(CATEGORIES.length);
  });

  it('gives different picks for different seeds', () => {
    expect(surpriseCategories(6, seeded(1))).not.toEqual(surpriseCategories(6, seeded(2)));
  });
});

describe('dealBoard', () => {
  const recipe = RECIPES[0]!;

  it('deals a two-round board from a recipe, ready to host', async () => {
    const board = await dealBoard(
      { title: recipe.title, round1: recipe.round1, round2: recipe.round2, rng: seeded(1) },
      fakeLoad,
    );
    expect(boardSchema.safeParse(board).success).toBe(true);
    expect(board.title).toBe(recipe.title);
    expect(board.rounds).toHaveLength(2);
    expect(board.rounds[0]?.categories.map((c) => c.name)).toEqual(
      recipe.round1.map((id) => findCategory(id)?.name),
    );
    for (const round of board.rounds) expect(round.categories).toHaveLength(PER_ROUND);
  });

  it('deals one round when there is no second', async () => {
    const board = await dealBoard(
      { title: 'Quick', round1: recipe.round1, rng: seeded(1) },
      fakeLoad,
    );
    expect(board.rounds).toHaveLength(1);
    const doubles = board.rounds[0]!.categories.flatMap((c) => c.clues).filter(
      (c) => c.dailyDouble,
    );
    expect(doubles).toHaveLength(1);
  });

  it('only loads the categories it needs, once each', async () => {
    const asked: string[] = [];
    await dealBoard({ title: 't', round1: recipe.round1, rng: seeded(1) }, async (ids) => {
      asked.push(...ids);
      return fakeLoad(ids);
    });
    expect(asked).toEqual(recipe.round1);
  });

  it('passes a failed load on to the caller', async () => {
    await expect(
      dealBoard({ title: 't', round1: recipe.round1 }, () => Promise.reject(new Error('offline'))),
    ).rejects.toThrow('offline');
  });

  it('deals a different board each time', async () => {
    const a = await dealBoard({ title: 't', round1: recipe.round1 }, fakeLoad);
    const b = await dealBoard({ title: 't', round1: recipe.round1 }, fakeLoad);
    expect(a.id).not.toBe(b.id);
  });
});
