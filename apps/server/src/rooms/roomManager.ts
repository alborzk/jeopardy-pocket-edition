import { randomBytes, randomInt } from 'node:crypto';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ROOM_TTL_MS } from '@jeopardy/shared';
import type { Ack, BuzzResult, Role, Snapshot } from '@jeopardy/shared';
import { applyAction, createRoomGame, undo } from '../game/history';
import type { RoomGame } from '../game/history';
import { evaluateBuzz } from '../game/reducer';
import type { Action } from '../game/types';
import { viewFor } from '../game/view';

/** One connected socket, as far as the room manager is concerned. */
export interface Client {
  id: string;
  emit(snapshot: Snapshot): void;
  disconnect(): void;
}

/** The actions only the host may send. */
export type HostAction = Extract<
  Action,
  {
    type:
      | 'loadBoard'
      | 'setSettings'
      | 'start'
      | 'selectClue'
      | 'openBuzzers'
      | 'judge'
      | 'continue'
      | 'skipClue'
      | 'adjustScore'
      | 'pause'
      | 'resume'
      | 'endGame'
      | 'finalReveal'
      | 'finalJudge';
  }
>;

interface Conn {
  client: Client;
  role: Role;
  playerId: string | null;
}

interface Room {
  code: string;
  game: RoomGame;
  hostToken: string;
  /** token -> playerId */
  playerTokens: Map<string, string>;
  conns: Map<string, Conn>;
  deadlineTimer: NodeJS.Timeout | null;
  lockTimer: NodeJS.Timeout | null;
  cleanupTimer: NodeJS.Timeout | null;
}

export interface RoomManagerOptions {
  /** How long an empty room is kept. */
  ttlMs?: number;
  maxRooms?: number;
}

const fail = (error: string) => ({ ok: false as const, error });
const success = <T extends object>(extra: T) => ({ ok: true as const, ...extra });

const newPlayerId = () => randomBytes(8).toString('hex');
const newToken = () => randomBytes(24).toString('base64url');

/**
 * Owns rooms, sockets and timers. Game rules live in the pure reducer: for each event this runs
 * the reducer, schedules or clears timers, then broadcasts a role-filtered snapshot to everyone.
 */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private roomByClient = new Map<string, Room>();
  private ttlMs: number;
  private maxRooms: number;

  constructor(options: RoomManagerOptions = {}) {
    this.ttlMs = options.ttlMs ?? ROOM_TTL_MS;
    this.maxRooms = options.maxRooms ?? 500;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  /** For tests and diagnostics. */
  getGame(code: string): RoomGame | undefined {
    return this.rooms.get(code)?.game;
  }

  // -------------------------------------------------------------------------------------------
  // Joining and leaving
  // -------------------------------------------------------------------------------------------

  createRoom(client: Client): Ack<{ code: string; hostToken: string }> {
    if (this.rooms.size >= this.maxRooms) return fail('The server is full. Try again later.');
    const room: Room = {
      code: this.newCode(),
      game: createRoomGame(),
      hostToken: newToken(),
      playerTokens: new Map(),
      conns: new Map(),
      deadlineTimer: null,
      lockTimer: null,
      cleanupTimer: null,
    };
    this.rooms.set(room.code, room);
    this.attach(room, client, 'host', null);
    this.dispatch(room, { type: 'hostConnection', connected: true });
    return success({ code: room.code, hostToken: room.hostToken });
  }

  join(client: Client, code: string, name: string): Ack<{ playerId: string; token: string }> {
    const room = this.rooms.get(code);
    if (!room) return fail('No room with that code');

    const playerId = newPlayerId();
    const attempt = applyAction(room.game, { type: 'playerJoined', playerId, name }, Date.now());
    if (!attempt.result.ok) return fail(attempt.result.error);

    const token = newToken();
    room.game = attempt.game;
    room.playerTokens.set(token, playerId);
    this.attach(room, client, 'player', playerId);
    this.afterChange(room);
    return success({ playerId, token });
  }

  /** Reconnection is a core feature: phones lock and drop sockets constantly. */
  rejoin(client: Client, code: string, token: string): Ack<{ role: Role; playerId?: string }> {
    const room = this.rooms.get(code);
    if (!room) return fail('That room no longer exists');

    if (token === room.hostToken) {
      this.attach(room, client, 'host', null);
      this.dispatch(room, { type: 'hostConnection', connected: true });
      return success({ role: 'host' as const });
    }

    const playerId = room.playerTokens.get(token);
    if (!playerId || !room.game.state.players.some((p) => p.id === playerId)) {
      return fail('You were removed from this room');
    }
    this.attach(room, client, 'player', playerId);
    this.dispatch(room, { type: 'playerConnection', playerId, connected: true });
    return success({ role: 'player' as const, playerId });
  }

  displayJoin(client: Client, code: string): Ack {
    const room = this.rooms.get(code);
    if (!room) return fail('No room with that code');
    const conn = this.attach(room, client, 'display', null);
    this.sendTo(room, conn);
    return success({});
  }

  disconnect(clientId: string): void {
    const room = this.roomByClient.get(clientId);
    if (!room) return;
    const conn = room.conns.get(clientId);
    this.detach(room, clientId);
    if (!conn) return;

    if (conn.role === 'host' && !this.hasConn(room, (c) => c.role === 'host')) {
      this.dispatch(room, { type: 'hostConnection', connected: false });
    } else if (
      conn.role === 'player' &&
      conn.playerId &&
      !this.hasConn(room, (c) => c.playerId === conn.playerId)
    ) {
      this.dispatch(room, { type: 'playerConnection', playerId: conn.playerId, connected: false });
    }
    if (room.conns.size === 0) this.scheduleCleanup(room);
  }

  // -------------------------------------------------------------------------------------------
  // Host actions
  // -------------------------------------------------------------------------------------------

  hostAction(clientId: string, action: HostAction): Ack {
    const found = this.find(clientId, 'host');
    if (!found.ok) return found;
    const { room } = found;

    let next: Action = action;
    if (action.type === 'start' && !action.firstControlPlayerId) {
      const players = room.game.state.players;
      const first = players[randomInt(players.length || 1)];
      next = { type: 'start', firstControlPlayerId: first?.id };
    }
    return this.dispatch(room, next);
  }

  undo(clientId: string): Ack {
    const found = this.find(clientId, 'host');
    if (!found.ok) return found;
    const result = undo(found.room.game, Date.now());
    if (!result.ok) return fail(result.error);
    found.room.game = result.game;
    this.afterChange(found.room);
    return success({});
  }

  kick(clientId: string, playerId: string): Ack {
    const found = this.find(clientId, 'host');
    if (!found.ok) return found;
    const { room } = found;

    const result = this.dispatch(room, { type: 'kick', playerId });
    if (!result.ok) return result;

    for (const [token, id] of room.playerTokens) {
      if (id === playerId) room.playerTokens.delete(token);
    }
    // The broadcast above already told them they were removed (their snapshot has no "you").
    for (const conn of [...room.conns.values()]) {
      if (conn.playerId !== playerId) continue;
      this.detach(room, conn.client.id);
      conn.client.disconnect();
    }
    return success({});
  }

  // -------------------------------------------------------------------------------------------
  // Player actions
  // -------------------------------------------------------------------------------------------

  buzz(clientId: string): Ack<{ result: BuzzResult }> {
    const found = this.findPlayer(clientId);
    if (!found.ok) return found;
    const { room, playerId } = found;

    // The server decides by the order it receives buzzes. Client timestamps are never used.
    const now = Date.now();
    const result = evaluateBuzz(room.game.state, playerId, now);
    this.dispatch(room, { type: 'buzz', playerId }, now);
    return success({ result });
  }

  wager(clientId: string, amount: number): Ack {
    const found = this.findPlayer(clientId);
    if (!found.ok) return found;
    return this.dispatch(found.room, { type: 'wager', playerId: found.playerId, amount });
  }

  finalAnswer(clientId: string, text: string): Ack {
    const found = this.findPlayer(clientId);
    if (!found.ok) return found;
    return this.dispatch(found.room, { type: 'finalAnswer', playerId: found.playerId, text });
  }

  /** Stop every timer. Used when shutting down. */
  shutdown(): void {
    for (const room of [...this.rooms.values()]) this.deleteRoom(room);
  }

  // -------------------------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------------------------

  private newCode(): string {
    for (let attempt = 0; attempt < 1000; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Could not find a free room code');
  }

  private find(
    clientId: string,
    role: Role,
  ): { ok: true; room: Room; conn: Conn } | { ok: false; error: string } {
    const room = this.roomByClient.get(clientId);
    const conn = room?.conns.get(clientId);
    if (!room || !conn) return fail('You are not in a room');
    if (conn.role !== role) {
      return fail(role === 'host' ? 'Only the host can do that' : 'Only players can do that');
    }
    return { ok: true, room, conn };
  }

  private findPlayer(
    clientId: string,
  ): { ok: true; room: Room; playerId: string } | { ok: false; error: string } {
    const found = this.find(clientId, 'player');
    if (!found.ok) return found;
    if (!found.conn.playerId) return fail('You are not a player');
    return { ok: true, room: found.room, playerId: found.conn.playerId };
  }

  private hasConn(room: Room, test: (conn: Conn) => boolean): boolean {
    for (const conn of room.conns.values()) if (test(conn)) return true;
    return false;
  }

  private attach(room: Room, client: Client, role: Role, playerId: string | null): Conn {
    // A socket belongs to one room at a time. Re-attaching to the same room is harmless.
    const previous = this.roomByClient.get(client.id);
    if (previous && previous !== room) this.disconnect(client.id);

    const conn: Conn = { client, role, playerId };
    room.conns.set(client.id, conn);
    this.roomByClient.set(client.id, room);
    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
    }
    return conn;
  }

  private detach(room: Room, clientId: string): void {
    room.conns.delete(clientId);
    this.roomByClient.delete(clientId);
  }

  private dispatch(room: Room, action: Action, now = Date.now()): Ack {
    const { game, result } = applyAction(room.game, action, now);
    if (!result.ok) return fail(result.error);
    const changed = game.state !== room.game.state;
    room.game = game;
    if (changed) this.afterChange(room);
    return success({});
  }

  private afterChange(room: Room): void {
    this.syncTimers(room);
    this.broadcast(room);
  }

  private broadcast(room: Room): void {
    for (const conn of room.conns.values()) this.sendTo(room, conn);
  }

  private sendTo(room: Room, conn: Conn): void {
    const snapshot = viewFor(room.game.state, conn.role, conn.playerId, {
      code: room.code,
      now: Date.now(),
      canUndo: room.game.past.length > 0,
    });
    try {
      conn.client.emit(snapshot);
    } catch (error) {
      console.error(`Failed to send a snapshot to ${conn.client.id}`, error);
    }
  }

  /** Server timers enforce the deadlines stored in state. Clients render countdowns from them. */
  private syncTimers(room: Room): void {
    if (room.deadlineTimer) clearTimeout(room.deadlineTimer);
    room.deadlineTimer = null;
    if (room.lockTimer) clearTimeout(room.lockTimer);
    room.lockTimer = null;

    const state = room.game.state;
    if (state.deadline !== null) {
      const delay = Math.max(0, state.deadline - Date.now());
      room.deadlineTimer = setTimeout(() => this.onDeadline(room), delay);
      room.deadlineTimer.unref();
    }

    // Early buzzers stay red for 250ms after the buzzers open. Nothing else changes when that
    // ends, so push one more snapshot to turn their buzzer green.
    if (state.phase === 'buzzersOpen') {
      const lockedUntil = Math.max(0, ...Object.values(state.earlyLockUntil));
      const delay = lockedUntil - Date.now();
      if (delay > 0) {
        room.lockTimer = setTimeout(() => {
          room.lockTimer = null;
          this.broadcast(room);
        }, delay + 5);
        room.lockTimer.unref();
      }
    }
  }

  private onDeadline(room: Room): void {
    room.deadlineTimer = null;
    if (this.rooms.get(room.code) !== room) return;
    this.dispatch(room, { type: 'timeout' });
    // A timer that fires a hair early is refused by the reducer: arm it again.
    this.syncTimers(room);
  }

  private scheduleCleanup(room: Room): void {
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    room.cleanupTimer = setTimeout(() => this.deleteRoom(room), this.ttlMs);
    room.cleanupTimer.unref();
  }

  private deleteRoom(room: Room): void {
    for (const timer of [room.deadlineTimer, room.lockTimer, room.cleanupTimer]) {
      if (timer) clearTimeout(timer);
    }
    room.deadlineTimer = room.lockTimer = room.cleanupTimer = null;
    for (const clientId of room.conns.keys()) this.roomByClient.delete(clientId);
    room.conns.clear();
    this.rooms.delete(room.code);
  }
}
