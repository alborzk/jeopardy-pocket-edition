import type {
  BuzzerState,
  CurrentClueView,
  FinalView,
  GridCategory,
  Role,
  Snapshot,
  YouView,
} from '@jeopardy/shared';
import { currentClue, currentRound, dailyDoubleLimits, findPlayer, isFrozen } from './reducer';
import type { GameState } from './types';

export interface ViewContext {
  code: string;
  now: number;
  /** Whether the room has anything to undo. */
  canUndo: boolean;
}

function buzzerFor(state: GameState, playerId: string, now: number): BuzzerState {
  if (state.phase === 'answering') {
    if (state.buzzedPlayerId === playerId) return 'in';
    return state.lockedOut.includes(playerId) ? 'lockedOut' : 'locked';
  }
  if (state.phase === 'buzzersOpen') {
    if (isFrozen(state)) return 'locked';
    if (state.lockedOut.includes(playerId)) return 'lockedOut';
    if ((state.earlyLockUntil[playerId] ?? 0) > now) return 'lockedOut';
    return 'open';
  }
  // Show red to someone who jumped the gun so they know it counted against them.
  if (state.phase === 'clue' && state.earlyBuzzers.includes(playerId)) return 'lockedOut';
  return 'locked';
}

function buildYou(state: GameState, playerId: string | null, now: number): YouView | null {
  const player = findPlayer(state, playerId);
  if (!player) return null;
  return {
    id: player.id,
    name: player.name,
    score: player.score,
    buzz: buzzerFor(state, player.id, now),
  };
}

function inFinalStretch(state: GameState): boolean {
  return ['finalWager', 'finalAnswer', 'finalReveal', 'gameOver'].includes(state.phase);
}

function buildGrid(state: GameState, isHost: boolean): GridCategory[] | null {
  const round = currentRound(state);
  if (!round || state.phase === 'lobby' || inFinalStretch(state)) return null;
  return round.categories.map((category, c) => ({
    name: category.name,
    cells: category.clues.map((clue, k) => ({
      value: clue.value,
      used: state.used[c]?.[k] ?? false,
      // Where the Daily Doubles hide is a secret from everyone but the host.
      ...(isHost ? { dailyDouble: clue.dailyDouble === true } : {}),
    })),
  }));
}

function buildCurrent(state: GameState, isHost: boolean): CurrentClueView | null {
  const clue = currentClue(state);
  const round = currentRound(state);
  if (!state.current || !clue || !round) return null;
  const { categoryIndex, clueIndex } = state.current;
  const revealed = state.phase === 'reveal';
  return {
    categoryIndex,
    clueIndex,
    category: round.categories[categoryIndex]?.name ?? '',
    value: clue.value,
    // A selected Daily Double has already been announced, so this is not a leak.
    dailyDouble: clue.dailyDouble === true,
    clue: state.phase === 'dailyDoubleWager' && !isHost ? null : clue.clue,
    answer: isHost || revealed ? clue.answer : null,
    buzzedPlayerId: state.buzzedPlayerId,
    lockedOut: state.lockedOut,
    wager: state.wager,
    wagerLimits: state.phase === 'dailyDoubleWager' ? dailyDoubleLimits(state) : null,
  };
}

function buildFinal(state: GameState, isHost: boolean, playerId: string | null): FinalView | null {
  const board = state.board;
  const final = state.final;
  if (!board || !final) return null;

  const started = ['finalAnswer', 'finalReveal', 'gameOver'].includes(state.phase);
  const player = findPlayer(state, playerId);
  const showCorrectAnswer = isHost || final.revealed.length > 0 || state.phase === 'gameOver';

  return {
    category: board.final.category,
    clue: isHost || started ? board.final.clue : null,
    answer: showCorrectAnswer ? board.final.answer : null,
    eligible: final.eligible,
    order: final.order,
    wagered: Object.keys(final.wagers),
    answered: Object.keys(final.answers),
    reveals: final.revealed.map((id) => {
      const judged = final.judged[id];
      return {
        playerId: id,
        answer: final.answers[id] ?? '',
        // The wager stays hidden until the host has judged the answer.
        wager: isHost || judged !== undefined ? (final.wagers[id] ?? 0) : null,
        correct: judged ?? null,
      };
    }),
    currentRevealId: final.currentRevealId,
    wagerLimits:
      player && state.phase === 'finalWager' && final.eligible.includes(player.id)
        ? { min: 0, max: Math.max(0, player.score) }
        : null,
    yourWager: player ? (final.wagers[player.id] ?? null) : null,
    yourAnswer: player ? (final.answers[player.id] ?? null) : null,
    wagers: isHost ? final.wagers : null,
    answers: isHost ? final.answers : null,
  };
}

/**
 * Build the snapshot one client is allowed to see. Display and players never get a clue's answer
 * before the reveal, nor another player's Final wager or answer before the host reveals it.
 * The host sees everything.
 */
export function viewFor(
  state: GameState,
  role: Role,
  playerId: string | null,
  ctx: ViewContext,
): Snapshot {
  const isHost = role === 'host';
  const frozen = isFrozen(state);
  const board = state.board;

  return {
    code: ctx.code,
    role,
    serverNow: ctx.now,
    phase: state.phase,
    paused: state.paused,
    hostConnected: state.hostConnected,
    frozen,
    remainingMs: frozen ? state.frozenRemainingMs : null,
    deadline: state.deadline,
    settings: state.settings,
    board: board
      ? {
          id: board.id,
          title: board.title,
          roundIndex: state.roundIndex,
          roundCount: board.rounds.length,
          roundName: board.rounds[state.roundIndex]?.name ?? '',
        }
      : null,
    grid: buildGrid(state, isHost),
    players: state.players.map(({ id, name, score, connected }) => ({
      id,
      name,
      score,
      connected,
    })),
    // Control only means something while clues are being picked.
    controlPlayerId: inFinalStretch(state) ? null : state.controlPlayerId,
    current: buildCurrent(state, isHost),
    result: state.result,
    final: buildFinal(state, isHost, role === 'player' ? playerId : null),
    you: role === 'player' ? buildYou(state, playerId, ctx.now) : null,
    canUndo: isHost && ctx.canUndo,
  };
}
