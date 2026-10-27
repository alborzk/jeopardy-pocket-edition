import { z } from 'zod';
import { boardSchema } from './board';
import {
  FINAL_ANSWER_MAX_LENGTH,
  MAX_BUZZ_TIMEOUT_MS,
  MAX_SCORE_ADJUST,
  MIN_BUZZ_TIMEOUT_MS,
  NAME_MAX_LENGTH,
  ROOM_CODE_REGEX,
} from './constants';
import type { BuzzResult, Role, Snapshot } from './state';

// Case-insensitive on input: "abcd" and "ABCD" are the same room.
const roomCode = z.string().trim().toUpperCase().regex(ROOM_CODE_REGEX, 'Invalid room code');
const playerName = z
  .string()
  .trim()
  .min(1, 'Enter a name')
  .max(NAME_MAX_LENGTH, `Names are at most ${NAME_MAX_LENGTH} characters`);
const playerId = z.string().min(1).max(64);
const empty = z.object({});

/** zod schema for the payload of every client -> server event. The server parses all of them. */
export const eventSchemas = {
  'room:create': empty,
  'room:join': z.object({ code: roomCode, name: playerName }),
  'room:rejoin': z.object({ code: roomCode, token: z.string().min(1).max(128) }),
  'display:join': z.object({ code: roomCode }),

  'host:loadBoard': z.object({ board: boardSchema }),
  'host:start': empty,
  'host:selectClue': z.object({
    categoryIndex: z.number().int().min(0).max(100),
    clueIndex: z.number().int().min(0).max(100),
  }),
  'host:openBuzzers': empty,
  'host:judge': z.object({ correct: z.boolean() }),
  'host:continue': empty,
  'host:skipClue': empty,
  'host:adjustScore': z.object({
    playerId,
    delta: z.number().int().min(-MAX_SCORE_ADJUST).max(MAX_SCORE_ADJUST),
  }),
  'host:undo': empty,
  'host:kick': z.object({ playerId }),
  'host:pause': empty,
  'host:resume': empty,
  'host:endGame': empty,
  'host:setSettings': z.object({
    buzzTimeoutMs: z
      .number()
      .int()
      .min(MIN_BUZZ_TIMEOUT_MS)
      .max(MAX_BUZZ_TIMEOUT_MS)
      .nullable()
      .optional(),
    finalIncludeAll: z.boolean().optional(),
  }),
  'host:finalReveal': z.object({ playerId }),
  'host:finalJudge': z.object({ playerId, correct: z.boolean() }),

  'player:buzz': empty,
  'player:wager': z.object({ amount: z.number().int().min(0).max(1_000_000_000) }),
  'player:finalAnswer': z.object({ text: z.string().trim().min(1).max(FINAL_ANSWER_MAX_LENGTH) }),
} as const;

export type EventName = keyof typeof eventSchemas;

/** What a client sends (before zod transforms such as upper-casing the room code). */
export type EventInput<K extends EventName> = z.input<(typeof eventSchemas)[K]>;
/** What a handler receives after zod has parsed the payload. */
export type EventData<K extends EventName> = z.output<(typeof eventSchemas)[K]>;

type NoResult = object;

/** Extra fields an ack carries on success. */
export interface EventResults {
  'room:create': { code: string; hostToken: string };
  'room:join': { playerId: string; token: string };
  'room:rejoin': { role: Role; playerId?: string };
  'display:join': NoResult;
  'host:loadBoard': NoResult;
  'host:start': NoResult;
  'host:selectClue': NoResult;
  'host:openBuzzers': NoResult;
  'host:judge': NoResult;
  'host:continue': NoResult;
  'host:skipClue': NoResult;
  'host:adjustScore': NoResult;
  'host:undo': NoResult;
  'host:kick': NoResult;
  'host:pause': NoResult;
  'host:resume': NoResult;
  'host:endGame': NoResult;
  'host:setSettings': NoResult;
  'host:finalReveal': NoResult;
  'host:finalJudge': NoResult;
  'player:buzz': { result: BuzzResult };
  'player:wager': NoResult;
  'player:finalAnswer': NoResult;
}

export type Ack<T = NoResult> = ({ ok: true } & T) | { ok: false; error: string };

export type ClientToServerEvents = {
  [K in EventName]: (payload: EventInput<K>, ack: (response: Ack<EventResults[K]>) => void) => void;
};

export interface ServerToClientEvents {
  /** The full role-filtered snapshot, sent after every change. */
  state: (snapshot: Snapshot) => void;
}
