import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { boardSchema, describeBoardIssues } from '@jeopardy/shared';
import type { Phase, Snapshot } from '@jeopardy/shared';
import { Countdown, ReconnectingBanner, RoomGate, Toast, playerName } from '../components/common';
import { Standings } from '../components/Standings';
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
  const { phase } = snapshot;
  const canPause = phase !== 'lobby' && phase !== 'gameOver';

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 px-4 pb-6 pt-4">
      <Toast message={error} />

      <header className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-widest text-white/50">Host · room</div>
          <div className="font-display text-4xl leading-none tracking-[0.2em] text-gold">
            {snapshot.code}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold">{PHASE_LABEL[phase]}</div>
          {snapshot.board && phase !== 'lobby' ? (
            <div className="text-xs text-white/50">{snapshot.board.roundName}</div>
          ) : null}
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
      </header>

      {snapshot.frozen ? (
        <div className="rounded-xl bg-yellow-500 px-4 py-2 text-center text-sm font-bold text-black">
          Game paused. Timers are stopped.
        </div>
      ) : null}

      <PhasePanel snapshot={snapshot} offset={offset} run={run} />

      {snapshot.players.length > 0 ? <Scoreboard snapshot={snapshot} run={run} /> : null}

      {phase !== 'lobby' ? (
        <details className="card">
          <summary className="cursor-pointer text-sm font-semibold text-white/80">
            Game settings
          </summary>
          <div className="mt-3">
            <SettingsFields snapshot={snapshot} run={run} />
          </div>
        </details>
      ) : null}

      <footer className="mt-auto flex gap-3 pt-2">
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
            onClick={() => {
              if (window.confirm('End the game now and show the final standings?')) {
                void run('host:endGame', {});
              }
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
    <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t border-white/10 bg-board-deep px-4 py-3">
      {children}
    </div>
  );
}

function ClueCard({ snapshot }: { snapshot: Snapshot }) {
  const current = snapshot.current;
  if (!current) return null;
  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3 text-xs uppercase tracking-widest text-white/60">
        <span className="truncate">{current.category}</span>
        <span className="shrink-0 font-bold text-gold">
          {current.dailyDouble ? 'Daily Double · ' : ''}
          {formatMoney(current.value)}
        </span>
      </div>
      <p className="mt-3 font-clue text-xl leading-snug">{current.clue}</p>
      <div className="mt-4 rounded-xl bg-gold/15 p-3">
        <div className="text-xs font-bold uppercase tracking-widest text-gold">Answer</div>
        <div className="font-clue text-xl text-gold">{current.answer}</div>
      </div>
    </div>
  );
}

function JudgeButtons({ onJudge }: { onJudge: (correct: boolean) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <button type="button" className="btn-good py-5 text-xl" onClick={() => onJudge(true)}>
        ✓ Correct
      </button>
      <button type="button" className="btn-bad py-5 text-xl" onClick={() => onJudge(false)}>
        ✗ Incorrect
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
              <div className="mt-2 text-sm text-red-300">{resultLine(snapshot)}</div>
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
            <div className="text-xs uppercase tracking-widest text-white/60">Buzzed in</div>
            <div className="font-display text-5xl uppercase text-gold">
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
            <div className="font-display text-4xl uppercase text-gold">Daily Double!</div>
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
            <div className="text-xs uppercase tracking-widest text-white/60">
              {playerName(snapshot, snapshot.controlPlayerId)} wagered
            </div>
            <div className="font-display text-5xl text-gold">
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
            <div className="card text-center font-semibold">{resultLine(snapshot)}</div>
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
            <h2 className="mb-3 text-center font-display text-3xl uppercase text-gold">
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
          <h2 className="text-center font-display text-4xl uppercase text-gold">Final standings</h2>
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
        <h2 className="font-display text-2xl uppercase text-gold">1. Show the display</h2>
        <p className="text-sm text-white/70">
          Open this on the TV or a laptop connected to it. Players join with the code{' '}
          <strong className="text-white">{snapshot.code}</strong> at{' '}
          <span className="break-all font-mono">{joinUrl}</span>
        </p>
        <input
          className="field font-mono text-sm"
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
        <h2 className="font-display text-2xl uppercase text-gold">2. Board</h2>
        {snapshot.board ? (
          <p className="rounded-lg bg-buzz-open/20 p-3 text-sm">
            Loaded: <strong>{snapshot.board.title}</strong> ({snapshot.board.roundCount} round
            {snapshot.board.roundCount === 1 ? '' : 's'} + Final)
          </p>
        ) : (
          <p className="rounded-lg bg-yellow-500/20 p-3 text-sm">
            {initialBoardError
              ? `The board was refused: ${initialBoardError}`
              : 'No board loaded yet.'}
          </p>
        )}
        {boards.length > 0 ? (
          <div className="flex gap-2">
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
          <p className="text-sm text-red-300">
            That board has {issues.length} problem{issues.length === 1 ? '' : 's'}. Fix it in the{' '}
            <Link to="/editor" className="underline">
              editor
            </Link>
            .
          </p>
        ) : null}
      </section>

      <section className="card flex flex-col gap-3">
        <h2 className="font-display text-2xl uppercase text-gold">3. Settings</h2>
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
          <p className="text-center text-xs text-white/60">
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
        <div className="mb-2 text-sm text-white/80">Reveal the clue if nobody buzzes within</div>
        <div className="flex flex-wrap gap-2">
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
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="h-5 w-5 accent-yellow-400"
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
        <div className="text-xs uppercase tracking-widest text-white/60">In control</div>
        <div className="font-display text-3xl uppercase text-gold">{controller}</div>
        <div className="text-sm text-white/70">
          Tap the clue they call out. ★ is a Daily Double.
        </div>
      </div>
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${grid.length}, minmax(0, 1fr))` }}
      >
        {grid.map((category, c) => (
          <div
            key={`h${c}`}
            title={category.name}
            className="flex h-12 items-center justify-center overflow-hidden rounded bg-board px-0.5 text-center text-[10px] font-bold uppercase leading-tight"
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
                className="tap-target h-14 rounded bg-board font-display text-lg text-gold transition active:scale-95 disabled:bg-white/5 disabled:text-transparent"
                onClick={() => run('host:selectClue', { categoryIndex: c, clueIndex: r })}
              >
                {cell.used ? '' : cell.value}
                {!cell.used && cell.dailyDouble ? (
                  <span className="text-xs text-white"> ★</span>
                ) : null}
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
      <div className="text-xs uppercase tracking-widest text-white/60">Final Jeopardy</div>
      <div className="font-display text-3xl uppercase text-gold">{final.category}</div>
      <p className="mt-2 font-clue text-lg leading-snug">{final.clue}</p>
      <div className="mt-3 rounded-xl bg-gold/15 p-3">
        <div className="text-xs font-bold uppercase tracking-widest text-gold">Answer</div>
        <div className="font-clue text-xl text-gold">{final.answer}</div>
      </div>
    </div>
  );

  if (snapshot.phase === 'finalWager') {
    return (
      <>
        {header}
        <div className="card flex flex-col gap-2">
          <h3 className="font-semibold">
            Wagers ({final.wagered.length}/{final.eligible.length})
          </h3>
          {final.eligible.map((id) => (
            <div key={id} className="flex justify-between rounded-lg bg-white/10 px-3 py-2">
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
            <h3 className="font-semibold">
              Answers ({final.answered.length}/{final.eligible.length})
            </h3>
            <Countdown
              snapshot={snapshot}
              offset={offset}
              className="font-display text-4xl text-gold"
            />
          </div>
          {final.eligible.map((id) => (
            <div key={id} className="rounded-lg bg-white/10 px-3 py-2">
              <div className="flex justify-between">
                <span>{name(id)}</span>
                <span className={final.answered.includes(id) ? 'text-buzz-open' : 'text-white/50'}>
                  {final.answered.includes(id) ? 'answered' : 'writing…'}
                </span>
              </div>
              {final.answers?.[id] ? (
                <div className="font-clue text-white/80">{final.answers[id]}</div>
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
        <h3 className="font-semibold">Reveal order (lowest score first)</h3>
        {final.order.map((id) => {
          const reveal = final.reveals.find((r) => r.playerId === id);
          const wager = final.wagers?.[id] ?? 0;
          return (
            <div key={id} className="rounded-lg bg-white/10 px-3 py-2">
              <div className="flex justify-between gap-2">
                <span className="font-semibold">{name(id)}</span>
                <span className="text-sm text-white/70">
                  wagered {formatMoney(wager)}
                  {reveal?.correct === true ? ' · ✓' : reveal?.correct === false ? ' · ✗' : ''}
                </span>
              </div>
              <div className="font-clue text-white/80">
                {final.answers?.[id] ?? <span className="text-white/40">(no answer)</span>}
              </div>
            </div>
          );
        })}
      </div>
      <ActionBar>
        {awaitingJudgement && currentId ? (
          <>
            <div className="text-center text-sm text-white/70">
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
  const buzzed = snapshot.current?.buzzedPlayerId;

  return (
    <section className="card flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Players</h2>
        <div className="flex items-center gap-1 text-xs text-white/60">
          <span className="mr-1">±</span>
          {STEPS.map((amount) => (
            <button
              key={amount}
              type="button"
              className={`rounded-md px-2 py-1 ${step === amount ? 'bg-gold font-bold text-board-deep' : 'bg-white/10'}`}
              onClick={() => setStep(amount)}
            >
              {amount}
            </button>
          ))}
        </div>
      </div>
      <ul className="flex flex-col gap-2">
        {snapshot.players.map((player) => (
          <li
            key={player.id}
            className={`flex items-center gap-2 rounded-xl px-3 py-2 ${
              player.id === buzzed ? 'bg-buzz-open/30 ring-2 ring-buzz-open' : 'bg-white/10'
            }`}
          >
            <span
              title={player.connected ? 'Connected' : 'Disconnected'}
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${player.connected ? 'bg-buzz-open' : 'bg-white/30'}`}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">
                {player.id === snapshot.controlPlayerId ? '🎯 ' : ''}
                {player.name}
              </div>
              <div
                className={`font-display text-xl tabular-nums ${player.score < 0 ? 'text-red-300' : 'text-gold'}`}
              >
                {formatMoney(player.score)}
              </div>
            </div>
            <button
              type="button"
              className="btn-secondary h-10 w-10 p-0 text-xl"
              aria-label={`Subtract ${step} from ${player.name}`}
              onClick={() => run('host:adjustScore', { playerId: player.id, delta: -step })}
            >
              −
            </button>
            <button
              type="button"
              className="btn-secondary h-10 w-10 p-0 text-xl"
              aria-label={`Add ${step} to ${player.name}`}
              onClick={() => run('host:adjustScore', { playerId: player.id, delta: step })}
            >
              +
            </button>
            <button
              type="button"
              className="btn-secondary h-10 w-10 p-0 text-sm text-red-300"
              aria-label={`Remove ${player.name}`}
              title="Remove player"
              onClick={() => {
                if (window.confirm(`Remove ${player.name} from the game?`)) {
                  void run('host:kick', { playerId: player.id });
                }
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
