import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import QRCode from 'qrcode';
import type { PlayerView, Snapshot } from '@jeopardy/shared';
import { FINAL_ANSWER_MS, MAX_PLAYERS } from '@jeopardy/shared';
import {
  Countdown,
  CountdownBar,
  ReconnectingBanner,
  RoomGate,
  playerName,
} from '../components/common';
import { ranked } from '../components/Standings';
import { MarqueeBulbs, Studio } from '../components/Studio';
import { formatMoney } from '../lib/format';
import { useJoinBase } from '../lib/useJoinBase';
import { useRoom } from '../lib/useRoom';

// ---------------------------------------------------------------------------------------------
// Stage: everything is laid out for 1920x1080 and scaled to whatever screen this is on.
// ---------------------------------------------------------------------------------------------

const STAGE_W = 1920;
const STAGE_H = 1080;

function subscribeResize(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

function useViewport(): { width: number; height: number } {
  const key = useSyncExternalStore(
    subscribeResize,
    () => `${window.innerWidth}x${window.innerHeight}`,
  );
  const [width = STAGE_W, height = STAGE_H] = key.split('x').map(Number);
  return { width, height };
}

function subscribeFullscreen(onChange: () => void): () => void {
  document.addEventListener('fullscreenchange', onChange);
  return () => document.removeEventListener('fullscreenchange', onChange);
}

function FullscreenButton() {
  const fullscreen = useSyncExternalStore(
    subscribeFullscreen,
    () => document.fullscreenElement !== null,
  );
  if (fullscreen || !document.documentElement.requestFullscreen) return null;
  return (
    <button
      type="button"
      onClick={() => void document.documentElement.requestFullscreen().catch(() => undefined)}
      className="fixed right-3 top-3 z-50 rounded-lg bg-black/60 px-3 py-1.5 text-sm font-semibold text-white opacity-40 transition hover:opacity-100"
    >
      ⛶ Fullscreen
    </button>
  );
}

function Stage({ children }: { children: ReactNode }) {
  const { width, height } = useViewport();
  const scale = Math.min(width / STAGE_W, height / STAGE_H);
  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      <div
        className="absolute origin-top-left overflow-hidden bg-board-deep"
        style={{
          width: STAGE_W,
          height: STAGE_H,
          transform: `scale(${scale})`,
          left: (width - STAGE_W * scale) / 2,
          top: (height - STAGE_H * scale) / 2,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function Display({ code }: { code: string }) {
  const room = useRoom(code, 'display');
  return (
    <>
      <ReconnectingBanner connected={room.connected} floating />
      <FullscreenButton />
      <RoomGate room={room}>
        {(snapshot) => (
          <Stage>
            <Screen snapshot={snapshot} offset={room.offset} />
            {snapshot.frozen ? <PausedOverlay snapshot={snapshot} /> : null}
          </Stage>
        )}
      </RoomGate>
    </>
  );
}

function PausedOverlay({ snapshot }: { snapshot: Snapshot }) {
  if (snapshot.phase === 'lobby' && snapshot.hostConnected) return null;
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-black/75">
      <div className="font-display text-[200px] uppercase leading-none text-gold board-text">
        {snapshot.hostConnected ? 'Paused' : 'Host away'}
      </div>
      {snapshot.hostConnected ? null : (
        <div className="text-5xl text-white/80">Waiting for the host to reconnect…</div>
      )}
    </div>
  );
}

function Screen({ snapshot, offset }: { snapshot: Snapshot; offset: number }) {
  switch (snapshot.phase) {
    case 'lobby':
      return <LobbyScreen snapshot={snapshot} />;
    case 'board':
      return <BoardScreen snapshot={snapshot} />;
    case 'dailyDoubleWager':
      return <DailyDoubleScreen snapshot={snapshot} />;
    case 'clue':
    case 'buzzersOpen':
    case 'answering':
    case 'reveal':
    case 'dailyDoubleClue':
      return <ClueScreen snapshot={snapshot} offset={offset} />;
    case 'roundEnd':
      return <StandingsScreen snapshot={snapshot} title="End of round" />;
    case 'finalWager':
    case 'finalAnswer':
    case 'finalReveal':
      return <FinalScreen snapshot={snapshot} offset={offset} />;
    case 'gameOver':
      return <StandingsScreen snapshot={snapshot} title="Final standings" winner />;
  }
}

// ---------------------------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------------------------

const STRIP_GAP = 16;

function ScoreStrip({ snapshot }: { snapshot: Snapshot }) {
  const { players, controlPlayerId, current } = snapshot;
  if (players.length === 0) return <div className="h-[150px]" />;
  const crowded = players.length > 6;
  // Press Start 2P is monospaced at 1em per glyph, so size scores to fit the narrowest chip.
  const chipWidth = (STAGE_W - 64 - (players.length - 1) * STRIP_GAP) / players.length;
  const longest = Math.max(5, ...players.map((p) => formatMoney(p.score).length));
  const scoreSize = Math.min(34, Math.floor((chipWidth - 20) / longest));
  return (
    <div className="flex h-[150px] bg-studio-deep/80 px-8 py-5" style={{ gap: STRIP_GAP }}>
      {players.map((player) => {
        const buzzed = current?.buzzedPlayerId === player.id;
        const lockedOut = current?.lockedOut.includes(player.id) ?? false;
        const inControl = controlPlayerId === player.id;
        return (
          <div
            key={player.id}
            className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-2 px-3 transition-colors ${
              buzzed ? 'bg-buzz-open' : lockedOut ? 'bg-buzz-out/70' : 'bg-royal'
            } ${inControl ? 'gold-pulse' : 'pixel-frame'} ${player.connected ? '' : 'opacity-40'}`}
          >
            <div
              className={`w-full truncate text-center font-crt uppercase leading-none ${
                crowded ? 'text-[34px]' : 'text-[42px]'
              }`}
            >
              {player.name}
            </div>
            <div
              className={`font-pixel leading-none pixel-drop ${
                player.score < 0 ? 'text-neon-pink' : 'text-bulb'
              }`}
              style={{ fontSize: scoreSize }}
            >
              {formatMoney(player.score)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function QrCode({ value }: { value: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { margin: 1, width: 400, color: { dark: '#050820', light: '#ffffff' } })
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [value]);
  return src ? (
    <img src={src} alt={`QR code to join: ${value}`} className="h-[280px] w-[280px] pixel-frame" />
  ) : (
    <div className="h-[280px] w-[280px] bg-white/10 pixel-frame" />
  );
}

/** The show title, letters bobbing out of step like a marquee sign. */
function MarqueeTitle({ text }: { text: string }) {
  return (
    <h1 className="studio-flicker font-pixel text-[60px] uppercase leading-none text-bulb chroma-text">
      {[...text].map((char, i) =>
        char === ' ' ? (
          <span key={i}> </span>
        ) : (
          <span key={i} className="studio-bob" style={{ animationDelay: `${i * -0.18}s` }}>
            {char}
          </span>
        ),
      )}
    </h1>
  );
}

function BlinkingCursor() {
  return <span className="studio-blink">_</span>;
}

function clueFontSize(text: string): number {
  const length = text.length;
  if (length < 50) return 112;
  if (length < 100) return 96;
  if (length < 170) return 80;
  if (length < 260) return 66;
  return 54;
}

// ---------------------------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------------------------

const CODE_PANEL_W = 1040;
const CODE_PANEL_H = 640;

function LobbyScreen({ snapshot }: { snapshot: Snapshot }) {
  const base = useJoinBase();
  const joinUrl = `${base}/join?code=${snapshot.code}`;
  const shortHost = base.replace(/^https?:\/\//, '');

  return (
    <Studio audience>
      {/* The bottom 200px stays clear for the studio audience. */}
      <div className="flex h-full flex-col gap-12 px-14 pb-[200px] pt-12">
        <header className="flex items-center justify-between">
          <MarqueeTitle text="Jeopardy Party" />
          {snapshot.board ? (
            <div className="font-crt text-5xl uppercase text-neon-cyan chroma-text-sm">
              {snapshot.board.title}
            </div>
          ) : (
            <div className="font-crt text-5xl uppercase text-white/60">
              Waiting for a board
              <BlinkingCursor />
            </div>
          )}
        </header>

        <div className="flex gap-16">
          <section
            className="relative shrink-0"
            style={{ width: CODE_PANEL_W, height: CODE_PANEL_H }}
          >
            <MarqueeBulbs width={CODE_PANEL_W} height={CODE_PANEL_H} />
            <div className="absolute inset-[26px] flex flex-col items-center justify-center gap-8 bg-studio-deep/90">
              <div className="font-crt text-5xl uppercase tracking-[0.3em] text-white/70">
                Room code
              </div>
              <div className="font-pixel text-[168px] leading-none text-bulb chroma-text">
                {snapshot.code}
              </div>
              <div className="flex items-center gap-10">
                <QrCode value={joinUrl} />
                <div className="flex flex-col gap-3 font-crt text-5xl uppercase leading-tight">
                  <div className="text-white/70">Scan, or go to</div>
                  <div className="text-neon-cyan">
                    <div>{shortHost}</div>
                    <div>/join</div>
                  </div>
                  <div className="text-white/70">and enter the code</div>
                </div>
              </div>
            </div>
          </section>

          <section className="flex flex-1 flex-col gap-8" style={{ height: CODE_PANEL_H }}>
            <h2 className="flex items-baseline justify-between font-crt text-5xl uppercase tracking-[0.2em] text-white/80">
              <span>Contestants</span>
              <span className="text-bulb">
                {snapshot.players.length}/{MAX_PLAYERS}
              </span>
            </h2>
            {snapshot.players.length === 0 ? (
              <div className="flex flex-1 items-center justify-center font-crt text-6xl uppercase text-white/50">
                Waiting for players
                <BlinkingCursor />
              </div>
            ) : (
              <div className="grid grid-cols-2 content-start gap-x-7 gap-y-6">
                {snapshot.players.map((player) => (
                  <div
                    key={player.id}
                    className={`slam-in flex items-center gap-4 bg-royal px-5 py-3 pixel-frame ${
                      player.connected ? '' : 'opacity-40'
                    }`}
                  >
                    <span className="h-9 w-3 shrink-0 bg-bulb" />
                    <span className="truncate font-crt text-[46px] uppercase leading-none">
                      {player.name}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </Studio>
  );
}

const BOARD_PAD_X = 32;
const BOARD_GAP = 14;

/** Rounds whose board has already filled in on this screen, so it only animates once. */
const filledRounds = new Set<string>();

/** Scatters the fill-in order across the grid, like the board lighting up on the show. */
function fillOrder(c: number, r: number, cells: number): number {
  return (c * 7 + r * 13) % cells;
}

function BoardScreen({ snapshot }: { snapshot: Snapshot }) {
  const grid = snapshot.grid ?? [];
  const rows = grid[0]?.cells.length ?? 0;
  const controller = snapshot.players.find((p) => p.id === snapshot.controlPlayerId);

  const roundKey = `${snapshot.code}:${snapshot.board?.roundIndex ?? 0}`;
  const [fillIn] = useState(() => !filledRounds.has(roundKey));
  useEffect(() => {
    filledRounds.add(roundKey);
  }, [roundKey]);

  // Press Start 2P is monospaced at 1em per glyph, so size values to fit the column.
  const columnWidth = (STAGE_W - 2 * BOARD_PAD_X - (grid.length - 1) * BOARD_GAP) / grid.length;
  const longest = Math.max(
    1,
    ...grid.flatMap((category) => category.cells.map((cell) => formatMoney(cell.value).length)),
  );
  const valueSize = Math.min(64, Math.floor((columnWidth - 40) / longest));

  return (
    <Studio>
      <div className="flex h-full flex-col">
        {/* Padded down so the text clears the lamps on the lighting truss. */}
        <div className="flex h-[112px] shrink-0 items-center justify-between px-10 pt-9">
          <div className="font-crt text-[56px] uppercase tracking-[0.2em] text-neon-cyan chroma-text-sm">
            {snapshot.board?.roundName}
          </div>
          {controller ? (
            <div className="gold-pulse flex items-center gap-5 bg-studio-deep px-6 py-2">
              <span className="studio-blink h-0 w-0 border-y-[14px] border-l-[18px] border-y-transparent border-l-bulb" />
              <span className="font-crt text-[44px] uppercase text-white/70">Up next</span>
              <span className="font-pixel text-[30px] uppercase text-bulb">{controller.name}</span>
            </div>
          ) : null}
        </div>

        <div
          className="grid flex-1 pb-8 pt-2"
          style={{
            gap: BOARD_GAP,
            paddingInline: BOARD_PAD_X,
            gridTemplateColumns: `repeat(${grid.length}, minmax(0, 1fr))`,
            gridTemplateRows: `140px repeat(${rows}, minmax(0, 1fr))`,
          }}
        >
          {grid.map((category, c) => (
            <div
              key={`h${c}`}
              className={`flex items-center justify-center overflow-hidden bg-royal-deep px-3 text-center font-crt uppercase leading-[0.95] text-white pixel-frame chroma-text-sm ${
                fillIn ? 'slam-in' : ''
              }`}
              style={{
                fontSize: category.name.length > 16 ? 44 : 54,
                animationDelay: fillIn ? `${c * 90}ms` : undefined,
              }}
            >
              {category.name}
            </div>
          ))}
          {Array.from({ length: rows }, (_, r) =>
            grid.map((category, c) => {
              const cell = category.cells[r];
              const live = cell !== undefined && !cell.used;
              return (
                <div
                  key={`${c}-${r}`}
                  className={`flex items-center justify-center ${live ? 'pixel-tile' : 'pixel-tile-used'} ${
                    fillIn ? 'tile-in' : ''
                  }`}
                  style={
                    fillIn
                      ? { animationDelay: `${600 + fillOrder(c, r, grid.length * rows) * 35}ms` }
                      : undefined
                  }
                >
                  {live ? (
                    <span
                      className="font-pixel leading-none text-bulb pixel-drop"
                      style={{ fontSize: valueSize }}
                    >
                      {formatMoney(cell.value)}
                    </span>
                  ) : null}
                </div>
              );
            }),
          )}
        </div>

        <ScoreStrip snapshot={snapshot} />
      </div>
    </Studio>
  );
}

function DailyDoubleScreen({ snapshot }: { snapshot: Snapshot }) {
  const current = snapshot.current;
  const player = playerName(snapshot, snapshot.controlPlayerId);
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
        <div className="pop font-display text-[230px] uppercase leading-none text-gold board-text">
          Daily Double
        </div>
        <div className="text-6xl uppercase tracking-wide text-white/80">{current?.category}</div>
        <div className="text-6xl">
          <span className="font-bold uppercase text-gold">{player}</span> is placing a wager…
        </div>
        {current?.wagerLimits ? (
          <div className="text-4xl text-white/60">
            {formatMoney(current.wagerLimits.min)} to {formatMoney(current.wagerLimits.max)}
          </div>
        ) : null}
      </div>
      <ScoreStrip snapshot={snapshot} />
    </div>
  );
}

function ClueScreen({ snapshot, offset }: { snapshot: Snapshot; offset: number }) {
  const current = snapshot.current;
  if (!current) return null;
  const { phase, result } = snapshot;
  const buzzed = playerName(snapshot, current.buzzedPlayerId);
  const clueText = current.clue ?? '';
  const timeoutMs = snapshot.settings.buzzTimeoutMs;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-14 pt-8">
        <div className="font-display text-5xl uppercase tracking-wide text-white/90 board-text">
          {current.category}
        </div>
        <div className="font-display text-6xl text-gold board-text">
          {current.dailyDouble ? 'Daily Double' : formatMoney(current.value)}
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center px-24 text-center">
        <p
          className="font-clue uppercase leading-snug board-text"
          style={{ fontSize: clueFontSize(clueText) }}
        >
          {clueText}
        </p>
      </div>

      <div className="flex h-[200px] flex-col items-center justify-center gap-3 px-24 text-center">
        {phase === 'clue' && <div className="text-5xl text-white/50">Listen for the clue…</div>}

        {phase === 'buzzersOpen' && (
          <>
            {result?.outcome === 'incorrect' ? (
              <div className="text-4xl text-red-300">
                {playerName(snapshot, result.playerId)} missed. {formatMoney(result.delta)}
              </div>
            ) : null}
            <div className="font-display text-7xl uppercase text-buzz-open board-text">
              Buzz in!
            </div>
            {timeoutMs !== null ? (
              <CountdownBar
                snapshot={snapshot}
                offset={offset}
                totalMs={timeoutMs}
                className="max-w-[900px]"
              />
            ) : null}
          </>
        )}

        {phase === 'answering' && (
          <div className="pop font-display text-8xl uppercase text-gold board-text">{buzzed}</div>
        )}

        {phase === 'dailyDoubleClue' && (
          <div className="text-5xl">
            <span className="font-bold uppercase text-gold">
              {playerName(snapshot, snapshot.controlPlayerId)}
            </span>{' '}
            wagered {current.wager === null ? '' : formatMoney(current.wager)}
          </div>
        )}

        {phase === 'reveal' && (
          <>
            <div className="font-clue text-7xl uppercase text-gold board-text">
              {current.answer}
            </div>
            <div className="text-4xl text-white/80">
              {result?.outcome === 'correct' && (
                <>
                  {playerName(snapshot, result.playerId)} is right! {formatMoney(result.delta)}
                </>
              )}
              {result?.outcome === 'incorrect' && (
                <>
                  {playerName(snapshot, result.playerId)} missed. {formatMoney(result.delta)}
                </>
              )}
              {result?.outcome === 'timeout' && <>Time's up</>}
            </div>
          </>
        )}
      </div>

      <ScoreStrip snapshot={snapshot} />
    </div>
  );
}

function StandingsScreen({
  snapshot,
  title,
  winner = false,
}: {
  snapshot: Snapshot;
  title: string;
  winner?: boolean;
}) {
  const standings = ranked(snapshot.players);
  const top = standings[0]?.score ?? 0;
  const max = Math.max(1, top, ...standings.map((p) => Math.abs(p.score)));
  const crowded = standings.length > 8;

  return (
    <div className="flex h-full flex-col gap-6 px-24 py-12">
      <h1 className="text-center font-display text-8xl uppercase text-gold board-text">{title}</h1>
      {winner && standings[0] ? (
        <div className="pop text-center text-5xl">
          🏆 <span className="font-bold uppercase text-gold">{standings[0].name}</span> wins!
        </div>
      ) : null}
      <div className={`flex flex-1 flex-col justify-center ${crowded ? 'gap-2' : 'gap-4'}`}>
        {standings.map((player, index) => (
          <div key={player.id} className="flex items-center gap-6">
            <div className="w-16 text-right font-display text-5xl text-white/60">{index + 1}</div>
            <div
              className={`w-[420px] truncate font-bold uppercase ${crowded ? 'text-3xl' : 'text-4xl'}`}
            >
              {player.name}
            </div>
            <div className="flex-1">
              <div
                className={`rounded-r-xl ${index === 0 && winner ? 'bg-gold' : 'bg-board-light'} ${
                  crowded ? 'h-8' : 'h-12'
                }`}
                style={{ width: `${Math.max(2, (Math.max(0, player.score) / max) * 100)}%` }}
              />
            </div>
            <div
              className={`w-[300px] text-right font-display tabular-nums board-text ${
                crowded ? 'text-5xl' : 'text-6xl'
              } ${player.score < 0 ? 'text-red-300' : 'text-gold'}`}
            >
              {formatMoney(player.score)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlayerChips({
  players,
  ids,
  done,
}: {
  players: PlayerView[];
  ids: string[];
  done: string[];
}) {
  return (
    <div className="flex flex-wrap justify-center gap-4">
      {ids.map((id) => {
        const player = players.find((p) => p.id === id);
        if (!player) return null;
        const ready = done.includes(id);
        return (
          <div
            key={id}
            className={`rounded-2xl px-8 py-4 text-4xl font-bold uppercase transition-colors ${
              ready ? 'bg-buzz-open text-white' : 'bg-white/10 text-white/60'
            }`}
          >
            {ready ? '✓ ' : ''}
            {player.name}
          </div>
        );
      })}
    </div>
  );
}

function FinalScreen({ snapshot, offset }: { snapshot: Snapshot; offset: number }) {
  const final = snapshot.final;
  if (!final) return null;

  if (snapshot.phase === 'finalWager') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-10 px-24 text-center">
        <div className="font-display text-9xl uppercase text-gold board-text">Final Jeopardy</div>
        <div className="font-display text-8xl uppercase text-white board-text">
          {final.category}
        </div>
        <div className="text-5xl text-white/70">Place your wagers…</div>
        <PlayerChips players={snapshot.players} ids={final.eligible} done={final.wagered} />
      </div>
    );
  }

  if (snapshot.phase === 'finalAnswer') {
    const clueText = final.clue ?? '';
    return (
      <div className="flex h-full flex-col items-center justify-between gap-6 px-24 py-12 text-center">
        <div className="font-display text-6xl uppercase text-white/90 board-text">
          {final.category}
        </div>
        <p
          className="font-clue uppercase leading-snug board-text"
          style={{ fontSize: Math.min(clueFontSize(clueText), 88) }}
        >
          {clueText}
        </p>
        <div className="flex w-full flex-col items-center gap-5">
          <Countdown
            snapshot={snapshot}
            offset={offset}
            className="font-display text-[140px] leading-none text-gold board-text"
          />
          <CountdownBar
            snapshot={snapshot}
            offset={offset}
            totalMs={FINAL_ANSWER_MS}
            className="max-w-[1100px]"
          />
          <PlayerChips players={snapshot.players} ids={final.eligible} done={final.answered} />
        </div>
      </div>
    );
  }

  // finalReveal
  const current = final.reveals.find((r) => r.playerId === final.currentRevealId);
  const waiting = final.order.filter((id) => !final.reveals.some((r) => r.playerId === id));
  return (
    <div className="flex h-full flex-col gap-6 px-24 py-12 text-center">
      <div className="font-display text-6xl uppercase text-white/90 board-text">
        {final.category}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        {current ? (
          <>
            <div className="text-5xl text-white/70">
              <span className="font-bold uppercase text-gold">
                {playerName(snapshot, current.playerId)}
              </span>{' '}
              answered
            </div>
            <div className="pop font-clue text-8xl uppercase board-text">
              {current.answer || '(no answer)'}
            </div>
            {current.correct !== null ? (
              <div
                className={`pop font-display text-7xl board-text ${
                  current.correct ? 'text-buzz-open' : 'text-red-300'
                }`}
              >
                {current.correct ? 'Correct' : 'Incorrect'} · {current.correct ? '+' : '-'}
                {formatMoney(current.wager ?? 0)}
              </div>
            ) : (
              <div className="text-4xl text-white/50">Judging…</div>
            )}
          </>
        ) : (
          <div className="text-6xl text-white/60">
            {waiting.length > 0
              ? `Up first: ${playerName(snapshot, waiting[0])}`
              : 'All answers are in'}
          </div>
        )}
        {final.answer ? (
          <div className="mt-6 text-4xl text-white/70">
            Correct response: <span className="font-clue text-gold">{final.answer}</span>
          </div>
        ) : null}
      </div>
      <ScoreStrip snapshot={snapshot} />
    </div>
  );
}
