import { UNDO_LIMIT } from '@jeopardy/shared';
import { createGameState, rearmTimer, scrub, tryReduce } from './reducer';
import type { Action, GameState, StepResult } from './types';

/** A game plus the states that came before it, so the host can undo. */
export interface RoomGame {
  state: GameState;
  /** Oldest first. At most UNDO_LIMIT entries. */
  past: GameState[];
}

export function createRoomGame(): RoomGame {
  return { state: createGameState(), past: [] };
}

/** Host-visible steps that undo can take back. Joins, connection changes and wagers placed during Final are not steps. */
const RECORDED = new Set<Action['type']>([
  'start',
  'selectClue',
  'openBuzzers',
  'judge',
  'continue',
  'skipClue',
  'adjustScore',
  'endGame',
  'timeout',
  'finalReveal',
  'finalJudge',
]);

function shouldRecord(action: Action, before: GameState, after: GameState): boolean {
  if (before === after) return false;
  if (RECORDED.has(action.type)) return true;
  // A buzz or Daily Double wager only counts when it moves the game on.
  if (action.type === 'buzz' || action.type === 'wager') return before.phase !== after.phase;
  return false;
}

export function applyAction(
  game: RoomGame,
  action: Action,
  now: number,
): { game: RoomGame; result: StepResult } {
  const result = tryReduce(game.state, action, now);
  if (!result.ok) return { game, result };
  const past = shouldRecord(action, game.state, result.state)
    ? [...game.past, game.state].slice(-UNDO_LIMIT)
    : game.past;
  return { game: { state: result.state, past }, result };
}

/**
 * Go back one step. The roster is not rolled back: players who joined or were kicked since then
 * stay that way, and only scores revert. Settings and connection status are kept as they are.
 */
export function undo(
  game: RoomGame,
  now: number,
): { ok: true; game: RoomGame } | { ok: false; error: string } {
  const previous = game.past[game.past.length - 1];
  if (!previous) return { ok: false, error: 'Nothing to undo' };

  const current = game.state;
  const earlierScores = new Map(previous.players.map((p) => [p.id, p.score]));
  const players = current.players.map((p) => ({ ...p, score: earlierScores.get(p.id) ?? p.score }));

  let restored: GameState = {
    ...previous,
    players,
    settings: current.settings,
    paused: current.paused,
    hostConnected: current.hostConnected,
  };
  restored = scrub(restored, now);
  restored = rearmTimer(restored, now);
  return { ok: true, game: { state: restored, past: game.past.slice(0, -1) } };
}
