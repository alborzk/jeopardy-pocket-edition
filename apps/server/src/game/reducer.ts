import {
  DAILY_DOUBLE_MIN_WAGER,
  DEFAULT_BUZZ_TIMEOUT_MS,
  EARLY_BUZZ_LOCKOUT_MS,
  FINAL_ANSWER_MAX_LENGTH,
  FINAL_ANSWER_MS,
  MAX_BUZZ_TIMEOUT_MS,
  MAX_PLAYERS,
  MAX_SCORE_ADJUST,
  MIN_BUZZ_TIMEOUT_MS,
  NAME_MAX_LENGTH,
  topClueValue,
} from '@jeopardy/shared';
import type { BuzzResult, Clue, Round, Settings } from '@jeopardy/shared';
import type { Action, FinalState, GameState, Player, StepResult } from './types';

export const DEFAULT_SETTINGS: Settings = {
  buzzTimeoutMs: DEFAULT_BUZZ_TIMEOUT_MS,
  finalIncludeAll: false,
};

export function createGameState(): GameState {
  return {
    phase: 'lobby',
    paused: false,
    hostConnected: true,
    frozenRemainingMs: null,
    deadline: null,
    settings: { ...DEFAULT_SETTINGS },
    board: null,
    players: [],
    roundIndex: 0,
    used: [],
    controlPlayerId: null,
    current: null,
    buzzedPlayerId: null,
    lockedOut: [],
    earlyBuzzers: [],
    earlyLockUntil: {},
    wager: null,
    result: null,
    final: null,
  };
}

// ---------------------------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------------------------

export function isFrozen(state: GameState): boolean {
  return state.paused || !state.hostConnected;
}

export function currentRound(state: GameState): Round | null {
  return state.board?.rounds[state.roundIndex] ?? null;
}

export function currentClue(state: GameState): Clue | null {
  if (!state.current) return null;
  const { categoryIndex, clueIndex } = state.current;
  return currentRound(state)?.categories[categoryIndex]?.clues[clueIndex] ?? null;
}

export function findPlayer(state: GameState, id: string | null): Player | undefined {
  return id === null ? undefined : state.players.find((p) => p.id === id);
}

/** The player with the lowest score. Ties go to whoever joined first. */
export function lowestScorer(players: Player[]): Player | undefined {
  let lowest: Player | undefined;
  for (const player of players) {
    if (!lowest || player.score < lowest.score) lowest = player;
  }
  return lowest;
}

/** Daily Double wager bounds for the player in control: 5 up to max(score, top clue value). */
export function dailyDoubleLimits(state: GameState): { min: number; max: number } | null {
  const player = findPlayer(state, state.controlPlayerId);
  const round = currentRound(state);
  if (!player || !round) return null;
  const min = DAILY_DOUBLE_MIN_WAGER;
  return { min, max: Math.max(min, player.score, topClueValue(round)) };
}

/** Who may still buzz in on the current clue. */
function eligibleToBuzz(state: GameState): Player[] {
  return state.players.filter((p) => p.connected && !state.lockedOut.includes(p.id));
}

/**
 * What a buzz from this player would do right now. The server decides by the order it receives
 * buzzes, so there is no client timestamp in here.
 */
export function evaluateBuzz(state: GameState, playerId: string, now: number): BuzzResult {
  if (!findPlayer(state, playerId)) return 'locked';
  if (isFrozen(state)) return 'notOpen';
  if (state.phase !== 'buzzersOpen' && state.phase !== 'answering') return 'notOpen';
  if (state.buzzedPlayerId === playerId) return 'won';
  if (state.lockedOut.includes(playerId)) return 'locked';
  if ((state.earlyLockUntil[playerId] ?? 0) > now) return 'locked';
  return state.phase === 'buzzersOpen' ? 'won' : 'late';
}

// ---------------------------------------------------------------------------------------------
// Helpers that build new state
// ---------------------------------------------------------------------------------------------

/** Start (or clear) the active timer, respecting a frozen game. */
export function armTimer(state: GameState, durationMs: number | null, now: number): GameState {
  if (durationMs === null) return { ...state, deadline: null, frozenRemainingMs: null };
  if (isFrozen(state)) return { ...state, deadline: null, frozenRemainingMs: durationMs };
  return { ...state, deadline: now + durationMs, frozenRemainingMs: null };
}

/** Re-arm the timer for the current phase. Used after undo, when old deadlines are meaningless. */
export function rearmTimer(state: GameState, now: number): GameState {
  if (state.phase === 'buzzersOpen') return armTimer(state, state.settings.buzzTimeoutMs, now);
  if (state.phase === 'finalAnswer') return armTimer(state, FINAL_ANSWER_MS, now);
  return armTimer(state, null, now);
}

/** Freeze or unfreeze timers when pause or host presence changes. */
function applyFreeze(before: GameState, after: GameState, now: number): GameState {
  const wasFrozen = isFrozen(before);
  const nowFrozen = isFrozen(after);
  if (!wasFrozen && nowFrozen && after.deadline !== null) {
    return { ...after, deadline: null, frozenRemainingMs: Math.max(0, after.deadline - now) };
  }
  if (wasFrozen && !nowFrozen && after.frozenRemainingMs !== null) {
    return { ...after, deadline: now + after.frozenRemainingMs, frozenRemainingMs: null };
  }
  return after;
}

/** Forget everything about the clue that was just played. */
function clearClue(state: GameState): GameState {
  return {
    ...state,
    current: null,
    buzzedPlayerId: null,
    lockedOut: [],
    earlyBuzzers: [],
    earlyLockUntil: {},
    wager: null,
    deadline: null,
    frozenRemainingMs: null,
  };
}

function addScore(players: Player[], playerId: string, delta: number): Player[] {
  return players.map((p) => (p.id === playerId ? { ...p, score: p.score + delta } : p));
}

function beginRound(
  state: GameState,
  roundIndex: number,
  controlPlayerId: string | null,
): GameState {
  const round = state.board?.rounds[roundIndex];
  return {
    ...clearClue(state),
    phase: 'board',
    roundIndex,
    used: round ? round.categories.map((c) => c.clues.map(() => false)) : [],
    controlPlayerId,
    result: null,
    final: null,
  };
}

function startFinal(state: GameState): GameState {
  const eligible = state.players
    .filter((p) => state.settings.finalIncludeAll || p.score > 0)
    .map((p) => p.id);
  if (eligible.length === 0) return { ...clearClue(state), phase: 'gameOver' };
  const final: FinalState = {
    eligible,
    wagers: {},
    answers: {},
    order: [],
    revealed: [],
    judged: {},
    currentRevealId: null,
  };
  return { ...clearClue(state), phase: 'finalWager', final, result: null };
}

function toFinalReveal(state: GameState): GameState {
  const final = state.final;
  if (!final) return state;
  const position = new Map(state.players.map((p, i) => [p.id, i]));
  const score = new Map(state.players.map((p) => [p.id, p.score]));
  const order = [...final.eligible].sort(
    (a, b) =>
      (score.get(a) ?? 0) - (score.get(b) ?? 0) || (position.get(a) ?? 0) - (position.get(b) ?? 0),
  );
  return { ...clearClue(state), phase: 'finalReveal', final: { ...final, order } };
}

/** After a wrong answer: reopen the buzzers if anyone can still buzz, otherwise reveal. */
function reopenOrReveal(state: GameState, now: number): GameState {
  if (eligibleToBuzz(state).length > 0) {
    const reopened: GameState = {
      ...state,
      phase: 'buzzersOpen',
      buzzedPlayerId: null,
      earlyBuzzers: [],
      earlyLockUntil: {},
    };
    return armTimer(reopened, state.settings.buzzTimeoutMs, now);
  }
  return armTimer({ ...state, phase: 'reveal', buzzedPlayerId: null }, null, now);
}

function scrubFinal(final: FinalState, ids: Set<string>): FinalState {
  const keep = <T>(record: Record<string, T>) =>
    Object.fromEntries(Object.entries(record).filter(([id]) => ids.has(id)));
  return {
    eligible: final.eligible.filter((id) => ids.has(id)),
    wagers: keep(final.wagers),
    answers: keep(final.answers),
    order: final.order.filter((id) => ids.has(id)),
    revealed: final.revealed.filter((id) => ids.has(id)),
    judged: keep(final.judged),
    currentRevealId:
      final.currentRevealId !== null && ids.has(final.currentRevealId)
        ? final.currentRevealId
        : null,
  };
}

/**
 * Make every player reference valid again after players were removed (kick) or the roster
 * changed under a restored state (undo).
 */
export function scrub(state: GameState, now: number): GameState {
  const ids = new Set(state.players.map((p) => p.id));
  const has = (id: string | null): id is string => id !== null && ids.has(id);

  const isDailyDouble = state.phase === 'dailyDoubleWager' || state.phase === 'dailyDoubleClue';
  const dailyDoublePlayerGone = isDailyDouble && !has(state.controlPlayerId);

  let next: GameState = {
    ...state,
    controlPlayerId: has(state.controlPlayerId)
      ? state.controlPlayerId
      : (lowestScorer(state.players)?.id ?? null),
    lockedOut: state.lockedOut.filter(has),
    earlyBuzzers: state.earlyBuzzers.filter(has),
    earlyLockUntil: Object.fromEntries(
      Object.entries(state.earlyLockUntil).filter(([id]) => ids.has(id)),
    ),
    final: state.final ? scrubFinal(state.final, ids) : null,
  };

  if (dailyDoublePlayerGone) {
    return armTimer(
      {
        ...next,
        phase: 'reveal',
        wager: null,
        result: { outcome: 'skipped', playerId: null, delta: 0 },
      },
      null,
      now,
    );
  }

  if (!has(next.buzzedPlayerId)) {
    const wasAnswering = next.phase === 'answering';
    next = { ...next, buzzedPlayerId: null };
    if (wasAnswering) next = reopenOrReveal(next, now);
  }
  return next;
}

// ---------------------------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------------------------

const ok = (state: GameState): StepResult => ({ ok: true, state });
const fail = (error: string): StepResult => ({ ok: false, error });

/** Actions that still work while the game is paused or the host is away. */
const WORKS_WHILE_FROZEN = new Set<Action['type']>([
  'playerJoined',
  'playerConnection',
  'hostConnection',
  'kick',
  'adjustScore',
  'resume',
  'endGame',
]);

/**
 * Pure game logic: no sockets, timers or I/O. `now` is epoch ms. Returns either the next state
 * or a reason the action was refused. The state passed in is never mutated.
 */
export function tryReduce(state: GameState, action: Action, now: number): StepResult {
  if (isFrozen(state) && !WORKS_WHILE_FROZEN.has(action.type)) return fail('The game is paused');

  switch (action.type) {
    case 'playerJoined': {
      const name = action.name.trim();
      if (name.length < 1 || name.length > NAME_MAX_LENGTH) {
        return fail(`Names are 1-${NAME_MAX_LENGTH} characters`);
      }
      if (state.players.length >= MAX_PLAYERS) return fail('The room is full');
      if (state.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
        return fail('That name is already taken');
      }
      const player: Player = { id: action.playerId, name, score: 0, connected: true };
      return ok({ ...state, players: [...state.players, player] });
    }

    case 'playerConnection': {
      if (!findPlayer(state, action.playerId)) return fail('Unknown player');
      return ok({
        ...state,
        players: state.players.map((p) =>
          p.id === action.playerId ? { ...p, connected: action.connected } : p,
        ),
      });
    }

    case 'hostConnection': {
      return ok(applyFreeze(state, { ...state, hostConnected: action.connected }, now));
    }

    case 'kick': {
      if (!findPlayer(state, action.playerId)) return fail('Unknown player');
      const players = state.players.filter((p) => p.id !== action.playerId);
      return ok(scrub({ ...state, players }, now));
    }

    case 'loadBoard': {
      if (state.phase !== 'lobby') return fail('A board can only be loaded in the lobby');
      return ok({ ...state, board: action.board });
    }

    case 'setSettings': {
      const { buzzTimeoutMs, finalIncludeAll } = action.settings;
      if (
        buzzTimeoutMs !== undefined &&
        buzzTimeoutMs !== null &&
        (!Number.isInteger(buzzTimeoutMs) ||
          buzzTimeoutMs < MIN_BUZZ_TIMEOUT_MS ||
          buzzTimeoutMs > MAX_BUZZ_TIMEOUT_MS)
      ) {
        return fail('Invalid buzz timeout');
      }
      const settings: Settings = {
        buzzTimeoutMs: buzzTimeoutMs === undefined ? state.settings.buzzTimeoutMs : buzzTimeoutMs,
        finalIncludeAll: finalIncludeAll ?? state.settings.finalIncludeAll,
      };
      return ok({ ...state, settings });
    }

    case 'start': {
      if (state.phase !== 'lobby') return fail('The game has already started');
      if (!state.board) return fail('Load a board first');
      if (state.players.length === 0) return fail('At least one player has to join first');
      const first = findPlayer(state, action.firstControlPlayerId ?? null) ?? state.players[0];
      return ok(beginRound(state, 0, first?.id ?? null));
    }

    case 'selectClue': {
      if (state.phase !== 'board') return fail('Not time to pick a clue');
      const { categoryIndex, clueIndex } = action;
      const clue = currentRound(state)?.categories[categoryIndex]?.clues[clueIndex];
      if (!clue) return fail('No such clue');
      if (state.used[categoryIndex]?.[clueIndex]) return fail('That clue has already been played');

      const used = state.used.map((column, c) =>
        c === categoryIndex ? column.map((u, k) => (k === clueIndex ? true : u)) : column,
      );
      const base: GameState = {
        ...clearClue(state),
        used,
        current: { categoryIndex, clueIndex },
        result: null,
      };
      if (clue.dailyDouble) {
        const control = findPlayer(state, state.controlPlayerId) ?? lowestScorer(state.players);
        if (!control) return fail('There are no players');
        return ok({ ...base, phase: 'dailyDoubleWager', controlPlayerId: control.id });
      }
      return ok({ ...base, phase: 'clue' });
    }

    case 'openBuzzers': {
      if (state.phase !== 'clue') return fail('Buzzers can only open while a clue is showing');
      const earlyLockUntil = Object.fromEntries(
        state.earlyBuzzers.map((id) => [id, now + EARLY_BUZZ_LOCKOUT_MS]),
      );
      const open: GameState = { ...state, phase: 'buzzersOpen', earlyBuzzers: [], earlyLockUntil };
      return ok(armTimer(open, state.settings.buzzTimeoutMs, now));
    }

    case 'buzz': {
      if (!findPlayer(state, action.playerId)) return fail('Unknown player');
      const outcome = evaluateBuzz(state, action.playerId, now);
      if (outcome === 'won') {
        if (state.buzzedPlayerId === action.playerId) return ok(state);
        return ok(
          armTimer({ ...state, phase: 'answering', buzzedPlayerId: action.playerId }, null, now),
        );
      }
      // Jumping the gun: remembered, so the lockout can start when the buzzers open.
      if (state.phase === 'clue' && !state.earlyBuzzers.includes(action.playerId)) {
        return ok({ ...state, earlyBuzzers: [...state.earlyBuzzers, action.playerId] });
      }
      return ok(state);
    }

    case 'judge': {
      if (state.phase === 'answering') {
        const clue = currentClue(state);
        const playerId = state.buzzedPlayerId;
        if (!clue || playerId === null) return fail('Nobody is answering');
        const delta = action.correct ? clue.value : -clue.value;
        const players = addScore(state.players, playerId, delta);
        const result = {
          outcome: action.correct ? ('correct' as const) : ('incorrect' as const),
          playerId,
          delta,
        };
        if (action.correct) {
          return ok(
            armTimer(
              {
                ...state,
                players,
                result,
                phase: 'reveal',
                controlPlayerId: playerId,
                buzzedPlayerId: null,
              },
              null,
              now,
            ),
          );
        }
        return ok(
          reopenOrReveal(
            { ...state, players, result, lockedOut: [...state.lockedOut, playerId] },
            now,
          ),
        );
      }

      if (state.phase === 'dailyDoubleClue') {
        const playerId = state.controlPlayerId;
        if (playerId === null || state.wager === null) return fail('No wager has been placed');
        const delta = action.correct ? state.wager : -state.wager;
        return ok(
          armTimer(
            {
              ...state,
              players: addScore(state.players, playerId, delta),
              phase: 'reveal',
              result: { outcome: action.correct ? 'correct' : 'incorrect', playerId, delta },
            },
            null,
            now,
          ),
        );
      }
      return fail('There is nothing to judge right now');
    }

    case 'timeout': {
      if (state.deadline === null || now < state.deadline) return fail('The timer is not up yet');
      if (state.phase === 'buzzersOpen') {
        // Keep the "incorrect" banner if the buzzers reopened after a wrong answer.
        const result =
          state.result?.outcome === 'incorrect'
            ? state.result
            : { outcome: 'timeout' as const, playerId: null, delta: 0 };
        return ok(armTimer({ ...state, phase: 'reveal', result }, null, now));
      }
      if (state.phase === 'finalAnswer') return ok(toFinalReveal(state));
      return fail('Nothing is waiting on a timer');
    }

    case 'continue': {
      switch (state.phase) {
        case 'reveal': {
          const clueLeft = state.used.some((column) => column.some((used) => !used));
          return ok({ ...clearClue(state), phase: clueLeft ? 'board' : 'roundEnd', result: null });
        }
        case 'roundEnd': {
          const board = state.board;
          if (board && state.roundIndex + 1 < board.rounds.length) {
            return ok(
              beginRound(state, state.roundIndex + 1, lowestScorer(state.players)?.id ?? null),
            );
          }
          return ok(startFinal(state));
        }
        case 'finalWager':
          return ok(armTimer({ ...state, phase: 'finalAnswer' }, FINAL_ANSWER_MS, now));
        case 'finalAnswer':
          return ok(toFinalReveal(state));
        case 'finalReveal': {
          const final = state.final;
          if (final && final.eligible.some((id) => final.judged[id] === undefined)) {
            return fail('Reveal and judge every player first');
          }
          return ok({ ...state, phase: 'gameOver' });
        }
        default:
          return fail('There is nothing to continue from here');
      }
    }

    case 'skipClue': {
      const skippable = ['clue', 'buzzersOpen', 'answering', 'dailyDoubleWager', 'dailyDoubleClue'];
      if (!skippable.includes(state.phase)) return fail('There is no clue to skip');
      return ok(
        armTimer(
          {
            ...state,
            phase: 'reveal',
            buzzedPlayerId: null,
            result: { outcome: 'skipped', playerId: null, delta: 0 },
          },
          null,
          now,
        ),
      );
    }

    case 'adjustScore': {
      if (!findPlayer(state, action.playerId)) return fail('Unknown player');
      if (!Number.isInteger(action.delta) || Math.abs(action.delta) > MAX_SCORE_ADJUST) {
        return fail('Invalid score change');
      }
      return ok({ ...state, players: addScore(state.players, action.playerId, action.delta) });
    }

    case 'pause': {
      if (state.phase === 'lobby' || state.phase === 'gameOver') return fail('Nothing to pause');
      if (state.paused) return fail('The game is already paused');
      return ok(applyFreeze(state, { ...state, paused: true }, now));
    }

    case 'resume': {
      if (!state.paused) return fail('The game is not paused');
      return ok(applyFreeze(state, { ...state, paused: false }, now));
    }

    case 'endGame': {
      if (state.phase === 'gameOver') return fail('The game is already over');
      return ok(
        armTimer({ ...state, phase: 'gameOver', current: null, buzzedPlayerId: null }, null, now),
      );
    }

    case 'wager': {
      const player = findPlayer(state, action.playerId);
      if (!player) return fail('Unknown player');
      const { amount } = action;
      if (!Number.isInteger(amount)) return fail('Wagers are whole numbers');

      if (state.phase === 'dailyDoubleWager') {
        if (action.playerId !== state.controlPlayerId) {
          return fail('Only the player in control can wager');
        }
        const limits = dailyDoubleLimits(state);
        if (!limits) return fail('No wager is needed');
        if (amount < limits.min || amount > limits.max) {
          return fail(`Wager between ${limits.min} and ${limits.max}`);
        }
        return ok({ ...state, wager: amount, phase: 'dailyDoubleClue' });
      }

      if (state.phase === 'finalWager') {
        const final = state.final;
        if (!final || !final.eligible.includes(action.playerId)) {
          return fail('You are not in Final Jeepy!');
        }
        const max = Math.max(0, player.score);
        if (amount < 0 || amount > max) return fail(`Wager between 0 and ${max}`);
        return ok({
          ...state,
          final: { ...final, wagers: { ...final.wagers, [action.playerId]: amount } },
        });
      }
      return fail('It is not time to wager');
    }

    case 'finalAnswer': {
      const final = state.final;
      if (state.phase !== 'finalAnswer' || !final) return fail('It is not time to answer');
      if (!final.eligible.includes(action.playerId)) return fail('You are not in Final Jeepy!');
      if (state.deadline === null || now >= state.deadline) return fail('Time is up');
      if (final.answers[action.playerId] !== undefined)
        return fail('You already submitted an answer');
      const text = action.text.trim().slice(0, FINAL_ANSWER_MAX_LENGTH);
      if (text.length === 0) return fail('Enter an answer');
      return ok({
        ...state,
        final: { ...final, answers: { ...final.answers, [action.playerId]: text } },
      });
    }

    case 'finalReveal': {
      const final = state.final;
      if (state.phase !== 'finalReveal' || !final) return fail('It is not time to reveal answers');
      if (!final.eligible.includes(action.playerId))
        return fail('That player is not in Final Jeepy!');
      if (final.revealed.includes(action.playerId)) return fail('That answer was already revealed');
      if (final.currentRevealId !== null && final.judged[final.currentRevealId] === undefined) {
        return fail('Judge the current answer first');
      }
      return ok({
        ...state,
        final: {
          ...final,
          revealed: [...final.revealed, action.playerId],
          currentRevealId: action.playerId,
        },
      });
    }

    case 'finalJudge': {
      const final = state.final;
      if (state.phase !== 'finalReveal' || !final) return fail('It is not time to judge answers');
      if (final.currentRevealId !== action.playerId)
        return fail('That answer has not been revealed');
      if (final.judged[action.playerId] !== undefined)
        return fail('That answer was already judged');
      const wager = final.wagers[action.playerId] ?? 0;
      const delta = action.correct ? wager : -wager;
      return ok({
        ...state,
        players: addScore(state.players, action.playerId, delta),
        final: { ...final, judged: { ...final.judged, [action.playerId]: action.correct } },
      });
    }
  }
}

/** `reduce(state, action, now) -> state`. Refused actions return the state unchanged. */
export function reduce(state: GameState, action: Action, now: number): GameState {
  const result = tryReduce(state, action, now);
  return result.ok ? result.state : state;
}
