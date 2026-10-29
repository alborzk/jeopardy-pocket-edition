import { describe, expect, it } from 'vitest';
import { boardSchema } from '@jeopardy/shared';
import { answerCore, buildBoard, mentions } from './build';
import { CATEGORIES, GROUPS, findCategory } from './catalog';
import finalsFile from './finals.json';
import { RECIPES } from './recipes';
import { seeded } from './test-utils';
import { CLUES_PER_TIER, TIER_COUNT } from './types';
import type { CategoryPack, PoolClue } from './types';

// These tests are the quality gate for everything in the library. A clue that breaks a rule here
// would break a game night, so the rules are strict.

interface PackFile {
  id: string;
  tiers: [string, string][][];
}

const files = import.meta.glob<PackFile>('./categories/*.json', { eager: true, import: 'default' });
const byFile = new Map(
  Object.entries(files).map(([path, file]) => [path.replace(/^.*\/(.+)\.json$/, '$1'), file]),
);
const packs: CategoryPack[] = [...byFile.values()].map((file) => ({
  id: file.id,
  tiers: file.tiers.map((tier) => tier.map((c): PoolClue => [c[0], c[1]])),
}));
const allClues = packs.flatMap((pack) =>
  pack.tiers.flatMap((tier, t) =>
    tier.map(([clue, answer]) => ({ pack: pack.id, tier: t + 1, clue, answer })),
  ),
);
const finals = (finalsFile as [string, string, string][]).map(([category, clue, answer]) => ({
  category,
  clue,
  answer,
}));

const ANSWER_STYLE = /^(What|Who|Where|When|Which)\b.*\?/;

describe('the catalog', () => {
  it('lists every category file, and every entry has a file', () => {
    expect([...byFile.keys()].sort()).toEqual(CATEGORIES.map((c) => c.id).sort());
  });

  it('keeps each file’s id in step with its name', () => {
    for (const [name, file] of byFile) expect(file.id).toBe(name);
  });

  it('has unique ids and names, and complete details', () => {
    expect(new Set(CATEGORIES.map((c) => c.id)).size).toBe(CATEGORIES.length);
    expect(new Set(CATEGORIES.map((c) => c.name.toLowerCase())).size).toBe(CATEGORIES.length);
    for (const category of CATEGORIES) {
      expect(category.name.length).toBeGreaterThan(0);
      expect(category.name.length).toBeLessThanOrEqual(22);
      expect(category.group).not.toBe('');
      expect(category.blurb).not.toBe('');
      expect(category.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
    expect(GROUPS.length).toBeGreaterThan(1);
  });

  it('is big enough to build a full board from', () => {
    expect(CATEGORIES.length).toBeGreaterThanOrEqual(24);
  });
});

describe('every category pack', () => {
  it.each(packs.map((pack) => [pack.id, pack] as const))('%s has the right shape', (_, pack) => {
    expect(pack.tiers).toHaveLength(TIER_COUNT);
    for (const tier of pack.tiers) expect(tier).toHaveLength(CLUES_PER_TIER);
  });

  it.each(packs.map((pack) => [pack.id, pack] as const))(
    '%s follows the style rules',
    (_, pack) => {
      for (const [tierIndex, tier] of pack.tiers.entries()) {
        for (const [clue, answer] of tier) {
          const where = `${pack.id} tier ${tierIndex + 1}: ${clue}`;
          expect(typeof clue, where).toBe('string');
          expect(clue.length, where).toBeGreaterThanOrEqual(15);
          expect(
            clue.length,
            `${where} (keep clues short enough to read on a TV)`,
          ).toBeLessThanOrEqual(190);
          expect(clue, where).toBe(clue.trim());
          expect(clue, where).not.toMatch(/\s{2,}/);
          expect(clue, `${where} (should end like a sentence)`).toMatch(/[.?!'")]$/);
          expect(clue, `${where} (use ' not ")`).not.toContain('"');
          expect(answer.length, where).toBeLessThanOrEqual(110);
          expect(answer, `${where} -> ${answer}`).toMatch(ANSWER_STYLE);
          expect(answer, where).not.toContain('"');
        }
      }
    },
  );

  it.each(packs.map((pack) => [pack.id, pack] as const))(
    '%s never gives its answers away',
    (_, pack) => {
      for (const tier of pack.tiers) {
        for (const [clue, answer] of tier) {
          const core = answerCore(answer);
          expect(core.length, answer).toBeGreaterThan(0);
          expect(mentions(clue, core), `"${clue}" contains its own answer "${answer}"`).toBe(false);
        }
      }
    },
  );

  it.each(packs.map((pack) => [pack.id, pack] as const))(
    '%s has no repeated answers or clues',
    (_, pack) => {
      const flat = pack.tiers.flat();
      const cores = flat.map(([, answer]) => answerCore(answer));
      const repeats = cores.filter((core, i) => cores.indexOf(core) !== i);
      expect(repeats, 'answers used more than once in this category').toEqual([]);
      const clues = flat.map(([clue]) => clue.toLowerCase());
      expect(new Set(clues).size).toBe(clues.length);
    },
  );
});

describe('across the whole library', () => {
  it('never repeats a clue in two categories', () => {
    const seen = new Map<string, string>();
    for (const { pack, clue } of allClues) {
      const key = clue.toLowerCase();
      expect(seen.get(key), `"${clue}" appears in ${seen.get(key)} and ${pack}`).toBeUndefined();
      seen.set(key, pack);
    }
  });

  it('has 30 clues for every category in the catalog', () => {
    expect(allClues.length).toBe(CATEGORIES.length * TIER_COUNT * CLUES_PER_TIER);
  });
});

describe('the Final Jeopardy bank', () => {
  it('has plenty of clues', () => {
    expect(finals.length).toBeGreaterThanOrEqual(30);
  });

  it('follows the style rules', () => {
    for (const { category, clue, answer } of finals) {
      const where = `${category}: ${clue}`;
      expect(category.trim(), where).toBe(category);
      expect(category.length, where).toBeGreaterThan(0);
      expect(category.length, where).toBeLessThanOrEqual(40);
      expect(clue.length, where).toBeLessThanOrEqual(260);
      expect(clue, where).toMatch(/[.?!'")]$/);
      expect(clue, where).not.toContain('"');
      expect(answer, where).toMatch(ANSWER_STYLE);
      expect(mentions(clue, answerCore(answer)), `${where} gives its answer away`).toBe(false);
    }
  });

  it('has no repeated clues, answers or categories', () => {
    const clues = finals.map((f) => f.clue.toLowerCase());
    const answers = finals.map((f) => answerCore(f.answer));
    const categories = finals.map((f) => f.category.toLowerCase());
    expect(new Set(clues).size).toBe(clues.length);
    expect(new Set(answers).size).toBe(answers.length);
    expect(new Set(categories).size).toBe(categories.length);
  });
});

describe('the recipes', () => {
  it('have unique ids and only name real categories', () => {
    expect(new Set(RECIPES.map((r) => r.id)).size).toBe(RECIPES.length);
    for (const recipe of RECIPES) {
      for (const id of [...recipe.round1, ...recipe.round2]) {
        expect(findCategory(id), `${recipe.id} names "${id}"`).toBeDefined();
      }
    }
  });

  it('use six categories per round, none twice', () => {
    for (const recipe of RECIPES) {
      expect(recipe.round1).toHaveLength(6);
      expect(recipe.round2).toHaveLength(6);
      const all = [...recipe.round1, ...recipe.round2];
      expect(new Set(all).size, `${recipe.id} repeats a category`).toBe(all.length);
    }
  });

  it('deal valid boards every time', () => {
    const byId = new Map(packs.map((pack) => [pack.id, pack]));
    for (const recipe of RECIPES) {
      const round = (ids: string[], name: string) => ({
        name,
        categories: ids.map((id) => ({
          name: findCategory(id)?.name ?? id,
          pack: byId.get(id) as CategoryPack,
        })),
      });
      for (let seed = 0; seed < 25; seed++) {
        const board = buildBoard({
          title: recipe.title,
          rounds: [round(recipe.round1, 'Round 1'), round(recipe.round2, 'Round 2')],
          finals,
          rng: seeded(seed),
        });
        const parsed = boardSchema.safeParse(board);
        expect(parsed.success, `${recipe.id} seed ${seed}`).toBe(true);
        const answers = board.rounds.flatMap((r) =>
          r.categories.flatMap((c) => c.clues.map((clue) => answerCore(clue.answer))),
        );
        expect(new Set(answers).size, `${recipe.id} seed ${seed} repeats an answer`).toBe(
          answers.length,
        );
        expect(board.final.clue).not.toBe('');
      }
    }
  });
});
