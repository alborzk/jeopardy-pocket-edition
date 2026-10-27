// Role-filtered snapshots the server sends to clients. Clients render these as-is and never
// compute scores or phases themselves.

export type Role = 'host' | 'display' | 'player';

export type Phase =
  | 'lobby'
  | 'board'
  | 'clue'
  | 'buzzersOpen'
  | 'answering'
  | 'reveal'
  | 'dailyDoubleWager'
  | 'dailyDoubleClue'
  | 'roundEnd'
  | 'finalWager'
  | 'finalAnswer'
  | 'finalReveal'
  | 'gameOver';

export type BuzzResult = 'won' | 'late' | 'locked' | 'notOpen';

/** What a player's phone should look like: grey, green, gold or red. */
export type BuzzerState = 'locked' | 'open' | 'in' | 'lockedOut';

export interface Settings {
  /** Time nobody has buzzed before the clue is revealed. null turns the timeout off. */
  buzzTimeoutMs: number | null;
  /** Let players with a score of 0 or less take part in Final Jeopardy. */
  finalIncludeAll: boolean;
}

export interface PlayerView {
  id: string;
  name: string;
  score: number;
  connected: boolean;
}

export interface BoardInfo {
  title: string;
  roundIndex: number;
  roundCount: number;
  roundName: string;
}

export interface GridCell {
  value: number;
  used: boolean;
  /** Only sent to the host. */
  dailyDouble?: boolean;
}

export interface GridCategory {
  name: string;
  cells: GridCell[];
}

export interface CurrentClueView {
  categoryIndex: number;
  clueIndex: number;
  category: string;
  value: number;
  dailyDouble: boolean;
  /** Hidden from everyone but the host while a Daily Double wager is being placed. */
  clue: string | null;
  /** Host: always. Display and players: only after the reveal. */
  answer: string | null;
  buzzedPlayerId: string | null;
  lockedOut: string[];
  /** Daily Double wager once placed. */
  wager: number | null;
  /** Bounds for the Daily Double wager. */
  wagerLimits: { min: number; max: number } | null;
}

export interface ResultView {
  outcome: 'correct' | 'incorrect' | 'timeout' | 'skipped';
  playerId: string | null;
  delta: number;
}

export interface FinalRevealView {
  playerId: string;
  answer: string;
  /** Hidden from the display and players until the host has judged the answer. */
  wager: number | null;
  correct: boolean | null;
}

export interface FinalView {
  category: string;
  /** Shown from the moment the answer timer starts. */
  clue: string | null;
  /** The correct response. Host: always. Others: once the first answer is revealed. */
  answer: string | null;
  eligible: string[];
  /** Reveal order, lowest score first. Empty until the reveal phase. */
  order: string[];
  /** Who has placed a wager. Amounts stay private. */
  wagered: string[];
  /** Who has submitted an answer. Text stays private. */
  answered: string[];
  reveals: FinalRevealView[];
  currentRevealId: string | null;
  /** Bounds for the requesting player's wager. */
  wagerLimits: { min: number; max: number } | null;
  yourWager: number | null;
  yourAnswer: string | null;
  /** Host only. */
  wagers: Record<string, number> | null;
  /** Host only. */
  answers: Record<string, string> | null;
}

export interface YouView {
  id: string;
  name: string;
  score: number;
  buzz: BuzzerState;
}

export interface Snapshot {
  code: string;
  role: Role;
  /** Server clock at send time. Clients use it to correct for clock skew when rendering deadlines. */
  serverNow: number;
  phase: Phase;
  /** The host pressed pause. */
  paused: boolean;
  hostConnected: boolean;
  /** Timers are stopped: the host paused or the host is disconnected. */
  frozen: boolean;
  /** Time left on the active timer while frozen. */
  remainingMs: number | null;
  /** Epoch ms when the active timer ends. null when there is no timer or it is frozen. */
  deadline: number | null;
  settings: Settings;
  board: BoardInfo | null;
  /** The current round's grid. null in the lobby. */
  grid: GridCategory[] | null;
  players: PlayerView[];
  controlPlayerId: string | null;
  current: CurrentClueView | null;
  result: ResultView | null;
  final: FinalView | null;
  /** The requesting player. null for host and display, and for a player who was removed. */
  you: YouView | null;
  /** Host only. */
  canUndo: boolean;
}
