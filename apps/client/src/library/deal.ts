import { createEmptyBoard } from '@jeopardy/shared';
import type { Board } from '@jeopardy/shared';
import { buildBoard } from './build';
import { CATEGORIES, findCategory } from './catalog';
import { FINALS, loadPacks } from './loader';
import { shuffle } from './pick';
import type { Rng } from './pick';
import type { SeenMap } from './seen';
import type { CategoryPack } from './types';

/** Categories in a round. */
export const PER_ROUND = 6;

/** The most categories one group (Sports, Music…) gets in a surprise, unless there's no choice. */
const PER_GROUP = 2;

/** Pick categories at random, spread across groups so a surprise board isn't all one topic. */
export function surpriseCategories(
  count: number,
  rng: Rng = Math.random,
  exclude: readonly string[] = [],
): string[] {
  const shuffled = shuffle(
    CATEGORIES.filter((c) => !exclude.includes(c.id)),
    rng,
  );
  const picked: string[] = [];
  const perGroup = new Map<string, number>();
  for (const category of shuffled) {
    if (picked.length === count) break;
    const used = perGroup.get(category.group) ?? 0;
    if (used >= PER_GROUP) continue;
    perGroup.set(category.group, used + 1);
    picked.push(category.id);
  }
  for (const category of shuffled) {
    if (picked.length === count) break;
    if (!picked.includes(category.id)) picked.push(category.id);
  }
  return picked;
}

export interface DealRequest {
  title: string;
  /** Category ids for the first round. */
  round1: readonly string[];
  /** Category ids for the second round. Leave empty for a one-round board. */
  round2?: readonly string[];
  seen?: SeenMap;
  avoidSeen?: boolean;
  rng?: Rng;
}

/** Deal a whole board from category ids. Rejects if a category's clues can't be loaded. */
export async function dealBoard(
  request: DealRequest,
  load: (ids: readonly string[]) => Promise<CategoryPack[]> = loadPacks,
): Promise<Board> {
  const round2 = request.round2 ?? [];
  const packs = new Map((await load([...request.round1, ...round2])).map((p) => [p.id, p]));
  const roundNames = createEmptyBoard().rounds.map((r) => r.name);
  const plan = (ids: readonly string[], name: string) => ({
    name,
    categories: ids.map((id) => ({
      name: findCategory(id)?.name ?? id,
      pack: packs.get(id) ?? { id, tiers: [] },
    })),
  });
  return buildBoard({
    title: request.title,
    rounds: [
      plan(request.round1, roundNames[0] ?? 'Round 1'),
      ...(round2.length > 0 ? [plan(round2, roundNames[1] ?? 'Round 2')] : []),
    ],
    finals: FINALS,
    seen: request.seen,
    avoidSeen: request.avoidSeen,
    rng: request.rng,
  });
}
