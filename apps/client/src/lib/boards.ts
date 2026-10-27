import { boardDraftSchema } from '@jeopardy/shared';
import type { Board } from '@jeopardy/shared';
import sampleBoardJson from '../sample-board.json';

const STORAGE_KEY = 'jeopardy.boards.v1';

export const sampleBoard: Board = boardDraftSchema.parse(sampleBoardJson);

/**
 * Saved boards. Drafts are stored leniently (blank text allowed) so autosave never loses work.
 * The sample board is added the first time, but not again if the host deletes it.
 */
export function loadBoards(): Board[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [sampleBoard];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [sampleBoard];
    const boards: Board[] = [];
    for (const item of parsed) {
      const result = boardDraftSchema.safeParse(item);
      if (result.success) boards.push(result.data);
    }
    return boards;
  } catch {
    return [sampleBoard];
  }
}

export function saveBoards(boards: Board[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(boards));
    return true;
  } catch {
    return false;
  }
}

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'board'
  );
}

export function downloadBoard(board: Board): void {
  const blob = new Blob([JSON.stringify(board, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${slugify(board.title)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
