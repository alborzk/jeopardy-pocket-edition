// Room codes are 4 uppercase letters, excluding I and O (easy to confuse with 1 and 0).
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const ROOM_CODE_REGEX = /^[A-HJ-NP-Z]{4}$/;

export const MAX_PLAYERS = 12;
export const NAME_MAX_LENGTH = 16;

/** A room is deleted this long after its last client disconnects. */
export const ROOM_TTL_MS = 30 * 60 * 1000;

/** A player who buzzes before buzzers open stays locked out this long after they open. */
export const EARLY_BUZZ_LOCKOUT_MS = 250;

/** Default time nobody has buzzed before the clue is revealed. */
export const DEFAULT_BUZZ_TIMEOUT_MS = 5000;
export const MIN_BUZZ_TIMEOUT_MS = 1000;
export const MAX_BUZZ_TIMEOUT_MS = 60_000;

export const FINAL_ANSWER_MS = 30_000;
export const FINAL_ANSWER_MAX_LENGTH = 200;

export const DAILY_DOUBLE_MIN_WAGER = 5;

/** Number of past game states kept per room for the host's undo button. */
export const UNDO_LIMIT = 20;

/** Rounds are 1 or 2: Jeopardy and Double Jeopardy. */
export const MAX_ROUNDS = 2;
export const MAX_CATEGORIES_PER_ROUND = 8;
export const MAX_CLUES_PER_CATEGORY = 10;
export const MAX_CLUE_VALUE = 100_000;
export const MAX_CLUE_TEXT = 1000;
export const MAX_ANSWER_TEXT = 500;
export const MAX_LABEL_TEXT = 80;

/** Default board shape and per-round value step (round 1 is 200-1000, round 2 is 400-2000). */
export const DEFAULT_CATEGORIES = 6;
export const DEFAULT_CLUES = 5;
export const ROUND_VALUE_STEP = [200, 400] as const;

export const MAX_SCORE_ADJUST = 1_000_000;
