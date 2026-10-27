import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connectClient } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { Ack, Snapshot } from '@jeopardy/shared';
import { testBoard } from './game/test-utils';
import { startServer } from './server';
import type { RunningServer } from './server';

let server: RunningServer;
let url: string;
const open: Socket[] = [];

beforeAll(async () => {
  server = await startServer({ port: 0, host: '127.0.0.1' });
  url = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  for (const socket of open) socket.close();
  await server.close();
});

/** A real socket plus the latest snapshot it was sent. */
class TestClient {
  socket: Socket;
  snapshot: Snapshot | null = null;
  constructor() {
    this.socket = connectClient(url, { transports: ['websocket'], forceNew: true });
    open.push(this.socket);
    this.socket.on('state', (snapshot: Snapshot) => {
      this.snapshot = snapshot;
    });
  }
  async connected(): Promise<this> {
    if (!this.socket.connected)
      await new Promise<void>((r) => this.socket.once('connect', () => r()));
    return this;
  }
  emit<T extends object = object>(event: string, payload: object = {}): Promise<Ack<T>> {
    return new Promise((resolve) => {
      this.socket.timeout(2000).emit(event, payload, (error: Error | null, response: Ack<T>) => {
        resolve(error ? { ok: false, error: error.message } : response);
      });
    });
  }
  /** Wait until a snapshot satisfies the condition. */
  async until(test: (s: Snapshot) => boolean, label: string): Promise<Snapshot> {
    for (let i = 0; i < 100; i++) {
      if (this.snapshot && test(this.snapshot)) return this.snapshot;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`Timed out waiting for: ${label}. Last: ${JSON.stringify(this.snapshot)}`);
  }
}

async function client() {
  return new TestClient().connected();
}

describe('socket handshake and a played clue', () => {
  it('runs create, join, buzz, judge and reveal over real sockets', async () => {
    const host = await client();
    const created = await host.emit<{ code: string; hostToken: string }>('room:create');
    if (!created.ok) throw new Error(created.error);
    const { code } = created;

    const tv = await client();
    expect((await tv.emit('display:join', { code: code.toLowerCase() })).ok).toBe(true);

    const ann = await client();
    const bo = await client();
    const annJoin = await ann.emit<{ playerId: string; token: string }>('room:join', {
      code,
      name: 'Ann',
    });
    const boJoin = await bo.emit<{ playerId: string; token: string }>('room:join', {
      code: code.toLowerCase(),
      name: ' Bo ',
    });
    if (!annJoin.ok || !boJoin.ok) throw new Error('join failed');

    await tv.until((s) => s.players.length === 2, 'two players on the display');
    expect(tv.snapshot?.players.map((p) => p.name)).toEqual(['Ann', 'Bo']);

    expect((await host.emit('host:loadBoard', { board: testBoard() })).ok).toBe(true);
    expect((await host.emit('host:start')).ok).toBe(true);
    expect((await host.emit('host:selectClue', { categoryIndex: 1, clueIndex: 1 })).ok).toBe(true);
    await tv.until((s) => s.phase === 'clue', 'clue on the display');
    expect(tv.snapshot?.current?.clue).toBe('B2 clue');
    expect(tv.snapshot?.current?.answer).toBeNull();

    expect(await ann.emit('player:buzz')).toEqual({ ok: true, result: 'notOpen' });
    expect((await host.emit('host:openBuzzers')).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(await bo.emit('player:buzz')).toEqual({ ok: true, result: 'won' });
    expect(await ann.emit('player:buzz')).toEqual({ ok: true, result: 'late' });

    await tv.until((s) => s.phase === 'answering', 'answering');
    expect(tv.snapshot?.current?.buzzedPlayerId).toBe(boJoin.playerId);
    expect(JSON.stringify(tv.snapshot)).not.toContain('B2 answer');
    expect(JSON.stringify(ann.snapshot)).not.toContain('B2 answer');
    expect(JSON.stringify(host.snapshot)).toContain('B2 answer');

    expect((await host.emit('host:judge', { correct: true })).ok).toBe(true);
    await tv.until((s) => s.phase === 'reveal', 'reveal');
    expect(tv.snapshot?.current?.answer).toBe('B2 answer');
    expect(tv.snapshot?.players.find((p) => p.name === 'Bo')?.score).toBe(400);
    expect(tv.snapshot?.controlPlayerId).toBe(boJoin.playerId);

    // Bo's phone locks and the socket drops. The seat and score survive.
    bo.socket.close();
    await host.until(
      (s) => s.players.find((p) => p.name === 'Bo')?.connected === false,
      'Bo disconnected',
    );
    expect(host.snapshot?.players.find((p) => p.name === 'Bo')?.score).toBe(400);

    const phone = await client();
    const rejoined = await phone.emit('room:rejoin', { code, token: boJoin.token });
    expect(rejoined).toEqual({ ok: true, role: 'player', playerId: boJoin.playerId });
    await phone.until((s) => s.you?.score === 400, 'restored score');
    expect(phone.snapshot?.you?.name).toBe('Bo');
    await host.until(
      (s) => s.players.find((p) => p.name === 'Bo')?.connected === true,
      'Bo is back',
    );
  });

  it('refuses host events from players and malformed payloads', async () => {
    const host = await client();
    const created = await host.emit<{ code: string }>('room:create');
    if (!created.ok) throw new Error(created.error);
    const player = await client();
    await player.emit('room:join', { code: created.code, name: 'Cy' });

    expect(await player.emit('host:start')).toEqual({
      ok: false,
      error: 'Only the host can do that',
    });
    expect(await player.emit('host:adjustScore', { playerId: 'x', delta: 1 })).toEqual({
      ok: false,
      error: 'Only the host can do that',
    });
    const badCode = await player.emit('room:join', { code: 'ABCI', name: 'Dee' });
    expect(badCode).toEqual({ ok: false, error: 'Invalid room code' });
    const badBoard = await host.emit('host:loadBoard', { board: { id: 'x' } });
    expect(badBoard.ok).toBe(false);
    const badDelta = await host.emit('host:adjustScore', { playerId: 'x', delta: 'lots' });
    expect(badDelta.ok).toBe(false);
  });

  it('kicks a player off the socket', async () => {
    const host = await client();
    const created = await host.emit<{ code: string }>('room:create');
    if (!created.ok) throw new Error(created.error);
    const player = await client();
    const joined = await player.emit<{ playerId: string; token: string }>('room:join', {
      code: created.code,
      name: 'Ed',
    });
    if (!joined.ok) throw new Error(joined.error);

    expect((await host.emit('host:kick', { playerId: joined.playerId })).ok).toBe(true);
    await player.until((s) => s.you === null, 'removed');
    await new Promise((r) => setTimeout(r, 50));
    expect(player.socket.connected).toBe(false);
    const again = await client();
    expect(await again.emit('room:rejoin', { code: created.code, token: joined.token })).toEqual({
      ok: false,
      error: 'You were removed from this room',
    });
  });

  it('serves a health check', async () => {
    const response = await fetch(`${url}/healthz`);
    expect(await response.json()).toMatchObject({ ok: true });
  });
});
