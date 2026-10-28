import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { BuzzerState, Snapshot } from '@jeopardy/shared';
import { FINAL_ANSWER_MAX_LENGTH, FINAL_ANSWER_MS } from '@jeopardy/shared';
import {
  Countdown,
  CountdownBar,
  HomeLink,
  ReconnectingBanner,
  RoomGate,
  ScreenMessage,
  Toast,
  playerName,
} from '../components/common';
import { Standings } from '../components/Standings';
import { formatMoney } from '../lib/format';
import { clearSession } from '../lib/session';
import { request } from '../lib/socket';
import { useAction } from '../lib/useAction';
import { useRoom } from '../lib/useRoom';
import { useWakeLock } from '../lib/useWakeLock';

export function Play({ code }: { code: string }) {
  const room = useRoom(code, 'player');
  // Phones sleep mid-game otherwise. Requested again whenever the page becomes visible.
  useWakeLock(true);

  return (
    <RoomGate room={room}>
      {(snapshot) =>
        snapshot.you ? (
          <PlayerScreen snapshot={snapshot} offset={room.offset} connected={room.connected} />
        ) : (
          <Removed code={code} />
        )
      }
    </RoomGate>
  );
}

function Removed({ code }: { code: string }) {
  useEffect(() => clearSession(code, 'player'), [code]);
  return (
    <ScreenMessage title="You were removed" action={<HomeLink />}>
      The host removed you from room {code}.
    </ScreenMessage>
  );
}

function statusLine(snapshot: Snapshot): string {
  const you = snapshot.you;
  const inControl = you?.id === snapshot.controlPlayerId;
  const controller = playerName(snapshot, snapshot.controlPlayerId);
  const buzzed = playerName(snapshot, snapshot.current?.buzzedPlayerId);
  const result = snapshot.result;

  switch (snapshot.phase) {
    case 'lobby':
      return 'Waiting for the host to start the game';
    case 'board':
      return inControl
        ? "You're in control. Call out a clue!"
        : `${controller} picks the next clue`;
    case 'clue':
      return 'Get ready…';
    case 'buzzersOpen':
      return 'Buzz in!';
    case 'answering':
      return you?.id === snapshot.current?.buzzedPlayerId
        ? 'Answer out loud!'
        : `${buzzed} is answering`;
    case 'reveal': {
      if (!result) return 'Here is the answer';
      const who = playerName(snapshot, result.playerId);
      if (result.outcome === 'correct') return `${who} got it! ${formatMoney(result.delta)}`;
      if (result.outcome === 'incorrect') return `${who} missed. ${formatMoney(result.delta)}`;
      return result.outcome === 'timeout' ? "Time's up" : 'Clue skipped';
    }
    case 'dailyDoubleWager':
      return inControl ? 'Daily Double! Place your wager' : `${controller} is wagering`;
    case 'dailyDoubleClue':
      return inControl ? 'Answer out loud!' : `${controller} is answering`;
    case 'roundEnd':
      return 'End of the round';
    case 'finalWager':
      return 'Final Jeopardy';
    case 'finalAnswer':
      return 'Final Jeopardy';
    case 'finalReveal':
      return 'The host is revealing answers';
    case 'gameOver':
      return 'Game over';
  }
}

function PlayerScreen({
  snapshot,
  offset,
  connected,
}: {
  snapshot: Snapshot;
  offset: number;
  connected: boolean;
}) {
  const { run, error } = useAction();
  const you = snapshot.you;
  if (!you) return null;

  const showBuzzer = ['clue', 'buzzersOpen', 'answering'].includes(snapshot.phase);

  return (
    <div className="flex h-dvh flex-col">
      <Toast message={error} />
      <ReconnectingBanner connected={connected} />
      <header className="flex items-center justify-between gap-3 border-b-[3px] border-[#1c2a70] bg-studio-deep/90 px-4 pb-3 pt-4">
        <div className="min-w-0">
          <div className="truncate text-3xl uppercase leading-none">{you.name}</div>
          <div className="text-base uppercase tracking-widest text-white/50">
            Room {snapshot.code}
          </div>
        </div>
        <div
          className={`shrink-0 font-pixel text-xl pixel-drop-sm ${you.score < 0 ? 'text-neon-pink' : 'text-bulb'}`}
        >
          {formatMoney(you.score)}
        </div>
      </header>

      {snapshot.frozen ? (
        <div className="bg-bulb px-4 py-1.5 text-center text-xl uppercase text-studio-deep">
          {snapshot.hostConnected ? 'Game paused' : 'Waiting for the host to reconnect…'}
        </div>
      ) : null}

      <p className="px-4 py-4 text-center text-3xl uppercase leading-tight">
        {statusLine(snapshot)}
      </p>

      <main className="flex min-h-0 flex-1 flex-col px-4 pb-6">
        {showBuzzer ? (
          <Buzzer snapshot={snapshot} offset={offset} />
        ) : snapshot.phase === 'dailyDoubleWager' && snapshot.controlPlayerId === you.id ? (
          <WagerForm
            title="Daily Double"
            limits={snapshot.current?.wagerLimits ?? null}
            current={null}
            onSubmit={(amount) => run('player:wager', { amount })}
          />
        ) : snapshot.phase === 'finalWager' ? (
          <FinalWager snapshot={snapshot} onWager={(amount) => run('player:wager', { amount })} />
        ) : snapshot.phase === 'finalAnswer' ? (
          <FinalAnswer
            snapshot={snapshot}
            offset={offset}
            onSubmit={(text) => run('player:finalAnswer', { text })}
          />
        ) : (
          <div className="overflow-y-auto">
            {snapshot.phase === 'finalReveal' || snapshot.phase === 'gameOver' ? (
              <FinalSummary snapshot={snapshot} />
            ) : null}
            <Standings
              players={snapshot.players}
              highlightId={you.id}
              controlId={snapshot.controlPlayerId}
            />
          </div>
        )}
      </main>
    </div>
  );
}

const BUZZER_LOOK: Record<BuzzerState, { label: string; className: string }> = {
  locked: { label: 'WAIT', className: 'bg-buzz-locked text-white/70' },
  open: { label: 'BUZZ!', className: 'bg-buzz-open buzz-ready text-white' },
  in: { label: "YOU'RE IN!", className: 'bg-bulb buzz-won text-studio-deep' },
  lockedOut: { label: 'LOCKED OUT', className: 'bg-buzz-out text-white' },
};

function Buzzer({ snapshot, offset }: { snapshot: Snapshot; offset: number }) {
  const state = snapshot.you?.buzz ?? 'locked';
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const press = async () => {
    // Haptic feedback on the press itself, so it feels instant even before the server answers.
    navigator.vibrate?.(40);
    const result = await request('player:buzz', {});
    let message: string | null = null;
    if (!result.ok) message = result.error === 'Not connected' ? 'No connection' : result.error;
    else if (result.result === 'late') message = 'TOO LATE';
    else if (result.result === 'locked') message = 'LOCKED OUT';
    else if (result.result === 'won') navigator.vibrate?.([30, 40, 90]);
    if (message) {
      setFlash(message);
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), 900);
    }
  };

  // pointerdown, not click: click waits for the finger to lift, which costs tens of milliseconds.
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    void press();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.repeat || (event.key !== ' ' && event.key !== 'Enter')) return;
    event.preventDefault();
    void press();
  };

  const look = BUZZER_LOOK[state];
  const current = snapshot.current;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {current ? (
        <div className="text-center text-xl uppercase tracking-widest text-neon-cyan">
          {current.category} · {formatMoney(current.value)}
        </div>
      ) : null}
      <button
        type="button"
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => event.preventDefault()}
        className={`tap-target buzzer mb-3 flex flex-1 select-none flex-col items-center justify-center px-4 text-center font-pixel text-[clamp(26px,9vw,48px)] uppercase leading-tight ${look.className}`}
        aria-label="Buzzer"
      >
        <span>{flash ?? look.label}</span>
        {state === 'open' && snapshot.deadline !== null ? (
          <span className="mt-4 font-pixel text-xl opacity-80">
            <Countdown snapshot={snapshot} offset={offset} />
          </span>
        ) : null}
      </button>
    </div>
  );
}

function WagerForm({
  title,
  limits,
  current,
  onSubmit,
}: {
  title: string;
  limits: { min: number; max: number } | null;
  current: number | null;
  onSubmit: (amount: number) => Promise<unknown>;
}) {
  const [value, setValue] = useState(current === null ? '' : String(current));
  const [busy, setBusy] = useState(false);

  if (!limits) return <p className="text-center text-xl text-white/70">No wager needed.</p>;

  const amount = Number(value);
  const valid =
    value.trim() !== '' && Number.isInteger(amount) && amount >= limits.min && amount <= limits.max;
  const half = Math.max(limits.min, Math.floor(limits.max / 2));

  return (
    <form
      className="card flex flex-col gap-5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!valid) return;
        setBusy(true);
        await onSubmit(amount);
        setBusy(false);
      }}
    >
      <h2 className="text-center font-pixel text-xl uppercase leading-snug text-bulb chroma-text-sm">
        {title}
      </h2>
      <p className="text-center text-xl text-white/70">
        Wager between {formatMoney(limits.min)} and {formatMoney(limits.max)}
      </p>
      <input
        className="field py-4 text-center font-pixel text-3xl"
        type="number"
        inputMode="numeric"
        min={limits.min}
        max={limits.max}
        step={1}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="0"
        aria-label="Wager amount"
      />
      <div className="grid grid-cols-3 gap-3">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setValue(String(limits.min))}
        >
          Min
        </button>
        <button type="button" className="btn-secondary" onClick={() => setValue(String(half))}>
          Half
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setValue(String(limits.max))}
        >
          Max
        </button>
      </div>
      <button type="submit" className="btn-primary text-2xl" disabled={!valid || busy}>
        {current === null ? 'Lock in wager' : 'Update wager'}
      </button>
      {current !== null ? (
        <p className="text-center text-xl text-white/70">Wager locked in: {formatMoney(current)}</p>
      ) : null}
    </form>
  );
}

function FinalWager({
  snapshot,
  onWager,
}: {
  snapshot: Snapshot;
  onWager: (amount: number) => Promise<unknown>;
}) {
  const final = snapshot.final;
  if (!final) return null;
  return (
    <div className="flex flex-col gap-4">
      <div className="card text-center">
        <div className="text-base uppercase tracking-widest text-white/60">
          Final Jeopardy category
        </div>
        <div className="mt-1 font-display text-3xl uppercase text-gold">{final.category}</div>
      </div>
      {final.wagerLimits ? (
        <WagerForm
          title="Your wager"
          limits={final.wagerLimits}
          current={final.yourWager}
          onSubmit={onWager}
        />
      ) : (
        <p className="card text-center text-xl text-white/80">
          Only players with a positive score play Final Jeopardy. Sit tight and watch!
        </p>
      )}
    </div>
  );
}

function FinalAnswer({
  snapshot,
  offset,
  onSubmit,
}: {
  snapshot: Snapshot;
  offset: number;
  onSubmit: (text: string) => Promise<unknown>;
}) {
  const final = snapshot.final;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  if (!final) return null;

  const eligible = final.eligible.includes(snapshot.you?.id ?? '');
  const submitted = final.yourAnswer;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="card text-center">
        <div className="text-2xl uppercase text-bulb">{final.category}</div>
        <p className="mt-2 text-2xl uppercase leading-tight">{final.clue}</p>
      </div>
      <div className="flex items-center gap-3">
        <CountdownBar snapshot={snapshot} offset={offset} totalMs={FINAL_ANSWER_MS} />
        <Countdown
          snapshot={snapshot}
          offset={offset}
          className="w-12 shrink-0 text-right font-pixel text-lg text-bulb"
        />
      </div>
      {!eligible ? (
        <p className="card text-center text-xl text-white/80">You're watching this one.</p>
      ) : submitted !== null ? (
        <div className="card flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <div className="text-xl uppercase tracking-widest text-buzz-open">Answer locked in</div>
          <p className="text-3xl uppercase leading-tight">{submitted}</p>
        </div>
      ) : (
        <form
          className="flex min-h-0 flex-1 flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!text.trim()) return;
            setBusy(true);
            await onSubmit(text);
            setBusy(false);
          }}
        >
          <textarea
            className="field min-h-0 flex-1 resize-none text-2xl"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={FINAL_ANSWER_MAX_LENGTH}
            placeholder="What is…?"
            aria-label="Your Final Jeopardy answer"
            autoFocus
          />
          <button type="submit" className="btn-primary text-2xl" disabled={busy || !text.trim()}>
            Submit answer
          </button>
        </form>
      )}
    </div>
  );
}

function FinalSummary({ snapshot }: { snapshot: Snapshot }) {
  const final = snapshot.final;
  if (!final || final.reveals.length === 0) return null;
  return (
    <div className="mb-5 flex flex-col gap-4">
      {final.reveals.map((reveal) => (
        <div key={reveal.playerId} className="card">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xl uppercase">{playerName(snapshot, reveal.playerId)}</span>
            {reveal.correct === null ? null : (
              <span className={`text-xl ${reveal.correct ? 'text-buzz-open' : 'text-neon-pink'}`}>
                {reveal.correct ? '+' : '-'}
                {formatMoney(reveal.wager ?? 0)}
              </span>
            )}
          </div>
          <p className="text-xl uppercase">{reveal.answer || '(no answer)'}</p>
        </div>
      ))}
      {final.answer ? (
        <p className="text-center text-xl text-white/70">
          Correct response: <span className="text-bulb">{final.answer}</span>
        </p>
      ) : null}
    </div>
  );
}
