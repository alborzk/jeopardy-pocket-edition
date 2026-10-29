import finalsFile from './finals.json';
import type { CategoryPack, FinalClue, PoolClue } from './types';

interface PackFile {
  id: string;
  tiers: [string, string][][];
}

// One lazy chunk per category: the picker only needs catalog.ts, and a board pulls in just the
// twelve or so categories it uses.
const packFiles = import.meta.glob<PackFile>('./categories/*.json', { import: 'default' });

/** Load one category's clues. */
export async function loadPack(id: string): Promise<CategoryPack> {
  const load = packFiles[`./categories/${id}.json`];
  if (!load) throw new Error(`No category called "${id}" in the library`);
  const file = await load();
  return { id, tiers: file.tiers.map((tier) => tier.map((clue): PoolClue => [clue[0], clue[1]])) };
}

export function loadPacks(ids: readonly string[]): Promise<CategoryPack[]> {
  return Promise.all(ids.map(loadPack));
}

/** Final Jeopardy candidates. */
export const FINALS: readonly FinalClue[] = (finalsFile as [string, string, string][]).map(
  ([category, clue, answer]) => ({ category, clue, answer }),
);
