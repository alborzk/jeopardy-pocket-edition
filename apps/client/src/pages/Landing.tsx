import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { boardSchema, countClues, describeBoardIssues } from '@jeopardy/shared';
import { loadBoards } from '../lib/boards';
import { hostGame } from '../lib/hostGame';
import { lastSession } from '../lib/session';

export function Landing() {
  const navigate = useNavigate();
  const boards = useMemo(() => loadBoards(), []);
  const previous = useMemo(() => lastSession(), []);
  const [boardId, setBoardId] = useState(boards[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const board = boards.find((b) => b.id === boardId);
  const issues = useMemo(() => (board ? describeBoardIssues(board) : []), [board]);

  const create = async () => {
    if (!board || issues.length > 0) return;
    const parsed = boardSchema.parse(board);
    setBusy(true);
    setError(null);
    const result = await hostGame(parsed);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    navigate(`/host/${result.code}`, { state: { boardError: result.boardError } });
  };

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col justify-center gap-8 p-6">
      <header className="text-center">
        <h1 className="font-display text-6xl uppercase tracking-wider text-gold board-text sm:text-7xl">
          Jeopardy Party
        </h1>
        <p className="mt-3 text-lg text-white/70">
          Game night with a TV, a host and everyone's phones.
        </p>
      </header>

      {previous ? (
        <Link
          to={previous.role === 'host' ? `/host/${previous.code}` : `/play/${previous.code}`}
          className="btn-secondary justify-between"
        >
          <span>
            Rejoin room <strong className="font-mono tracking-widest">{previous.code}</strong>
            {previous.role === 'player' && previous.name ? ` as ${previous.name}` : ' as host'}
          </span>
          <span aria-hidden>→</span>
        </Link>
      ) : null}

      <div className="grid gap-6 sm:grid-cols-2">
        <section className="card flex flex-col gap-4">
          <h2 className="font-display text-3xl uppercase text-gold">Host a game</h2>
          <p className="text-sm text-white/70">
            Pick a board, then put the display on your TV and run the game from your phone.
          </p>

          {boards.length > 0 ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-white/70">Board</span>
              <select
                className="field"
                value={boardId}
                onChange={(event) => setBoardId(event.target.value)}
              >
                {boards.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title || 'Untitled board'} ({countClues(b)} clues)
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="rounded-lg bg-white/10 p-3 text-sm">No boards yet. Make one first.</p>
          )}

          {issues.length > 0 ? (
            <p className="rounded-lg bg-buzz-out/20 p-3 text-sm">
              This board isn't finished ({issues.length} problem{issues.length === 1 ? '' : 's'}).
              Open the editor to fix it.
            </p>
          ) : null}
          {error ? <p className="text-sm text-red-300">{error}</p> : null}

          <button
            type="button"
            className="btn-primary"
            disabled={busy || !board || issues.length > 0}
            onClick={create}
          >
            {busy ? 'Creating…' : 'Create room'}
          </button>
          <Link to="/editor" className="text-center text-sm text-gold underline">
            Board editor
          </Link>
        </section>

        <section className="card flex flex-col gap-4">
          <h2 className="font-display text-3xl uppercase text-gold">Join a game</h2>
          <p className="text-sm text-white/70">
            Enter the 4-letter room code shown on the TV, or scan its QR code.
          </p>
          <div className="flex-1" />
          <Link to="/join" className="btn-primary">
            Join with a code
          </Link>
        </section>
      </div>
    </main>
  );
}
