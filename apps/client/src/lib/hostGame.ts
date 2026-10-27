import type { Ack, Board } from '@jeopardy/shared';
import { ensureConnected, request } from './socket';
import { saveSession } from './session';

/** Create a room, remember the host token, and load the chosen board into it. */
export async function hostGame(board: Board): Promise<Ack<{ code: string; boardError?: string }>> {
  if (!(await ensureConnected())) {
    return { ok: false, error: 'Could not reach the server. Is it running?' };
  }
  const created = await request('room:create', {});
  if (!created.ok) return created;
  saveSession({ code: created.code, token: created.hostToken, role: 'host' });

  const loaded = await request('host:loadBoard', { board });
  // The room exists either way. If the board was refused the host can pick another in the lobby.
  return { ok: true, code: created.code, ...(loaded.ok ? {} : { boardError: loaded.error }) };
}
