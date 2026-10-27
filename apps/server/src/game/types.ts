import type { Board, Phase, ResultView, Settings } from '@jeopardy/shared';

export interface Player {
  id: string;
  name: string;
  score: number;
  connected: boolean;
}

export interface FinalState {
  /** Players taking part in Final Jeopardy. */
  eligible: string[];
  wagers: Record<string, number>;
  answers: Record<string, string>;
  /** Reveal order, lowest score first. Set when the reveal phase starts. */
  order: string[];
  /** Players whose answer the host has revealed, in the order revealed. */
  revealed: string[];
  /** Players the host has judged: true is correct. */
  judged: Record<string, boolean>;
  currentRevealId: string | null;
}

/** Everything about a game. Plain JSON, never mutated: the reducer returns new objects. */
export interface GameState {
  phase: Phase;
  /** The host pressed pause. */
  paused: boolean;
  hostConnected: boolean;
  /** Time left on the active timer while the game is frozen (paused or host away). */
  frozenRemainingMs: number | null;
  /** Epoch ms when the active timer ends. null when there is no timer, or while frozen. */
  deadline: number | null;
  settings: Settings;
  board: Board | null;
  players: Player[];
  roundIndex: number;
  /** used[category][clue] for the current round. */
  used: boolean[][];
  controlPlayerId: string | null;
  current: { categoryIndex: number; clueIndex: number } | null;
  buzzedPlayerId: string | null;
  /** Players judged incorrect on the current clue. */
  lockedOut: string[];
  /** Players who buzzed before the buzzers opened. */
  earlyBuzzers: string[];
  /** playerId -> epoch ms until which an early buzzer stays locked out. */
  earlyLockUntil: Record<string, number>;
  /** Daily Double wager once placed. */
  wager: number | null;
  result: ResultView | null;
  final: FinalState | null;
}

export type Action =
  | { type: 'playerJoined'; playerId: string; name: string }
  | { type: 'playerConnection'; playerId: string; connected: boolean }
  | { type: 'hostConnection'; connected: boolean }
  | { type: 'kick'; playerId: string }
  | { type: 'loadBoard'; board: Board }
  | { type: 'setSettings'; settings: Partial<Settings> }
  | { type: 'start'; firstControlPlayerId?: string }
  | { type: 'selectClue'; categoryIndex: number; clueIndex: number }
  | { type: 'openBuzzers' }
  | { type: 'buzz'; playerId: string }
  | { type: 'judge'; correct: boolean }
  | { type: 'continue' }
  | { type: 'skipClue' }
  | { type: 'adjustScore'; playerId: string; delta: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'endGame' }
  | { type: 'wager'; playerId: string; amount: number }
  | { type: 'finalAnswer'; playerId: string; text: string }
  | { type: 'finalReveal'; playerId: string }
  | { type: 'finalJudge'; playerId: string; correct: boolean }
  | { type: 'timeout' };

export type StepResult = { ok: true; state: GameState } | { ok: false; error: string };
