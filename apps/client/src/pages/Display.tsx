import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import QRCode from 'qrcode';
import type { CurrentClueView, PlayerView, Snapshot } from '@jeopardy/shared';
import { FINAL_ANSWER_MS, MAX_PLAYERS } from '@jeopardy/shared';
import { Countdown, ReconnectingBanner, RoomGate, playerName } from '../components/common';
import { ranked } from '../components/Standings';
import { BlinkingCursor, MarqueeBulbs, MarqueeTitle, Studio } from '../components/Studio';
import { useRemaining } from '../lib/clock';
import { formatMoney } from '../lib/format';
import type { Point } from '../lib/studioScene';
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

/** How long the fullscreen button stays up after the mouse last moved. */
const BUTTON_IDLE_MS = 2500;

/** Only shows while the mouse is moving, so it never sits on top of the show. */
function FullscreenButton() {
  const fullscreen = useSyncExternalStore(
    subscribeFullscreen,
    () => document.fullscreenElement !== null,
  );
  const [awake, setAwake] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wake = () => {
      setAwake(true);
      clearTimeout(timer);
      timer = setTimeout(() => setAwake(false), BUTTON_IDLE_MS);
    };
    window.addEventListener('pointermove', wake);
    return () => {
      window.removeEventListener('pointermove', wake);
      clearTimeout(timer);
    };
  }, []);

  if (fullscreen || !document.documentElement.requestFullscreen) return null;
  return (
    <button
      type="button"
      onClick={() => void document.documentElement.requestFullscreen().catch(() => undefined)}
      className={`fixed right-3 top-3 z-50 bg-studio-deep/90 px-3 py-1.5 text-lg uppercase text-white transition-opacity pixel-frame ${
        awake ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
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
        data-stage
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
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-10 bg-studio-deep/85">
      <div className="studio-flicker font-pixel text-[120px] uppercase leading-none text-bulb chroma-text">
        {snapshot.hostConnected ? 'Paused' : 'Host away'}
      </div>
      {snapshot.hostConnected ? null : (
        <div className="font-crt text-[56px] uppercase text-white/80">
          Waiting for the host to reconnect
          <BlinkingCursor />
        </div>
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

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * An element's box in stage pixels. Offsets ignore CSS transforms, so neither the stage's
 * scaling nor an animation in progress skews it.
 */
function stageRect(element: HTMLElement): Rect {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = element;
  while (node && !node.hasAttribute('data-stage')) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x, y, width: element.offsetWidth, height: element.offsetHeight };
}

const STRIP_H = 150;
const STRIP_GAP = 16;

const SCORE_SLAM: Keyframe[] = [
  { transform: 'scale(1)' },
  { transform: 'scale(1.45) rotate(-3deg)', offset: 0.35 },
  { transform: 'scale(1)' },
];

/** A score that slams when it changes. Mounting with a score doesn't count as a change. */
function ScoreValue({ score, size }: { score: number; size: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useRef(score);
  useEffect(() => {
    if (score !== seen.current && !prefersReducedMotion()) {
      ref.current?.animate(SCORE_SLAM, { duration: 600, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    }
    seen.current = score;
  }, [score]);
  return (
    <div
      ref={ref}
      className={`font-pixel leading-none pixel-drop ${score < 0 ? 'text-neon-pink' : 'text-bulb'}`}
      style={{ fontSize: size }}
    >
      {formatMoney(score)}
    </div>
  );
}

function ScoreStrip({ snapshot }: { snapshot: Snapshot }) {
  const { players, controlPlayerId, current } = snapshot;
  if (players.length === 0) return <div style={{ height: STRIP_H }} />;
  const crowded = players.length > 6;
  // Press Start 2P is monospaced at 1em per glyph, so size scores to fit the narrowest chip.
  const chipWidth = (STAGE_W - 64 - (players.length - 1) * STRIP_GAP) / players.length;
  const longest = Math.max(5, ...players.map((p) => formatMoney(p.score).length));
  const scoreSize = Math.min(34, Math.floor((chipWidth - 20) / longest));
  return (
    <div
      className="flex shrink-0 bg-studio-deep/80 px-8 py-5"
      style={{ gap: STRIP_GAP, height: STRIP_H }}
    >
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
            <ScoreValue score={player.score} size={scoreSize} />
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

const COUNTDOWN_BLOCKS = 20;

/** A row of pixel blocks that go out one by one as the server deadline approaches. */
function PixelCountdown({
  snapshot,
  offset,
  totalMs,
}: {
  snapshot: Snapshot;
  offset: number;
  totalMs: number;
}) {
  const remaining = useRemaining(snapshot.deadline, offset, snapshot.remainingMs);
  if (remaining === null) return null;
  const lit = Math.ceil(Math.min(1, Math.max(0, remaining / totalMs)) * COUNTDOWN_BLOCKS);
  const urgent = lit <= COUNTDOWN_BLOCKS * 0.3;
  return (
    <div className="flex gap-2">
      {Array.from({ length: COUNTDOWN_BLOCKS }, (_, i) => (
        <span
          key={i}
          className={`h-8 w-10 ${i < lit ? (urgent ? 'bg-neon-pink' : 'bg-bulb') : 'bg-white/10'}`}
        />
      ))}
    </div>
  );
}

/** Clue text in VT323, which reads smaller than most fonts at the same size. */
function clueTextSize(text: string): number {
  const length = text.length;
  if (length < 50) return 140;
  if (length < 100) return 120;
  if (length < 170) return 100;
  if (length < 260) return 84;
  if (length < 400) return 66;
  return 52;
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
          <MarqueeTitle text="Jeopardy Pocket Edition" className="text-[60px]" />
          {snapshot.board ? (
            <div className="font-crt text-[48px] uppercase text-neon-cyan chroma-text-sm">
              {snapshot.board.title}
            </div>
          ) : (
            <div className="font-crt text-[48px] uppercase text-white/60">
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
              <div className="font-crt text-[48px] uppercase tracking-[0.3em] text-white/70">
                Room code
              </div>
              <div className="font-pixel text-[168px] leading-none text-bulb chroma-text">
                {snapshot.code}
              </div>
              <div className="flex items-center gap-10">
                <QrCode value={joinUrl} />
                <div className="flex flex-col gap-3 font-crt text-[48px] uppercase leading-tight">
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
            <h2 className="flex items-baseline justify-between font-crt text-[48px] uppercase tracking-[0.2em] text-white/80">
              <span>Contestants</span>
              <span className="text-bulb">
                {snapshot.players.length}/{MAX_PLAYERS}
              </span>
            </h2>
            {snapshot.players.length === 0 ? (
              <div className="flex flex-1 items-center justify-center font-crt text-[60px] uppercase text-white/50">
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

function tileKey(categoryIndex: number, clueIndex: number): string {
  return `${categoryIndex}-${clueIndex}`;
}

/** Where each tile last sat on the board, in stage pixels, so a clue can zoom out of its tile. */
const tileRects = new Map<string, Rect>();

function BoardScreen({ snapshot }: { snapshot: Snapshot }) {
  const roundKey = `${snapshot.code}:${snapshot.board?.roundIndex ?? 0}`;
  const [fillIn] = useState(() => !filledRounds.has(roundKey));
  useEffect(() => {
    filledRounds.add(roundKey);
  }, [roundKey]);

  return (
    <Studio>
      <div className="flex h-full flex-col">
        <BoardView snapshot={snapshot} fillIn={fillIn} />
        <ScoreStrip snapshot={snapshot} />
      </div>
    </Studio>
  );
}

/** The round name, who's up next, and the grid of tiles. Fills the space above the score strip. */
function BoardView({ snapshot, fillIn }: { snapshot: Snapshot; fillIn: boolean }) {
  const grid = snapshot.grid ?? [];
  const rows = grid[0]?.cells.length ?? 0;
  const controller = snapshot.players.find((p) => p.id === snapshot.controlPlayerId);
  const gridRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    gridRef.current?.querySelectorAll<HTMLElement>('[data-tile]').forEach((tile) => {
      tileRects.set(tile.dataset.tile ?? '', stageRect(tile));
    });
  });

  // Press Start 2P is monospaced at 1em per glyph, so size values to fit the column.
  const columnWidth = (STAGE_W - 2 * BOARD_PAD_X - (grid.length - 1) * BOARD_GAP) / grid.length;
  const longest = Math.max(
    1,
    ...grid.flatMap((category) => category.cells.map((cell) => formatMoney(cell.value).length)),
  );
  const valueSize = Math.min(64, Math.floor((columnWidth - 40) / longest));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
        ref={gridRef}
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
                data-tile={tileKey(c, r)}
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
    </div>
  );
}

/** The spotlights land on the big Daily Double title. */
const DAILY_DOUBLE_SPOT: Point = { x: STAGE_W / 2, y: 320 };

function DailyDoubleScreen({ snapshot }: { snapshot: Snapshot }) {
  const current = snapshot.current;
  const player = playerName(snapshot, snapshot.controlPlayerId);
  return (
    <Studio spotlight={DAILY_DOUBLE_SPOT}>
      <div className="flex h-full flex-col">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-10 text-center">
          <div className="slam-in flex flex-col items-center gap-6 font-pixel text-[150px] uppercase leading-none text-bulb chroma-text">
            <span>Daily</span>
            <span>Double</span>
          </div>
          <div className="font-crt text-[64px] uppercase tracking-[0.15em] text-neon-cyan chroma-text-sm">
            {current?.category}
          </div>
          <div className="flex items-baseline gap-5 font-crt text-[56px] uppercase text-white/80">
            <span className="font-pixel text-[44px] text-bulb">{player}</span>
            <span>
              is placing a wager
              <BlinkingCursor />
            </span>
          </div>
          {current?.wagerLimits ? (
            <div className="font-crt text-[44px] uppercase text-white/60">
              {formatMoney(current.wagerLimits.min)} to {formatMoney(current.wagerLimits.max)}
            </div>
          ) : null}
        </div>
        <ScoreStrip snapshot={snapshot} />
      </div>
    </Studio>
  );
}

const ZOOM_MS = 550;
const CARD_INSET_X = 32;
const CARD_TOP = 36;
const CARD_BOTTOM = 28;
const STATUS_H = 200;

/** Where the spotlights land when someone is answering: the middle of the card's status line. */
const STATUS_SPOT: Point = {
  x: STAGE_W / 2,
  y: STAGE_H - STRIP_H - CARD_BOTTOM - STATUS_H / 2,
};

const SHAKE: Keyframe[] = [
  { transform: 'translate(0, 0)' },
  { transform: 'translate(-16px, 6px)' },
  { transform: 'translate(14px, -6px)' },
  { transform: 'translate(-9px, 4px)' },
  { transform: 'translate(5px, -2px)' },
  { transform: 'translate(0, 0)' },
];

function ClueScreen({ snapshot, offset }: { snapshot: Snapshot; offset: number }) {
  const current = snapshot.current;
  if (!current) return null;
  return <ClueCard snapshot={snapshot} current={current} offset={offset} />;
}

/**
 * The clue on a big blue card. When a clue has just been picked, the card zooms out of its tile
 * while the board fades away behind it.
 */
function ClueCard({
  snapshot,
  current,
  offset,
}: {
  snapshot: Snapshot;
  current: CurrentClueView;
  offset: number;
}) {
  const { phase, result } = snapshot;
  const { categoryIndex, clueIndex } = current;
  const cardRef = useRef<HTMLDivElement>(null);

  // Only zoom straight off the board, not when the display joins mid-clue.
  const [zoom] = useState(
    () =>
      phase === 'clue' &&
      tileRects.has(tileKey(categoryIndex, clueIndex)) &&
      !prefersReducedMotion(),
  );
  const [ghostBoard, setGhostBoard] = useState(zoom);

  useLayoutEffect(() => {
    const card = cardRef.current;
    const tile = tileRects.get(tileKey(categoryIndex, clueIndex));
    if (!zoom || !card || !tile) return;
    const to = stageRect(card);
    const animation = card.animate(
      [
        {
          transform: `translate(${tile.x - to.x}px, ${tile.y - to.y}px) scale(${
            tile.width / to.width
          }, ${tile.height / to.height})`,
        },
        { transform: 'none' },
      ],
      { duration: ZOOM_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
    animation.finished.then(
      () => setGhostBoard(false),
      () => undefined,
    );
    return () => animation.cancel();
  }, [zoom, categoryIndex, clueIndex]);

  // A wrong answer shakes the card and stamps a red X on it.
  const missKey =
    result?.outcome === 'incorrect'
      ? `${tileKey(categoryIndex, clueIndex)}:${result.playerId}`
      : null;
  const [missOnMount] = useState(missKey);
  const seenMiss = useRef(missKey);
  useEffect(() => {
    if (missKey && missKey !== seenMiss.current && !prefersReducedMotion()) {
      cardRef.current?.animate(SHAKE, { duration: 450, easing: 'ease-out' });
    }
    seenMiss.current = missKey;
  }, [missKey]);
  const stampMiss = missKey !== null && missKey !== missOnMount && !prefersReducedMotion();

  const clueText = current.clue ?? '';
  const spotlight = phase === 'answering' || phase === 'dailyDoubleClue' ? STATUS_SPOT : null;

  return (
    <Studio spotlight={spotlight}>
      <div className="flex h-full flex-col">
        <div className="relative min-h-0 flex-1">
          {ghostBoard ? (
            <div className="clue-ghost absolute inset-0 flex flex-col">
              <BoardView snapshot={snapshot} fillIn={false} />
            </div>
          ) : null}

          <div
            ref={cardRef}
            className="pixel-tile absolute origin-top-left"
            style={{ left: CARD_INSET_X, right: CARD_INSET_X, top: CARD_TOP, bottom: CARD_BOTTOM }}
          >
            <div className={`flex h-full flex-col ${zoom ? 'clue-content-in' : ''}`}>
              <header className="flex items-center justify-between px-12 pt-8">
                <div className="font-crt text-[56px] uppercase tracking-[0.15em] text-neon-cyan chroma-text-sm">
                  {current.category}
                </div>
                <div
                  className={`font-pixel text-[44px] uppercase pixel-drop ${
                    current.dailyDouble ? 'text-neon-pink' : 'text-bulb'
                  }`}
                >
                  {current.dailyDouble ? 'Daily Double' : formatMoney(current.value)}
                </div>
              </header>

              <div className="flex min-h-0 flex-1 items-center justify-center px-20 text-center">
                <p
                  className="font-crt uppercase leading-[1.05] text-white pixel-drop"
                  style={{ fontSize: clueTextSize(clueText) }}
                >
                  {clueText}
                </p>
              </div>

              <div
                className="flex shrink-0 flex-col items-center justify-center gap-4 px-20 text-center"
                style={{ height: STATUS_H }}
              >
                <ClueStatus snapshot={snapshot} current={current} offset={offset} />
              </div>
            </div>

            {stampMiss ? (
              <div
                key={missKey}
                className="x-stamp pointer-events-none absolute inset-0 flex items-center justify-center font-pixel text-[360px] leading-none text-buzz-out"
              >
                X
              </div>
            ) : null}
          </div>
        </div>

        <ScoreStrip snapshot={snapshot} />
      </div>
    </Studio>
  );
}

function ClueStatus({
  snapshot,
  current,
  offset,
}: {
  snapshot: Snapshot;
  current: CurrentClueView;
  offset: number;
}) {
  const { phase, result } = snapshot;
  const timeoutMs = snapshot.settings.buzzTimeoutMs;

  switch (phase) {
    case 'clue':
      return (
        <div className="font-crt text-[60px] uppercase text-white/60">
          Listen for the clue
          <BlinkingCursor />
        </div>
      );

    case 'buzzersOpen':
      return (
        <>
          {result?.outcome === 'incorrect' ? (
            <div className="font-crt text-[54px] uppercase leading-none text-neon-pink pixel-drop">
              {playerName(snapshot, result.playerId)} missed · {formatMoney(result.delta)}
            </div>
          ) : null}
          <div className="beat font-pixel text-[64px] uppercase leading-none text-buzz-open pixel-drop">
            Buzz in!
          </div>
          {timeoutMs !== null ? (
            <PixelCountdown snapshot={snapshot} offset={offset} totalMs={timeoutMs} />
          ) : null}
        </>
      );

    case 'answering':
      return (
        <div className="slam-in gold-pulse bg-studio-deep px-10 py-5 font-pixel text-[72px] uppercase leading-none text-bulb">
          {playerName(snapshot, current.buzzedPlayerId)}
        </div>
      );

    case 'dailyDoubleClue':
      return (
        <div className="flex items-baseline gap-5 font-crt text-[60px] uppercase text-white/80">
          <span className="font-pixel text-[44px] text-bulb">
            {playerName(snapshot, snapshot.controlPlayerId)}
          </span>
          wagered
          <span className="font-pixel text-[44px] text-bulb">
            {current.wager === null ? '' : formatMoney(current.wager)}
          </span>
        </div>
      );

    case 'reveal': {
      const answer = current.answer ?? '';
      const answerSize = answer.length > 90 ? 50 : answer.length > 40 ? 68 : 96;
      return (
        <>
          <div
            className="slam-in font-crt uppercase leading-none text-bulb chroma-text-sm"
            style={{ fontSize: answerSize }}
          >
            {answer}
          </div>
          {result?.outcome === 'correct' ? (
            <div className="font-crt text-[54px] uppercase leading-none text-buzz-open pixel-drop">
              {playerName(snapshot, result.playerId)} is right · +{formatMoney(result.delta)}
            </div>
          ) : null}
          {result?.outcome === 'incorrect' ? (
            <div className="font-crt text-[54px] uppercase leading-none text-neon-pink pixel-drop">
              {playerName(snapshot, result.playerId)} missed · {formatMoney(result.delta)}
            </div>
          ) : null}
          {result?.outcome === 'timeout' ? (
            <div className="font-crt text-[54px] uppercase leading-none text-white/70 pixel-drop">
              Time's up
            </div>
          ) : null}
        </>
      );
    }

    default:
      return null;
  }
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
  const champion = winner ? standings[0] : undefined;

  return (
    <Studio audience={winner} spotlight={champion ? WINNER_SPOT : null}>
      {/* With the audience in, the bottom 200px stays clear for it. */}
      <div className={`flex h-full flex-col gap-8 px-24 pt-14 ${winner ? 'pb-[200px]' : 'pb-14'}`}>
        <MarqueeTitle text={title} className="text-center text-[64px]" />
        {champion ? (
          <div className="slam-in gold-pulse mx-auto flex items-baseline gap-6 bg-studio-deep px-10 py-5">
            <span className="font-pixel text-[48px] uppercase leading-none text-bulb">
              {champion.name}
            </span>
            <span className="font-crt text-[56px] uppercase leading-none">wins!</span>
          </div>
        ) : null}
        <div
          className={`flex min-h-0 flex-1 flex-col justify-center ${crowded ? 'gap-2' : 'gap-4'}`}
        >
          {standings.map((player, index) => (
            <div key={player.id} className="flex items-center gap-6">
              <div className="w-20 text-right font-pixel text-[36px] text-white/60">
                {index + 1}
              </div>
              <div
                className={`w-[420px] truncate font-crt uppercase leading-none ${
                  crowded ? 'text-[44px]' : 'text-[56px]'
                }`}
              >
                {player.name}
              </div>
              <div className="flex-1">
                <div
                  className={`pixel-bar ${index === 0 && winner ? 'text-bulb' : 'text-royal-light'} ${
                    crowded ? 'h-8' : 'h-12'
                  }`}
                  style={{
                    width: `${Math.max(2, (Math.max(0, player.score) / max) * 100)}%`,
                    animationDelay: `${index * 70}ms`,
                  }}
                />
              </div>
              <div
                className={`w-[320px] text-right font-pixel leading-none pixel-drop ${
                  crowded ? 'text-[32px]' : 'text-[40px]'
                } ${player.score < 0 ? 'text-neon-pink' : 'text-bulb'}`}
              >
                {formatMoney(player.score)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Studio>
  );
}

/** The spotlights land on the winner's name at the end of the game. */
const WINNER_SPOT: Point = { x: STAGE_W / 2, y: 210 };

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
    <div className="flex flex-wrap justify-center gap-6">
      {ids.map((id) => {
        const player = players.find((p) => p.id === id);
        if (!player) return null;
        const ready = done.includes(id);
        return (
          <div
            key={id}
            className={`flex items-center gap-4 px-7 py-3 font-crt text-[44px] uppercase leading-none transition-colors pixel-frame ${
              ready ? 'bg-buzz-open text-white' : 'bg-royal-used text-white/60'
            }`}
          >
            <span className={`h-4 w-4 ${ready ? 'bg-bulb' : 'bg-white/15'}`} />
            {player.name}
          </div>
        );
      })}
    </div>
  );
}

/** The spotlights land on the Final Jeopardy category while players wager. */
const FINAL_CATEGORY_SPOT: Point = { x: STAGE_W / 2, y: 500 };
/** And on each answer as the host reveals it. */
const FINAL_ANSWER_SPOT: Point = { x: STAGE_W / 2, y: 470 };

function revealSize(answer: string): number {
  if (answer.length > 60) return 56;
  if (answer.length > 30) return 72;
  return 96;
}

function FinalScreen({ snapshot, offset }: { snapshot: Snapshot; offset: number }) {
  const final = snapshot.final;
  if (!final) return null;

  if (snapshot.phase === 'finalWager') {
    return (
      <Studio spotlight={FINAL_CATEGORY_SPOT}>
        <div className="flex h-full flex-col items-center justify-center gap-12 px-24 text-center">
          <MarqueeTitle text="Final Jeopardy" className="text-[88px]" />
          <div className="slam-in pixel-tile px-16 py-10 font-crt text-[96px] uppercase leading-none pixel-drop">
            {final.category}
          </div>
          <div className="font-crt text-[56px] uppercase text-white/70">
            Place your wagers
            <BlinkingCursor />
          </div>
          <PlayerChips players={snapshot.players} ids={final.eligible} done={final.wagered} />
        </div>
      </Studio>
    );
  }

  if (snapshot.phase === 'finalAnswer') {
    const clueText = final.clue ?? '';
    return (
      <Studio>
        <div className="flex h-full flex-col gap-8 px-8 pb-10 pt-9">
          <div className="pixel-tile flex min-h-0 flex-1 flex-col">
            <header className="flex items-center justify-between px-12 pt-8">
              <div className="font-crt text-[56px] uppercase tracking-[0.15em] text-neon-cyan chroma-text-sm">
                {final.category}
              </div>
              <div className="font-pixel text-[44px] uppercase text-bulb pixel-drop">Final</div>
            </header>
            <div className="flex min-h-0 flex-1 items-center justify-center px-20 text-center">
              <p
                className="font-crt uppercase leading-[1.05] pixel-drop"
                style={{ fontSize: Math.min(clueTextSize(clueText), 120) }}
              >
                {clueText}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center justify-center gap-10">
            <Countdown
              snapshot={snapshot}
              offset={offset}
              className="w-[220px] text-right font-pixel text-[96px] leading-none text-bulb pixel-drop"
            />
            <PixelCountdown snapshot={snapshot} offset={offset} totalMs={FINAL_ANSWER_MS} />
          </div>
          <PlayerChips players={snapshot.players} ids={final.eligible} done={final.answered} />
        </div>
      </Studio>
    );
  }

  // finalReveal
  const current = final.reveals.find((r) => r.playerId === final.currentRevealId);
  const waiting = final.order.filter((id) => !final.reveals.some((r) => r.playerId === id));
  const answer = current ? current.answer || '(no answer)' : '';
  return (
    <Studio spotlight={current ? FINAL_ANSWER_SPOT : null}>
      <div className="flex h-full flex-col">
        <div className="flex min-h-0 flex-1 flex-col items-center gap-8 px-24 pt-12 text-center">
          <div className="font-crt text-[60px] uppercase tracking-[0.15em] text-neon-cyan chroma-text-sm">
            {final.category}
          </div>
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8">
            {current ? (
              <>
                <div className="flex items-baseline gap-5 font-crt text-[56px] uppercase text-white/70">
                  <span className="font-pixel text-[44px] text-bulb">
                    {playerName(snapshot, current.playerId)}
                  </span>
                  answered
                </div>
                <div
                  key={current.playerId}
                  className="slam-in pixel-tile max-w-[1600px] px-14 py-8 font-crt uppercase leading-none pixel-drop"
                  style={{ fontSize: revealSize(answer) }}
                >
                  {answer}
                </div>
                {current.correct !== null ? (
                  <div
                    key={`${current.playerId}-judged`}
                    className={`slam-in font-pixel text-[56px] uppercase leading-none pixel-drop ${
                      current.correct ? 'text-buzz-open' : 'text-neon-pink'
                    }`}
                  >
                    {current.correct ? 'Correct' : 'Incorrect'} · {current.correct ? '+' : '-'}
                    {formatMoney(current.wager ?? 0)}
                  </div>
                ) : (
                  <div className="font-crt text-[48px] uppercase text-white/50">
                    Judging
                    <BlinkingCursor />
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-baseline gap-5 font-crt text-[60px] uppercase text-white/70">
                {waiting.length > 0 ? (
                  <>
                    Up first:
                    <span className="font-pixel text-[48px] text-bulb">
                      {playerName(snapshot, waiting[0])}
                    </span>
                  </>
                ) : (
                  'All answers are in'
                )}
              </div>
            )}
            {final.answer ? (
              <div className="font-crt text-[48px] uppercase text-white/70">
                Correct response: <span className="text-bulb">{final.answer}</span>
              </div>
            ) : null}
          </div>
        </div>
        <ScoreStrip snapshot={snapshot} />
      </div>
    </Studio>
  );
}
