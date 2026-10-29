import { useMemo, useState } from 'react';
import { boardSchema, countClues, describeBoardIssues } from '@jeopardy/shared';
import { SlideLink } from '../components/SlideLink';
import { MarqueeTitle, StudioBackdrop } from '../components/Studio';
import { loadBoards } from '../lib/boards';
import { hostGame } from '../lib/hostGame';
import { lastSession } from '../lib/session';
import { useSlideNavigate } from '../lib/slide';

export function Landing() {
  const navigate = useSlideNavigate();
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
    <StudioBackdrop audience>
      {/* The bottom padding keeps the cards clear of the studio audience. */}
      <main className="mx-auto flex min-h-dvh max-w-4xl flex-col justify-center gap-10 px-4 pb-48 pt-16 sm:px-8">
        <header className="flex flex-col items-center gap-5 text-center">
          <MarqueeTitle text="Jeepy Party!" className="text-[clamp(22px,6vw,54px)]" />
          <p className="text-xl uppercase tracking-wider text-neon-cyan chroma-text-sm sm:text-2xl">
            A Jeopardy game for friends and enemies
          </p>
        </header>

        {previous ? (
          <SlideLink
            to={previous.role === 'host' ? `/host/${previous.code}` : `/play/${previous.code}`}
            className="btn-secondary justify-between text-left"
          >
            <span>
              Rejoin room <strong>{previous.code}</strong>
              {previous.role === 'player' && previous.name ? ` as ${previous.name}` : ' as host'}
            </span>
            <span aria-hidden>▶</span>
          </SlideLink>
        ) : null}

        <div className="grid gap-8 sm:grid-cols-2">
          <section className="card flex flex-col gap-5">
            <h2 className="font-pixel text-lg uppercase leading-snug text-bulb">Host a game</h2>
            <p className="text-xl text-white/75">
              Pick a board, then put the display on your TV and run the game from your phone.
            </p>

            {boards.length > 0 ? (
              <label className="flex flex-col gap-2">
                <span className="text-base uppercase tracking-widest text-white/60">Board</span>
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
              <p className="bg-royal-used p-3 text-lg">No boards yet. Make one first.</p>
            )}

            {issues.length > 0 ? (
              <p className="bg-buzz-out/25 p-3 text-lg">
                This board isn't finished ({issues.length} problem{issues.length === 1 ? '' : 's'}).
                Open the editor to fix it.
              </p>
            ) : null}
            {error ? <p className="text-lg text-neon-pink">{error}</p> : null}

            <button
              type="button"
              className="btn-primary"
              disabled={busy || !board || issues.length > 0}
              onClick={create}
            >
              {busy ? 'Creating…' : 'Create room'}
            </button>
            <SlideLink to="/editor" className="btn-secondary">
              Board editor
            </SlideLink>
          </section>

          <section className="card flex flex-col gap-5">
            <h2 className="font-pixel text-lg uppercase leading-snug text-bulb">Join a game</h2>
            <p className="text-xl text-white/75">
              Enter the 4-letter room code shown on the TV, or scan its QR code.
            </p>
            <div className="flex-1" />
            <SlideLink to="/join" className="btn-primary">
              Join with a code
            </SlideLink>
          </section>
        </div>
      </main>
    </StudioBackdrop>
  );
}
