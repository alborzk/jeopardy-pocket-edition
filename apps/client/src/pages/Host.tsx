import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { boardSchema, describeBoardIssues } from '@jeopardy/shared';
import type { Phase, Snapshot } from '@jeopardy/shared';
import { Countdown, ReconnectingBanner, RoomGate, Toast, playerName } from '../components/common';
import { useModal } from '../components/Modal';
import { Standings } from '../components/Standings';
import { ControlMarker, DailyDoubleBadge } from '../components/Studio';
import { loadBoards } from '../lib/boards';
import { formatMoney } from '../lib/format';
import { useAction } from '../lib/useAction';
import { useJoinBase } from '../lib/useJoinBase';
import { useRoom } from '../lib/useRoom';

type Run = ReturnType<typeof useAction>['run'];

const PHASE_LABEL: Record<Phase, string> = {
  lobby: 'Lobby',
  board: 'Pick a clue',
  clue: 'Reading the clue',
  buzzersOpen: 'Buzzers open',
  answering: 'Judge the answer',
  reveal: 'Answer revealed',
  dailyDoubleWager: 'Daily Double wager',
  dailyDoubleClue: 'Daily Double',
  roundEnd: 'Round over',
  finalWager: 'Final wagers',
  finalAnswer: 'Final answers',
  finalReveal: 'Final reveal',
  gameOver: 'Game over',
};

export function Host({ code }: { code: string }) {
  const room = useRoom(code, 'host');
  return (
    <>
      <ReconnectingBanner connected={room.connected} />
      <RoomGate room={room}>
        {(snapshot) => <HostScreen snapshot={snapshot} offset={room.offset} />}
      </RoomGate>
    </>
  );
}

function HostScreen({ snapshot, offset }: { snapshot: Snapshot; offset: number }) {
  const { run, error } = useAction();
  const { confirm } = useModal();
  const { phase } = snapshot;
  const canPause = phase !== 'lobby' && phase !== 'gameOver';

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 px-4 pb-6 pt-4">
      <Toast message={error} />

      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-base uppercase tracking-widest text-white/50">Host · room</div>
            <div className="font-pixel text-2xl leading-none tracking-[0.15em] text-bulb chroma-text-sm">
              {snapshot.code}
            </div>
          </div>
          {canPause ? (
            <button
              type="button"
              className={snapshot.paused ? 'btn-primary px-3 py-2' : 'btn-secondary px-3 py-2'}
              onClick={() => run(snapshot.paused ? 'host:resume' : 'host:pause', {})}
            >
              {snapshot.paused ? '▶ Resume' : '⏸ Pause'}
            </button>
          ) : null}
        </div>
        <div className="flex items-baseline justify-between gap-3 border-y-[3px] border-[#1c2a70] py-1.5">
          <span className="text-2xl uppercase leading-none text-neon-cyan">
            {PHASE_LABEL[phase]}
          </span>
          {snapshot.board && phase !== 'lobby' ? (
            <span className="truncate text-lg uppercase leading-none text-white/50">
              {snapshot.board.roundName}
            </span>
          ) : null}
        </div>
      </header>

      {snapshot.frozen ? (
        <div className="bg-bulb px-4 py-2 text-center text-xl uppercase text-studio-deep pixel-frame">
          Game paused. Timers are stopped.
        </div>
      ) : null}

      <PhasePanel snapshot={snapshot} offset={offset} run={run} />

      {snapshot.players.length > 0 ? <Scoreboard snapshot={snapshot} run={run} /> : null}

      {phase !== 'lobby' ? (
        <details className="card">
          <summary className="cursor-pointer text-xl uppercase text-white/80">
            Game settings
          </summary>
          <div className="mt-3">
            <SettingsFields snapshot={snapshot} run={run} />
          </div>
        </details>
      ) : null}

      <footer className="mt-auto flex gap-4 pt-4">
        <button
          type="button"
          className="btn-secondary flex-1"
          disabled={!snapshot.canUndo}
          onClick={() => run('host:undo', {})}
        >
          ↶ Undo
        </button>
        {phase !== 'gameOver' ? (
          <button
            type="button"
            className="btn-secondary flex-1"
            onClick={async () => {
              const ok = await confirm({
                title: 'End the game?',
                message: 'Everyone goes straight to the final standings. Undo can take it back.',
                confirmLabel: 'End game',
                tone: 'danger',
              });
              if (ok) void run('host:endGame', {});
            }}
          >
            End game
          </button>
        ) : null}
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------------------------

function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-4 border-t-[3px] border-[#1c2a70] bg-studio-deep px-4 pb-5 pt-4">
      {children}
    </div>
  );
}

function ClueCard({ snapshot }: { snapshot: Snapshot }) {
  const current = snapshot.current;
  if (!current) return null;
  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3 text-base uppercase tracking-widest text-white/60">
        <span className="truncate">{current.category}</span>
        <span className="shrink-0 font-pixel text-sm text-bulb">
          {current.dailyDouble ? 'Daily Double · ' : ''}
          {formatMoney(current.value)}
        </span>
      </div>
      <p className="mt-3 text-2xl uppercase leading-tight">{current.clue}</p>
      <div className="mt-4 bg-bulb/10 p-3 shadow-[inset_0_0_0_3px_rgb(255_209_102/0.45)]">
        <div className="text-base uppercase tracking-widest text-bulb">Answer</div>
        <div className="text-2xl uppercase leading-tight text-bulb">{current.answer}</div>
      </div>
    </div>
  );
}

function JudgeButtons({ onJudge }: { onJudge: (correct: boolean) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <button
        type="button"
        className="btn-good flex-col py-4 text-2xl"
        onClick={() => onJudge(true)}
      >
        <span className="text-3xl leading-none">✓</span>
        Correct
      </button>
      <button
        type="button"
        className="btn-bad flex-col py-4 text-2xl"
        onClick={() => onJudge(false)}
      >
        <span className="text-3xl leading-none">✗</span>
        Incorrect
      </button>
    </div>
  );
}

function SkipButton({ run }: { run: Run }) {
  return (
    <button type="button" className="btn-secondary" onClick={() => run('host:skipClue', {})}>
      Skip clue
    </button>
  );
}

function resultLine(snapshot: Snapshot): string | null {
  const result = snapshot.result;
  if (!result) return null;
  const who = playerName(snapshot, result.playerId);
  switch (result.outcome) {
    case 'correct':
      return `${who} was correct: ${formatMoney(result.delta)}`;
    case 'incorrect':
      return `${who} was incorrect: ${formatMoney(result.delta)}`;
    case 'timeout':
      return 'Nobody buzzed in time';
    case 'skipped':
      return 'Clue skipped';
  }
}

// ---------------------------------------------------------------------------------------------
// Phase panels
// ---------------------------------------------------------------------------------------------

function PhasePanel({ snapshot, offset, run }: { snapshot: Snapshot; offset: number; run: Run }) {
  switch (snapshot.phase) {
    case 'lobby':
      return <LobbyPanel snapshot={snapshot} run={run} />;

    case 'board':
      return <BoardPanel snapshot={snapshot} run={run} />;

    case 'clue':
      return (
        <>
          <ClueCard snapshot={snapshot} />
          <ActionBar>
            <button
              type="button"
              className="btn-primary py-5 text-xl"
              onClick={() => run('host:openBuzzers', {})}
            >
              Open buzzers
            </button>
            <SkipButton run={run} />
          </ActionBar>
        </>
      );

    case 'buzzersOpen':
      return (
        <>
          <ClueCard snapshot={snapshot} />
          <div className="card text-center">
            <div className="font-display text-3xl uppercase text-buzz-open">Buzzers are open</div>
            {snapshot.deadline !== null || snapshot.remainingMs !== null ? (
              <div className="mt-1 text-white/70">
                Reveals in <Countdown snapshot={snapshot} offset={offset} />s if nobody buzzes
              </div>
            ) : (
              <div className="mt-1 text-white/70">Waiting for a buzz</div>
            )}
            {resultLine(snapshot) ? (
              <div className="mt-2 text-lg text-neon-pink">{resultLine(snapshot)}</div>
            ) : null}
          </div>
          <ActionBar>
            <SkipButton run={run} />
          </ActionBar>
        </>
      );

    case 'answering':
      return (
        <>
          <div className="card text-center">
            <div className="text-base uppercase tracking-widest text-white/60">Buzzed in</div>
            <div className="font-pixel text-[clamp(18px,6.5vw,34px)] uppercase leading-tight text-bulb [overflow-wrap:anywhere]">
              {playerName(snapshot, snapshot.current?.buzzedPlayerId)}
            </div>
          </div>
          <ClueCard snapshot={snapshot} />
          <ActionBar>
            <JudgeButtons onJudge={(correct) => run('host:judge', { correct })} />
            <SkipButton run={run} />
          </ActionBar>
        </>
      );

    case 'dailyDoubleWager': {
      const limits = snapshot.current?.wagerLimits;
      return (
        <>
          <div className="card text-center">
            <div className="font-pixel text-[clamp(18px,6vw,30px)] uppercase leading-tight text-neon-pink chroma-text-sm">
              Daily Double!
            </div>
            <div className="mt-1">
              Waiting for{' '}
              <strong className="uppercase">
                {playerName(snapshot, snapshot.controlPlayerId)}
              </strong>{' '}
              to wager
              {limits ? ` (${formatMoney(limits.min)} to ${formatMoney(limits.max)})` : ''}
            </div>
          </div>
          <ClueCard snapshot={snapshot} />
          <ActionBar>
            <SkipButton run={run} />
          </ActionBar>
        </>
      );
    }

    case 'dailyDoubleClue':
      return (
        <>
          <div className="card text-center">
            <div className="text-base uppercase tracking-widest text-white/60">
              {playerName(snapshot, snapshot.controlPlayerId)} wagered
            </div>
            <div className="font-pixel text-3xl text-bulb pixel-drop-sm">
              {formatMoney(snapshot.current?.wager ?? 0)}
            </div>
          </div>
          <ClueCard snapshot={snapshot} />
          <ActionBar>
            <JudgeButtons onJudge={(correct) => run('host:judge', { correct })} />
            <SkipButton run={run} />
          </ActionBar>
        </>
      );

    case 'reveal':
      return (
        <>
          <ClueCard snapshot={snapshot} />
          {resultLine(snapshot) ? (
            <div className="card text-center text-2xl uppercase">{resultLine(snapshot)}</div>
          ) : null}
          <ActionBar>
            <button
              type="button"
              className="btn-primary py-5 text-xl"
              onClick={() => run('host:continue', {})}
            >
              Continue
            </button>
          </ActionBar>
        </>
      );

    case 'roundEnd': {
      const board = snapshot.board;
      const nextIsFinal = !board || board.roundIndex + 1 >= board.roundCount;
      return (
        <>
          <div className="card">
            <h2 className="mb-4 text-center font-pixel text-xl uppercase leading-snug text-bulb">
              Round over
            </h2>
            <Standings players={snapshot.players} />
          </div>
          <ActionBar>
            <button
              type="button"
              className="btn-primary py-5 text-xl"
              onClick={() => run('host:continue', {})}
            >
              {nextIsFinal ? 'Go to Final Jeopardy' : 'Start next round'}
            </button>
          </ActionBar>
        </>
      );
    }

    case 'finalWager':
    case 'finalAnswer':
    case 'finalReveal':
      return <FinalPanel snapshot={snapshot} offset={offset} run={run} />;

    case 'gameOver':
      return (
        <div className="card flex flex-col gap-4">
          <h2 className="text-center font-pixel text-xl uppercase leading-snug text-bulb">
            Final standings
          </h2>
          <Standings players={snapshot.players} />
          <Link to="/" className="btn-secondary">
            Back to start
          </Link>
        </div>
      );
  }
}

function LobbyPanel({ snapshot, run }: { snapshot: Snapshot; run: Run }) {
  const base = useJoinBase();
  const location = useLocation();
  const initialBoardError = (location.state as { boardError?: string } | null)?.boardError;
  const boards = useMemo(() => loadBoards(), []);
  const [boardId, setBoardId] = useState(boards[0]?.id ?? '');
  const board = boards.find((b) => b.id === boardId);
  const issues = useMemo(() => (board ? describeBoardIssues(board) : []), [board]);

  const displayUrl = `${base}/display/${snapshot.code}`;
  const joinUrl = `${base}/join?code=${snapshot.code}`;
  const ready = snapshot.board !== null && snapshot.players.length > 0;

  return (
    <>
      <section className="card flex flex-col gap-3">
        <h2 className="font-display text-3xl uppercase leading-none text-bulb chroma-text-sm">
          1. Show the display
        </h2>
        <p className="text-lg text-white/70">
          Open this on the TV or a laptop connected to it. Players join with the code{' '}
          <strong>{snapshot.code}</strong> at{' '}
          <span className="break-all text-neon-cyan">{joinUrl}</span>
        </p>
        <input
          className="field text-base"
          readOnly
          value={displayUrl}
          onFocus={(event) => event.target.select()}
          aria-label="Display address"
        />
        <a className="btn-secondary" href={displayUrl} target="_blank" rel="noreferrer">
          Open display ↗
        </a>
      </section>

      <section className="card flex flex-col gap-3">
        <h2 className="font-display text-3xl uppercase leading-none text-bulb chroma-text-sm">
          2. Board
        </h2>
        {snapshot.board ? (
          <p className="bg-buzz-open/20 p-3 text-lg">
            Loaded: <strong>{snapshot.board.title}</strong> ({snapshot.board.roundCount} round
            {snapshot.board.roundCount === 1 ? '' : 's'} + Final)
          </p>
        ) : (
          <p className="bg-bulb/15 p-3 text-lg">
            {initialBoardError
              ? `The board was refused: ${initialBoardError}`
              : 'No board loaded yet.'}
          </p>
        )}
        {boards.length > 0 ? (
          <div className="flex gap-4">
            <select
              className="field"
              value={boardId}
              onChange={(event) => setBoardId(event.target.value)}
              aria-label="Saved boards"
            >
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title || 'Untitled board'}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-secondary shrink-0"
              disabled={!board || issues.length > 0}
              onClick={() => board && run('host:loadBoard', { board: boardSchema.parse(board) })}
            >
              Load
            </button>
          </div>
        ) : null}
        {issues.length > 0 ? (
          <p className="text-lg text-neon-pink">
            That board has {issues.length} problem{issues.length === 1 ? '' : 's'}. Fix it in the{' '}
            <Link to="/editor" className="underline">
              editor
            </Link>
            .
          </p>
        ) : null}
      </section>

      <section className="card flex flex-col gap-3">
        <h2 className="font-display text-3xl uppercase leading-none text-bulb chroma-text-sm">
          3. Settings
        </h2>
        <SettingsFields snapshot={snapshot} run={run} />
      </section>

      <ActionBar>
        <button
          type="button"
          className="btn-primary py-5 text-xl"
          disabled={!ready}
          onClick={() => run('host:start', {})}
        >
          Start game ({snapshot.players.length} player{snapshot.players.length === 1 ? '' : 's'})
        </button>
        {!ready ? (
          <p className="text-center text-base text-white/60">
            {snapshot.board ? 'Waiting for at least one player to join.' : 'Load a board first.'}
          </p>
        ) : null}
      </ActionBar>
    </>
  );
}

const TIMEOUT_CHOICES: { label: string; value: number | null }[] = [
  { label: 'Off', value: null },
  { label: '3s', value: 3000 },
  { label: '5s', value: 5000 },
  { label: '8s', value: 8000 },
  { label: '10s', value: 10000 },
  { label: '15s', value: 15000 },
];

function SettingsFields({ snapshot, run }: { snapshot: Snapshot; run: Run }) {
  const { buzzTimeoutMs, finalIncludeAll } = snapshot.settings;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-3 text-lg text-white/80">Reveal the clue if nobody buzzes within</div>
        <div className="flex flex-wrap gap-3">
          {TIMEOUT_CHOICES.map((choice) => (
            <button
              key={choice.label}
              type="button"
              className={
                buzzTimeoutMs === choice.value ? 'btn-primary px-4 py-2' : 'btn-secondary px-4 py-2'
              }
              onClick={() => run('host:setSettings', { buzzTimeoutMs: choice.value })}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-3 text-lg">
        <input
          type="checkbox"
          className="h-6 w-6 shrink-0 accent-bulb"
          checked={finalIncludeAll}
          onChange={(event) => run('host:setSettings', { finalIncludeAll: event.target.checked })}
        />
        Let everyone play Final Jeopardy, even with a score of $0 or less
      </label>
    </div>
  );
}

function BoardPanel({ snapshot, run }: { snapshot: Snapshot; run: Run }) {
  const grid = snapshot.grid ?? [];
  const rows = grid[0]?.cells.length ?? 0;
  const controller = playerName(snapshot, snapshot.controlPlayerId);

  return (
    <section className="card flex flex-col gap-3">
      <div className="text-center">
        <div className="text-base uppercase tracking-widest text-white/60">In control</div>
        <div className="font-pixel text-xl uppercase leading-tight text-bulb">{controller}</div>
        <div className="text-lg text-white/70">
          Tap the clue they call out. DD is a Daily Double.
        </div>
      </div>
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${grid.length}, minmax(0, 1fr))` }}
      >
        {grid.map((category, c) => (
          <div
            key={`h${c}`}
            title={category.name}
            className="flex h-14 items-center justify-center overflow-hidden bg-royal-deep px-0.5 text-center text-[14px] uppercase leading-[0.95] [overflow-wrap:anywhere]"
          >
            {category.name}
          </div>
        ))}
        {Array.from({ length: rows }, (_, r) =>
          grid.map((category, c) => {
            const cell = category.cells[r];
            if (!cell) return <div key={`${c}-${r}`} />;
            return (
              <button
                key={`${c}-${r}`}
                type="button"
                disabled={cell.used}
                aria-label={`${category.name} for ${cell.value}`}
                className={`tap-target relative h-14 text-xl text-bulb transition active:brightness-125 ${
                  cell.used ? 'pixel-tile-used' : 'pixel-tile'
                }`}
                onClick={() => run('host:selectClue', { categoryIndex: c, clueIndex: r })}
              >
                {cell.used ? '' : cell.value}
                {!cell.used && cell.dailyDouble ? <DailyDoubleBadge /> : null}
              </button>
            );
          }),
        )}
      </div>
    </section>
  );
}

function FinalPanel({ snapshot, offset, run }: { snapshot: Snapshot; offset: number; run: Run }) {
  const final = snapshot.final;
  if (!final) return null;
  const name = (id: string) => playerName(snapshot, id);

  const header = (
    <div className="card">
      <div className="text-base uppercase tracking-widest text-white/60">Final Jeopardy</div>
      <div className="font-display text-3xl uppercase text-gold">{final.category}</div>
      <p className="mt-2 text-2xl uppercase leading-tight">{final.clue}</p>
      <div className="mt-3 bg-bulb/10 p-3 shadow-[inset_0_0_0_3px_rgb(255_209_102/0.45)]">
        <div className="text-base uppercase tracking-widest text-bulb">Answer</div>
        <div className="text-2xl uppercase leading-tight text-bulb">{final.answer}</div>
      </div>
    </div>
  );

  if (snapshot.phase === 'finalWager') {
    return (
      <>
        {header}
        <div className="card flex flex-col gap-2">
          <h3 className="text-xl uppercase text-bulb">
            Wagers ({final.wagered.length}/{final.eligible.length})
          </h3>
          {final.eligible.map((id) => (
            <div key={id} className="flex justify-between bg-royal-used px-3 py-2">
              <span>{name(id)}</span>
              <span className={final.wagered.includes(id) ? 'text-buzz-open' : 'text-white/50'}>
                {final.wagers?.[id] !== undefined ? formatMoney(final.wagers[id] ?? 0) : 'waiting…'}
              </span>
            </div>
          ))}
        </div>
        <ActionBar>
          <button
            type="button"
            className="btn-primary py-5 text-xl"
            onClick={() => run('host:continue', {})}
          >
            Show clue & start 30s timer
          </button>
        </ActionBar>
      </>
    );
  }

  if (snapshot.phase === 'finalAnswer') {
    return (
      <>
        {header}
        <div className="card flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <h3 className="text-xl uppercase text-bulb">
              Answers ({final.answered.length}/{final.eligible.length})
            </h3>
            <Countdown
              snapshot={snapshot}
              offset={offset}
              className="font-pixel text-2xl text-bulb"
            />
          </div>
          {final.eligible.map((id) => (
            <div key={id} className="bg-royal-used px-3 py-2">
              <div className="flex justify-between">
                <span>{name(id)}</span>
                <span className={final.answered.includes(id) ? 'text-buzz-open' : 'text-white/50'}>
                  {final.answered.includes(id) ? 'answered' : 'writing…'}
                </span>
              </div>
              {final.answers?.[id] ? (
                <div className="text-xl uppercase text-white/80">{final.answers[id]}</div>
              ) : null}
            </div>
          ))}
        </div>
        <ActionBar>
          <button type="button" className="btn-secondary" onClick={() => run('host:continue', {})}>
            End the timer early
          </button>
        </ActionBar>
      </>
    );
  }

  // finalReveal: lowest score first, one player at a time.
  const currentId = final.currentRevealId;
  const current = final.reveals.find((r) => r.playerId === currentId);
  const awaitingJudgement = current !== undefined && current.correct === null;
  const nextId = final.order.find((id) => !final.reveals.some((r) => r.playerId === id));

  return (
    <>
      {header}
      <div className="card flex flex-col gap-2">
        <h3 className="text-xl uppercase text-bulb">Reveal order (lowest score first)</h3>
        {final.order.map((id) => {
          const reveal = final.reveals.find((r) => r.playerId === id);
          const wager = final.wagers?.[id] ?? 0;
          return (
            <div key={id} className="bg-royal-used px-3 py-2">
              <div className="flex justify-between gap-2">
                <span className="uppercase">{name(id)}</span>
                <span className="text-base text-white/70">
                  wagered {formatMoney(wager)}
                  {reveal?.correct === true ? ' · ✓' : reveal?.correct === false ? ' · ✗' : ''}
                </span>
              </div>
              <div className="text-xl uppercase text-white/80">
                {final.answers?.[id] ?? <span className="text-white/40">(no answer)</span>}
              </div>
            </div>
          );
        })}
      </div>
      <ActionBar>
        {awaitingJudgement && currentId ? (
          <>
            <div className="text-center text-lg text-white/70">
              Judge <strong>{name(currentId)}</strong>'s answer
            </div>
            <JudgeButtons
              onJudge={(correct) => run('host:finalJudge', { playerId: currentId, correct })}
            />
          </>
        ) : nextId ? (
          <button
            type="button"
            className="btn-primary py-5 text-xl"
            onClick={() => run('host:finalReveal', { playerId: nextId })}
          >
            Reveal {name(nextId)}'s answer
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary py-5 text-xl"
            onClick={() => run('host:continue', {})}
          >
            Show final standings
          </button>
        )}
      </ActionBar>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Scoreboard
// ---------------------------------------------------------------------------------------------

const STEPS = [100, 200, 500, 1000];

function Scoreboard({ snapshot, run }: { snapshot: Snapshot; run: Run }) {
  const [step, setStep] = useState(100);
  const { confirm } = useModal();
  const buzzed = snapshot.current?.buzzedPlayerId;

  return (
    <section className="card flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-3xl uppercase leading-none text-bulb chroma-text-sm">Players</h2>
        <div className="flex items-center gap-1.5 text-lg text-white/60">
          <span className="mr-1">±</span>
          {STEPS.map((amount) => (
            <button
              key={amount}
              type="button"
              className={`px-2 py-1 ${step === amount ? 'bg-bulb text-studio-deep' : 'bg-royal-used'}`}
              onClick={() => setStep(amount)}
            >
              {amount}
            </button>
          ))}
        </div>
      </div>
      <ul className="flex flex-col gap-3">
        {snapshot.players.map((player) => (
          <li
            key={player.id}
            className={`flex items-center gap-3 px-3 py-2 ${
              player.id === buzzed
                ? 'bg-buzz-open/30 shadow-[inset_0_0_0_3px_var(--color-buzz-open)]'
                : 'bg-royal-used'
            }`}
          >
            <span
              title={player.connected ? 'Connected' : 'Disconnected'}
              className={`h-3 w-3 shrink-0 ${player.connected ? 'bg-buzz-open' : 'bg-white/30'}`}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex items-center gap-2 text-xl uppercase leading-none">
                {player.id === snapshot.controlPlayerId ? <ControlMarker /> : null}
                <span className="truncate">{player.name}</span>
              </div>
              <div
                className={`font-pixel text-xs ${player.score < 0 ? 'text-neon-pink' : 'text-bulb'}`}
              >
                {formatMoney(player.score)}
              </div>
            </div>
            <button
              type="button"
              className="btn-secondary h-11 w-11 p-0 text-2xl"
              aria-label={`Subtract ${step} from ${player.name}`}
              onClick={() => run('host:adjustScore', { playerId: player.id, delta: -step })}
            >
              −
            </button>
            <button
              type="button"
              className="btn-secondary h-11 w-11 p-0 text-2xl"
              aria-label={`Add ${step} to ${player.name}`}
              onClick={() => run('host:adjustScore', { playerId: player.id, delta: step })}
            >
              +
            </button>
            <button
              type="button"
              className="btn-secondary h-11 w-11 p-0 text-xl text-neon-pink"
              aria-label={`Remove ${player.name}`}
              title="Remove player"
              onClick={async () => {
                const ok = await confirm({
                  title: `Remove ${player.name}?`,
                  message:
                    'They lose their seat and score, and their phone shows they were removed.',
                  confirmLabel: 'Remove',
                  tone: 'danger',
                });
                if (ok) void run('host:kick', { playerId: player.id });
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
