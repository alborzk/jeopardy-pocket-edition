import { describe, expect, it } from 'vitest';
import { UNDO_LIMIT } from '@jeopardy/shared';
import { applyAction, createRoomGame, undo } from './history';
import type { RoomGame } from './history';
import { pid, testBoard } from './test-utils';
import type { Action } from './types';

/** A small driver around the history-aware API with its own clock. */
class Room {
  game: RoomGame = createRoomGame();
  now = 5_000_000;

  do(action: Action, advanceMs = 0): this {
    this.now += advanceMs;
    const { game, result } = applyAction(this.game, action, this.now);
    if (!result.ok) throw new Error(`${action.type} was refused: ${result.error}`);
    this.game = game;
    return this;
  }

  undo(advanceMs = 0) {
    this.now += advanceMs;
    const result = undo(this.game, this.now);
    if (result.ok) this.game = result.game;
    return result;
  }

  get state() {
    return this.game.state;
  }

  score(name: string) {
    return this.state.players.find((p) => p.id === pid(name))?.score;
  }

  static started(): Room {
    const room = new Room();
    for (const name of ['Ann', 'Bo']) room.do({ type: 'playerJoined', playerId: pid(name), name });
    room.do({ type: 'loadBoard', board: testBoard() });
    room.do({ type: 'start', firstControlPlayerId: pid('Ann') });
    return room;
  }
}

describe('undo', () => {
  it('steps back through the host-visible actions one at a time', () => {
    const room = Room.started();
    room.do({ type: 'selectClue', categoryIndex: 1, clueIndex: 0 });
    room.do({ type: 'openBuzzers' });
    room.do({ type: 'buzz', playerId: pid('Bo') }, 300);
    room.do({ type: 'judge', correct: true });
    expect(room.score('Bo')).toBe(200);
    expect(room.state.phase).toBe('reveal');

    expect(room.undo().ok).toBe(true);
    expect(room.state.phase).toBe('answering');
    expect(room.score('Bo')).toBe(0);
    expect(room.state.controlPlayerId).toBe(pid('Ann'));

    room.undo();
    expect(room.state.phase).toBe('buzzersOpen');
    expect(room.state.buzzedPlayerId).toBeNull();

    room.undo();
    expect(room.state.phase).toBe('clue');
    room.undo();
    expect(room.state.phase).toBe('board');
    expect(room.state.used[1]?.[0]).toBe(false);
    room.undo();
    expect(room.state.phase).toBe('lobby');
    expect(room.undo()).toEqual({ ok: false, error: 'Nothing to undo' });
  });

  it('takes back a score adjustment', () => {
    const room = Room.started();
    room.do({ type: 'adjustScore', playerId: pid('Ann'), delta: 500 });
    room.undo();
    expect(room.score('Ann')).toBe(0);
  });

  it('only rolls back scores, not who is in the room', () => {
    const room = Room.started();
    room.do({ type: 'adjustScore', playerId: pid('Ann'), delta: 500 });
    room.do({ type: 'playerJoined', playerId: pid('Cy'), name: 'Cy' });
    room.do({ type: 'adjustScore', playerId: pid('Cy'), delta: 300 });
    room.do({ type: 'kick', playerId: pid('Bo') });

    room.undo(); // Cy's +300
    expect(room.score('Cy')).toBe(0);
    room.undo(); // Ann's +500
    expect(room.score('Ann')).toBe(0);
    expect(room.state.players.map((p) => p.name)).toEqual(['Ann', 'Cy']);
  });

  it('removes references to players who were kicked since the snapshot', () => {
    const room = Room.started();
    room.do({ type: 'selectClue', categoryIndex: 1, clueIndex: 0 });
    room.do({ type: 'openBuzzers' });
    room.do({ type: 'buzz', playerId: pid('Bo') }, 300);
    room.do({ type: 'judge', correct: false });
    room.do({ type: 'kick', playerId: pid('Bo') });
    room.undo(); // back to Bo answering, but Bo is gone
    expect(room.state.buzzedPlayerId).toBeNull();
    expect(room.state.lockedOut).toEqual([]);
    expect(room.state.phase).toBe('buzzersOpen');
  });

  it('keeps settings and connection status as they are now', () => {
    const room = Room.started();
    room.do({ type: 'selectClue', categoryIndex: 0, clueIndex: 0 });
    room.do({ type: 'setSettings', settings: { buzzTimeoutMs: 9000 } });
    room.do({ type: 'playerConnection', playerId: pid('Bo'), connected: false });
    room.undo();
    expect(room.state.settings.buzzTimeoutMs).toBe(9000);
    expect(room.state.players.find((p) => p.id === pid('Bo'))?.connected).toBe(false);
  });

  it('starts a fresh buzz timer when it returns to open buzzers', () => {
    const room = Room.started();
    room.do({ type: 'selectClue', categoryIndex: 1, clueIndex: 0 });
    room.do({ type: 'openBuzzers' });
    room.do({ type: 'timeout' }, 5000);
    expect(room.state.phase).toBe('reveal');
    room.undo(60_000);
    expect(room.state.phase).toBe('buzzersOpen');
    expect(room.state.deadline).toBe(room.now + 5000);
  });

  it('does not record joins, connection changes or settings as steps', () => {
    const room = Room.started();
    const before = room.game.past.length;
    room.do({ type: 'playerJoined', playerId: pid('Cy'), name: 'Cy' });
    room.do({ type: 'playerConnection', playerId: pid('Cy'), connected: false });
    room.do({ type: 'hostConnection', connected: false });
    room.do({ type: 'hostConnection', connected: true });
    room.do({ type: 'setSettings', settings: { finalIncludeAll: true } });
    expect(room.game.past.length).toBe(before);
  });

  it('only records a buzz when it wins the clue', () => {
    const room = Room.started();
    room.do({ type: 'selectClue', categoryIndex: 1, clueIndex: 0 });
    const afterSelect = room.game.past.length;
    room.do({ type: 'buzz', playerId: pid('Ann') }); // too early
    expect(room.game.past.length).toBe(afterSelect);
    room.do({ type: 'openBuzzers' });
    room.do({ type: 'buzz', playerId: pid('Bo') }, 400);
    room.do({ type: 'buzz', playerId: pid('Ann') }, 10); // late
    expect(room.game.past.length).toBe(afterSelect + 2);
  });

  it('keeps only the last 20 states', () => {
    const room = Room.started();
    for (let i = 0; i < 30; i++) room.do({ type: 'adjustScore', playerId: pid('Ann'), delta: 1 });
    expect(room.game.past).toHaveLength(UNDO_LIMIT);
    for (let i = 0; i < UNDO_LIMIT; i++) expect(room.undo().ok).toBe(true);
    expect(room.undo().ok).toBe(false);
    expect(room.score('Ann')).toBe(10);
  });

  it('does not record refused actions', () => {
    const room = Room.started();
    const before = room.game.past.length;
    const { game, result } = applyAction(room.game, { type: 'openBuzzers' }, room.now);
    expect(result.ok).toBe(false);
    expect(game).toBe(room.game);
    expect(room.game.past.length).toBe(before);
  });
});
