import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FINAL_ANSWER_MS, ROOM_TTL_MS } from '@jeopardy/shared';
import type { Snapshot } from '@jeopardy/shared';
import { testBoard } from '../game/test-utils';
import { RoomManager } from './roomManager';
import type { Client } from './roomManager';

class FakeClient implements Client {
  snapshots: Snapshot[] = [];
  disconnected = false;
  constructor(public id: string) {}
  emit(snapshot: Snapshot) {
    this.snapshots.push(snapshot);
  }
  disconnect() {
    this.disconnected = true;
  }
  get last(): Snapshot {
    const last = this.snapshots[this.snapshots.length - 1];
    if (!last) throw new Error(`${this.id} has not received a snapshot`);
    return last;
  }
}

function must<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`Expected success but got ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

let manager: RoomManager;
let nextId = 0;
const client = (name = 'c') => new FakeClient(`${name}${nextId++}`);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
  manager = new RoomManager();
});

afterEach(() => {
  manager.shutdown();
  vi.useRealTimers();
});

/** A room with a host, a display and the named players, with the test board loaded. */
function setup(names = ['Ann', 'Bo']) {
  const host = client('host');
  const created = must(manager.createRoom(host));
  const code = created.code;
  const display = client('display');
  must(manager.displayJoin(display, code));
  const players = names.map((name) => {
    const c = client(name);
    const joined = must(manager.join(c, code, name));
    return { name, client: c, ...joined };
  });
  must(manager.hostAction(host.id, { type: 'loadBoard', board: testBoard() }));
  return { host, display, code, hostToken: created.hostToken, players };
}

function startAndOpen(ctx: ReturnType<typeof setup>) {
  must(manager.hostAction(ctx.host.id, { type: 'start' }));
  must(manager.hostAction(ctx.host.id, { type: 'selectClue', categoryIndex: 1, clueIndex: 0 }));
  must(manager.hostAction(ctx.host.id, { type: 'openBuzzers' }));
}

describe('rooms', () => {
  it('creates rooms with 4 letter codes that never contain I or O', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const created = must(manager.createRoom(client()));
      expect(created.code).toMatch(/^[A-HJ-NP-Z]{4}$/);
      expect(created.hostToken.length).toBeGreaterThan(20);
      codes.add(created.code);
    }
    expect(codes.size).toBe(200);
  });

  it('gives the host a lobby snapshot straight away', () => {
    const host = client('host');
    must(manager.createRoom(host));
    expect(host.last).toMatchObject({ role: 'host', phase: 'lobby', players: [] });
  });

  it('lets players join and shows them to everyone', () => {
    const { host, display, code, players } = setup();
    expect(players[0]?.token).toBeTruthy();
    for (const c of [host, display, ...players.map((p) => p.client)]) {
      expect(c.last.players.map((p) => p.name)).toEqual(['Ann', 'Bo']);
    }
    expect(display.last.code).toBe(code);
    expect(players[0]?.client.last.you).toMatchObject({ name: 'Ann', score: 0 });
    expect(display.last.you).toBeNull();
  });

  it('refuses duplicate names, unknown rooms and a full room', () => {
    const { code } = setup(['Ann']);
    expect(manager.join(client(), code, 'ann')).toEqual({
      ok: false,
      error: 'That name is already taken',
    });
    expect(manager.join(client(), 'ZZZZ', 'Cy')).toEqual({
      ok: false,
      error: 'No room with that code',
    });
    for (let i = 0; i < 11; i++) must(manager.join(client(), code, `P${i}`));
    expect(manager.join(client(), code, 'Extra')).toEqual({ ok: false, error: 'The room is full' });
  });

  it('only lets the host send host actions, and only players buzz', () => {
    const ctx = setup();
    const ann = ctx.players[0]!;
    expect(manager.hostAction(ann.client.id, { type: 'start' })).toEqual({
      ok: false,
      error: 'Only the host can do that',
    });
    expect(manager.hostAction(ctx.display.id, { type: 'start' }).ok).toBe(false);
    expect(manager.undo(ann.client.id).ok).toBe(false);
    expect(manager.kick(ann.client.id, ctx.players[1]!.playerId).ok).toBe(false);
    expect(manager.buzz(ctx.host.id)).toEqual({ ok: false, error: 'Only players can do that' });
    expect(manager.buzz(ctx.display.id).ok).toBe(false);
    expect(manager.buzz('nobody')).toEqual({ ok: false, error: 'You are not in a room' });
  });

  it('picks the player who starts at random from the room', () => {
    const ctx = setup(['Ann', 'Bo', 'Cy']);
    must(manager.hostAction(ctx.host.id, { type: 'start' }));
    const control = ctx.host.last.controlPlayerId;
    expect(ctx.players.map((p) => p.playerId)).toContain(control);
  });
});

describe('reconnection', () => {
  it('keeps a disconnected player’s seat and score, and restores them on rejoin', () => {
    const ctx = setup();
    const ann = ctx.players[0]!;
    must(
      manager.hostAction(ctx.host.id, { type: 'adjustScore', playerId: ann.playerId, delta: 600 }),
    );

    manager.disconnect(ann.client.id);
    expect(ctx.host.last.players.find((p) => p.name === 'Ann')).toMatchObject({
      connected: false,
      score: 600,
    });
    expect(ctx.display.last.players.find((p) => p.name === 'Ann')?.connected).toBe(false);

    const phone = client('phone');
    const rejoined = must(manager.rejoin(phone, ctx.code, ann.token));
    expect(rejoined).toMatchObject({ role: 'player', playerId: ann.playerId });
    expect(phone.last.you).toMatchObject({ id: ann.playerId, name: 'Ann', score: 600 });
    expect(ctx.host.last.players.find((p) => p.name === 'Ann')?.connected).toBe(true);
  });

  it('restores lockouts after a rejoin', () => {
    const ctx = setup();
    startAndOpen(ctx);
    const [ann, bo] = ctx.players as [(typeof ctx.players)[0], (typeof ctx.players)[0]];
    vi.advanceTimersByTime(400);
    must(manager.buzz(ann.client.id));
    must(manager.hostAction(ctx.host.id, { type: 'judge', correct: false }));
    expect(ann.client.last.you?.buzz).toBe('lockedOut');

    manager.disconnect(ann.client.id);
    const phone = client('phone');
    must(manager.rejoin(phone, ctx.code, ann.token));
    expect(phone.last.you?.buzz).toBe('lockedOut');
    expect(bo.client.last.you?.buzz).toBe('open');
  });

  it('lets the host rejoin with the host token', () => {
    const ctx = setup();
    manager.disconnect(ctx.host.id);
    const laptop = client('laptop');
    expect(must(manager.rejoin(laptop, ctx.code, ctx.hostToken))).toMatchObject({ role: 'host' });
    expect(laptop.last.role).toBe('host');
  });

  it('rejects unknown tokens and rooms', () => {
    const ctx = setup();
    expect(manager.rejoin(client(), ctx.code, 'bogus').ok).toBe(false);
    expect(manager.rejoin(client(), 'ZZZZ', ctx.hostToken)).toEqual({
      ok: false,
      error: 'That room no longer exists',
    });
  });

  it('lets a display connect and reconnect without a token', () => {
    const ctx = setup();
    manager.disconnect(ctx.display.id);
    const tv = client('tv');
    must(manager.displayJoin(tv, ctx.code));
    expect(tv.last).toMatchObject({ role: 'display', phase: 'lobby' });
  });

  it('keeps a player connected while any of their sockets is still open', () => {
    const ctx = setup();
    const ann = ctx.players[0]!;
    const second = client('second');
    must(manager.rejoin(second, ctx.code, ann.token));
    manager.disconnect(ann.client.id);
    expect(ctx.host.last.players.find((p) => p.name === 'Ann')?.connected).toBe(true);
    manager.disconnect(second.id);
    expect(ctx.host.last.players.find((p) => p.name === 'Ann')?.connected).toBe(false);
  });
});

describe('host presence', () => {
  it('pauses timers while the host is away and resumes them on return', () => {
    const ctx = setup();
    startAndOpen(ctx);
    expect(ctx.display.last.phase).toBe('buzzersOpen');

    vi.advanceTimersByTime(2000);
    manager.disconnect(ctx.host.id);
    expect(ctx.display.last).toMatchObject({
      frozen: true,
      hostConnected: false,
      remainingMs: 3000,
    });

    vi.advanceTimersByTime(60_000);
    expect(ctx.display.last.phase).toBe('buzzersOpen');
    expect(manager.buzz(ctx.players[0]!.client.id)).toEqual({ ok: true, result: 'notOpen' });

    must(manager.rejoin(client('laptop'), ctx.code, ctx.hostToken));
    expect(ctx.display.last.frozen).toBe(false);
    vi.advanceTimersByTime(2999);
    expect(ctx.display.last.phase).toBe('buzzersOpen');
    vi.advanceTimersByTime(2);
    expect(ctx.display.last.phase).toBe('reveal');
  });

  it('pauses and resumes at the host’s request', () => {
    const ctx = setup();
    startAndOpen(ctx);
    must(manager.hostAction(ctx.host.id, { type: 'pause' }));
    vi.advanceTimersByTime(30_000);
    expect(ctx.display.last).toMatchObject({ paused: true, phase: 'buzzersOpen' });
    must(manager.hostAction(ctx.host.id, { type: 'resume' }));
    vi.advanceTimersByTime(5001);
    expect(ctx.display.last.phase).toBe('reveal');
  });
});

describe('buzzing', () => {
  it('answers won, late, locked and notOpen', () => {
    const ctx = setup(['Ann', 'Bo', 'Cy']);
    const [ann, bo, cy] = ctx.players as [
      (typeof ctx.players)[0],
      (typeof ctx.players)[0],
      (typeof ctx.players)[0],
    ];
    must(manager.hostAction(ctx.host.id, { type: 'start' }));
    expect(manager.buzz(ann.client.id)).toEqual({ ok: true, result: 'notOpen' });

    must(manager.hostAction(ctx.host.id, { type: 'selectClue', categoryIndex: 1, clueIndex: 0 }));
    expect(manager.buzz(ann.client.id)).toEqual({ ok: true, result: 'notOpen' });
    must(manager.hostAction(ctx.host.id, { type: 'openBuzzers' }));

    // Ann jumped the gun, so she is locked out for 250ms.
    expect(manager.buzz(ann.client.id)).toEqual({ ok: true, result: 'locked' });
    expect(ann.client.last.you?.buzz).toBe('lockedOut');
    vi.advanceTimersByTime(255);
    expect(ann.client.last.you?.buzz).toBe('open');

    expect(manager.buzz(bo.client.id)).toEqual({ ok: true, result: 'won' });
    expect(manager.buzz(cy.client.id)).toEqual({ ok: true, result: 'late' });
    expect(bo.client.last.you?.buzz).toBe('in');
    expect(ctx.display.last.current?.buzzedPlayerId).toBe(bo.playerId);
  });

  it('reveals the clue when nobody buzzes in time', () => {
    const ctx = setup();
    startAndOpen(ctx);
    vi.advanceTimersByTime(4999);
    expect(ctx.display.last.phase).toBe('buzzersOpen');
    vi.advanceTimersByTime(1);
    expect(ctx.display.last.phase).toBe('reveal');
    expect(ctx.display.last.result?.outcome).toBe('timeout');
    expect(ctx.display.last.current?.answer).toBe('B1 answer');
  });

  it('hides the answer from players and display while the host can see it', () => {
    const ctx = setup();
    startAndOpen(ctx);
    expect(ctx.host.last.current?.answer).toBe('B1 answer');
    expect(ctx.display.last.current?.answer).toBeNull();
    expect(ctx.players[0]?.client.last.current?.answer).toBeNull();
  });

  it('does not let a stale timer fire after the buzzers close', () => {
    const ctx = setup();
    startAndOpen(ctx);
    vi.advanceTimersByTime(400);
    must(manager.buzz(ctx.players[0]!.client.id));
    vi.advanceTimersByTime(60_000);
    expect(ctx.display.last.phase).toBe('answering');
  });
});

describe('Final Jeopardy timer', () => {
  it('locks answers after 30 seconds and moves to the reveal', () => {
    const ctx = setup(['Ann']);
    const ann = ctx.players[0]!;
    must(manager.hostAction(ctx.host.id, { type: 'loadBoard', board: testBoard({ rounds: 1 }) }));
    must(
      manager.hostAction(ctx.host.id, { type: 'adjustScore', playerId: ann.playerId, delta: 500 }),
    );
    must(manager.hostAction(ctx.host.id, { type: 'start' }));
    for (const [c, k] of [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ] as const) {
      must(manager.hostAction(ctx.host.id, { type: 'selectClue', categoryIndex: c, clueIndex: k }));
      must(manager.hostAction(ctx.host.id, { type: 'skipClue' }));
      must(manager.hostAction(ctx.host.id, { type: 'continue' }));
    }
    must(manager.hostAction(ctx.host.id, { type: 'continue' }));
    expect(ctx.display.last.phase).toBe('finalWager');
    must(manager.wager(ann.client.id, 300));
    must(manager.hostAction(ctx.host.id, { type: 'continue' }));
    expect(ctx.display.last.phase).toBe('finalAnswer');
    expect(ctx.display.last.deadline).toBe(Date.now() + FINAL_ANSWER_MS);

    vi.advanceTimersByTime(FINAL_ANSWER_MS - 1);
    expect(ctx.display.last.phase).toBe('finalAnswer');
    vi.advanceTimersByTime(1);
    expect(ctx.display.last.phase).toBe('finalReveal');
    expect(manager.finalAnswer(ann.client.id, 'too late').ok).toBe(false);
  });
});

describe('kicking', () => {
  it('removes the player, tells their phone, and invalidates their token', () => {
    const ctx = setup();
    const bo = ctx.players[1]!;
    must(manager.kick(ctx.host.id, bo.playerId));
    expect(bo.client.last.you).toBeNull();
    expect(bo.client.disconnected).toBe(true);
    expect(ctx.host.last.players.map((p) => p.name)).toEqual(['Ann']);
    expect(manager.rejoin(client(), ctx.code, bo.token)).toEqual({
      ok: false,
      error: 'You were removed from this room',
    });
    // Their name is free again.
    must(manager.join(client(), ctx.code, 'Bo'));
  });
});

describe('undo', () => {
  it('lets the host take back the last action', () => {
    const ctx = setup();
    const ann = ctx.players[0]!;
    must(manager.hostAction(ctx.host.id, { type: 'start' }));
    expect(ctx.host.last.canUndo).toBe(true);
    must(
      manager.hostAction(ctx.host.id, { type: 'adjustScore', playerId: ann.playerId, delta: 300 }),
    );
    must(manager.undo(ctx.host.id));
    expect(ctx.host.last.players.find((p) => p.name === 'Ann')?.score).toBe(0);
    must(manager.undo(ctx.host.id));
    expect(ctx.host.last.phase).toBe('lobby');
    expect(manager.undo(ctx.host.id)).toEqual({ ok: false, error: 'Nothing to undo' });
    expect(ctx.display.last.canUndo).toBe(false);
  });
});

describe('room cleanup', () => {
  it('deletes a room 30 minutes after its last client disconnects', () => {
    const ctx = setup();
    for (const id of [ctx.host.id, ctx.display.id, ...ctx.players.map((p) => p.client.id)]) {
      manager.disconnect(id);
    }
    expect(manager.roomCount).toBe(1);
    vi.advanceTimersByTime(ROOM_TTL_MS - 1);
    expect(manager.roomCount).toBe(1);
    vi.advanceTimersByTime(1);
    expect(manager.roomCount).toBe(0);
    expect(manager.rejoin(client(), ctx.code, ctx.hostToken).ok).toBe(false);
  });

  it('keeps the room if somebody comes back in time', () => {
    const ctx = setup();
    for (const id of [ctx.host.id, ctx.display.id, ...ctx.players.map((p) => p.client.id)]) {
      manager.disconnect(id);
    }
    vi.advanceTimersByTime(ROOM_TTL_MS - 1000);
    must(manager.rejoin(client(), ctx.code, ctx.hostToken));
    vi.advanceTimersByTime(ROOM_TTL_MS * 2);
    expect(manager.roomCount).toBe(1);
  });

  it('does not delete a room while anyone is still connected', () => {
    const ctx = setup();
    manager.disconnect(ctx.host.id);
    manager.disconnect(ctx.display.id);
    vi.advanceTimersByTime(ROOM_TTL_MS * 2);
    expect(manager.roomCount).toBe(1);
  });
});
