import type { Board } from '@jeopardy/shared';
import { createGameState, tryReduce } from './reducer';
import type { Action, GameState } from './types';

/**
 * Round 1: categories A and B with two clues each (200, 400). A's 400 clue is a Daily Double.
 * Round 2: categories C and D with two clues each (400, 800).
 */
export function testBoard(options: { rounds?: 1 | 2 } = {}): Board {
  const category = (name: string, values: [number, number], dailyDouble = false) => ({
    name,
    clues: [
      { value: values[0], clue: `${name}1 clue`, answer: `${name}1 answer` },
      {
        value: values[1],
        clue: `${name}2 clue`,
        answer: `${name}2 answer`,
        ...(dailyDouble ? { dailyDouble: true } : {}),
      },
    ],
  });
  const rounds = [
    { name: 'Jeopardy!', categories: [category('A', [200, 400], true), category('B', [200, 400])] },
    {
      name: 'Double Jeopardy!',
      categories: [category('C', [400, 800]), category('D', [400, 800])],
    },
  ].slice(0, options.rounds ?? 2);
  return {
    id: 'test-board',
    title: 'Test board',
    rounds,
    final: { category: 'FINAL CAT', clue: 'final clue', answer: 'final answer' },
  };
}

export const pid = (name: string) => `p_${name.toLowerCase()}`;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Drives the reducer with a controllable clock. Every state is deep-frozen, so a reducer that
 * mutates its input throws in these tests.
 */
export class Sim {
  state: GameState = deepFreeze(createGameState());
  now = 1_000_000;

  do(action: Action, advanceMs = 0): this {
    this.now += advanceMs;
    const result = tryReduce(this.state, action, this.now);
    if (!result.ok) throw new Error(`${action.type} was refused: ${result.error}`);
    this.state = deepFreeze(result.state);
    return this;
  }

  /** The error message when the action is refused. Fails the test if it is accepted. */
  refused(action: Action, advanceMs = 0): string {
    this.now += advanceMs;
    const result = tryReduce(this.state, action, this.now);
    if (result.ok) throw new Error(`${action.type} was accepted but should have been refused`);
    return result.error;
  }

  score(name: string): number {
    return this.state.players.find((p) => p.id === pid(name))?.score ?? Number.NaN;
  }

  join(...names: string[]): this {
    for (const name of names) this.do({ type: 'playerJoined', playerId: pid(name), name });
    return this;
  }

  /** Lobby with players and a board, started. The first name is in control. */
  static started(names = ['Ann', 'Bo', 'Cy'], board: Board = testBoard()): Sim {
    const sim = new Sim().join(...names);
    sim.do({ type: 'loadBoard', board });
    sim.do({ type: 'start', firstControlPlayerId: pid(names[0] ?? 'Ann') });
    return sim;
  }

  select(categoryIndex: number, clueIndex: number): this {
    return this.do({ type: 'selectClue', categoryIndex, clueIndex });
  }

  /** Select a clue, open the buzzers and have `name` buzz in. */
  buzzIn(categoryIndex: number, clueIndex: number, name: string): this {
    this.select(categoryIndex, clueIndex);
    this.do({ type: 'openBuzzers' });
    return this.do({ type: 'buzz', playerId: pid(name) }, 400);
  }

  /** Play every clue in the current round by skipping it. */
  skipAll(): this {
    const round = this.state.board?.rounds[this.state.roundIndex];
    if (!round) return this;
    round.categories.forEach((category, c) =>
      category.clues.forEach((_, k) => {
        this.select(c, k);
        this.do({ type: 'skipClue' });
        this.do({ type: 'continue' });
      }),
    );
    return this;
  }
}
