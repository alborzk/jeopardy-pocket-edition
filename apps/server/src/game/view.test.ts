import { describe, expect, it } from 'vitest';
import type { Role, Snapshot } from '@jeopardy/shared';
import { Sim, pid, testBoard } from './test-utils';
import { viewFor } from './view';

function view(sim: Sim, role: Role, name: string | null = null): Snapshot {
  return viewFor(sim.state, role, name ? pid(name) : null, {
    code: 'ABCD',
    now: sim.now,
    canUndo: true,
  });
}

/** Every string anywhere in the snapshot, so a leak can't hide in a nested field. */
function allStrings(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') found.push(value);
  else if (Array.isArray(value)) value.forEach((v) => allStrings(v, found));
  else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, v]) => {
      found.push(key);
      allStrings(v, found);
    });
  }
  return found;
}

describe('clue answers', () => {
  it('stay hidden from the display and players until the reveal', () => {
    const sim = Sim.started().buzzIn(0, 0, 'Bo');
    for (const phaseStep of ['answering', 'buzzersOpen']) {
      if (phaseStep === 'buzzersOpen') sim.do({ type: 'judge', correct: false });
      expect(sim.state.phase).toBe(phaseStep);
      for (const [role, name] of [
        ['display', null],
        ['player', 'Ann'],
        ['player', 'Bo'],
      ] as const) {
        const snapshot = view(sim, role, name);
        expect(snapshot.current?.clue).toBe('A1 clue');
        expect(snapshot.current?.answer).toBeNull();
        expect(allStrings(snapshot)).not.toContain('A1 answer');
      }
    }
  });

  it('are always visible to the host', () => {
    const sim = Sim.started().select(0, 0);
    expect(view(sim, 'host').current?.answer).toBe('A1 answer');
  });

  it('are shown to everyone once revealed', () => {
    const sim = Sim.started().buzzIn(0, 0, 'Bo').do({ type: 'judge', correct: true });
    expect(view(sim, 'display').current?.answer).toBe('A1 answer');
    expect(view(sim, 'player', 'Cy').current?.answer).toBe('A1 answer');
  });

  it('are gone again on the board', () => {
    const sim = Sim.started().select(0, 0).do({ type: 'skipClue' }).do({ type: 'continue' });
    expect(view(sim, 'display').current).toBeNull();
    expect(allStrings(view(sim, 'display'))).not.toContain('A1 answer');
  });
});

describe('the board', () => {
  it('never carries clue text or answers for unplayed clues', () => {
    const sim = Sim.started();
    for (const role of ['display', 'player', 'host'] as const) {
      const strings = allStrings(view(sim, role, role === 'player' ? 'Ann' : null));
      expect(strings.some((s) => /clue$/.test(s) && s.includes('1'))).toBe(false);
      expect(strings.some((s) => /answer$/.test(s))).toBe(false);
    }
  });

  it('shows Daily Double positions to the host only', () => {
    const sim = Sim.started();
    const hostCells = view(sim, 'host').grid?.flatMap((c) => c.cells) ?? [];
    expect(hostCells.filter((c) => c.dailyDouble === true)).toHaveLength(1);
    for (const role of ['display', 'player'] as const) {
      const cells = view(sim, role, 'Ann').grid?.flatMap((c) => c.cells) ?? [];
      expect(cells.some((c) => 'dailyDouble' in c)).toBe(false);
    }
  });

  it('is absent in the lobby', () => {
    expect(view(new Sim(), 'display').grid).toBeNull();
  });

  it('marks played clues as used', () => {
    const sim = Sim.started().select(1, 1);
    expect(view(sim, 'display').grid?.[1]?.cells[1]?.used).toBe(true);
  });
});

describe('Daily Double', () => {
  it('hides the clue text from everyone but the host while the wager is placed', () => {
    const sim = Sim.started().select(0, 1);
    expect(view(sim, 'display').current?.clue).toBeNull();
    expect(view(sim, 'player', 'Ann').current?.clue).toBeNull();
    expect(view(sim, 'host').current?.clue).toBe('A2 clue');
    expect(view(sim, 'display').current?.wagerLimits).toEqual({ min: 5, max: 400 });
  });

  it('shows the clue after the wager', () => {
    const sim = Sim.started()
      .select(0, 1)
      .do({ type: 'wager', playerId: pid('Ann'), amount: 100 });
    expect(view(sim, 'display').current?.clue).toBe('A2 clue');
    expect(view(sim, 'display').current?.answer).toBeNull();
    expect(view(sim, 'display').current?.wager).toBe(100);
  });
});

describe('Final Jeopardy', () => {
  function atFinal() {
    const sim = Sim.started(['Ann', 'Bo', 'Cy'], testBoard({ rounds: 1 }));
    sim.do({ type: 'adjustScore', playerId: pid('Ann'), delta: 1000 });
    sim.do({ type: 'adjustScore', playerId: pid('Bo'), delta: 600 });
    sim.skipAll().do({ type: 'continue' });
    return sim;
  }

  it('keeps the clue back until the answer timer starts', () => {
    const sim = atFinal();
    expect(view(sim, 'display').final?.category).toBe('FINAL CAT');
    expect(view(sim, 'display').final?.clue).toBeNull();
    expect(view(sim, 'player', 'Ann').final?.clue).toBeNull();
    expect(view(sim, 'host').final?.clue).toBe('final clue');
    sim.do({ type: 'continue' });
    expect(view(sim, 'display').final?.clue).toBe('final clue');
  });

  it('never shows one player another player’s wager or answer before the reveal', () => {
    const sim = atFinal();
    sim.do({ type: 'wager', playerId: pid('Ann'), amount: 777 });
    sim.do({ type: 'wager', playerId: pid('Bo'), amount: 333 });
    sim.do({ type: 'continue' });
    sim.do({ type: 'finalAnswer', playerId: pid('Ann'), text: 'secret ann answer' }, 1000);
    sim.do({ type: 'finalAnswer', playerId: pid('Bo'), text: 'secret bo answer' }, 1000);

    const display = view(sim, 'display');
    const asBo = view(sim, 'player', 'Bo');
    for (const snapshot of [display, asBo]) {
      const strings = JSON.stringify(snapshot);
      expect(strings).not.toContain('secret ann answer');
      expect(strings).not.toContain('777');
      expect(snapshot.final?.wagers).toBeNull();
      expect(snapshot.final?.answers).toBeNull();
      expect(snapshot.final?.answer).toBeNull();
    }
    // Others can see that a wager and an answer were placed, but not what they were.
    expect(display.final?.wagered.sort()).toEqual([pid('Ann'), pid('Bo')]);
    expect(display.final?.answered.sort()).toEqual([pid('Ann'), pid('Bo')]);
    // Bo sees their own.
    expect(asBo.final?.yourWager).toBe(333);
    expect(asBo.final?.yourAnswer).toBe('secret bo answer');

    const host = view(sim, 'host');
    expect(host.final?.wagers).toEqual({ [pid('Ann')]: 777, [pid('Bo')]: 333 });
    expect(host.final?.answers?.[pid('Ann')]).toBe('secret ann answer');
  });

  it('reveals one answer at a time, and the wager only once judged', () => {
    const sim = atFinal();
    sim.do({ type: 'wager', playerId: pid('Ann'), amount: 777 });
    sim.do({ type: 'wager', playerId: pid('Bo'), amount: 333 });
    sim.do({ type: 'continue' });
    sim.do({ type: 'finalAnswer', playerId: pid('Ann'), text: 'secret ann answer' }, 1000);
    sim.do({ type: 'finalAnswer', playerId: pid('Bo'), text: 'secret bo answer' }, 1000);
    sim.do({ type: 'continue' });

    sim.do({ type: 'finalReveal', playerId: pid('Bo') });
    let display = view(sim, 'display');
    expect(display.final?.reveals).toEqual([
      { playerId: pid('Bo'), answer: 'secret bo answer', wager: null, correct: null },
    ]);
    expect(JSON.stringify(display)).not.toContain('secret ann answer');
    expect(JSON.stringify(display)).not.toContain('777');
    expect(display.final?.answer).toBe('final answer');

    sim.do({ type: 'finalJudge', playerId: pid('Bo'), correct: true });
    display = view(sim, 'display');
    expect(display.final?.reveals[0]).toEqual({
      playerId: pid('Bo'),
      answer: 'secret bo answer',
      wager: 333,
      correct: true,
    });
    expect(JSON.stringify(display)).not.toContain('secret ann answer');
  });

  it('has nobody in control any more', () => {
    const sim = atFinal();
    expect(view(sim, 'display').controlPlayerId).toBeNull();
    expect(view(sim, 'host').controlPlayerId).toBeNull();
  });

  it('gives only an eligible player their wager limits', () => {
    const sim = atFinal();
    expect(view(sim, 'player', 'Ann').final?.wagerLimits).toEqual({ min: 0, max: 1000 });
    expect(view(sim, 'player', 'Cy').final?.wagerLimits).toBeNull();
    expect(view(sim, 'display').final?.wagerLimits).toBeNull();
  });
});

describe('player views', () => {
  it('say who the player is and what their buzzer should look like', () => {
    const sim = Sim.started();
    expect(view(sim, 'player', 'Ann').you).toMatchObject({
      id: pid('Ann'),
      name: 'Ann',
      buzz: 'locked',
    });

    sim.select(0, 0);
    expect(view(sim, 'player', 'Ann').you?.buzz).toBe('locked');
    sim.do({ type: 'buzz', playerId: pid('Ann') });
    expect(view(sim, 'player', 'Ann').you?.buzz).toBe('lockedOut');

    sim.do({ type: 'openBuzzers' });
    expect(view(sim, 'player', 'Bo').you?.buzz).toBe('open');
    expect(view(sim, 'player', 'Ann').you?.buzz).toBe('lockedOut');

    sim.do({ type: 'buzz', playerId: pid('Bo') }, 500);
    expect(view(sim, 'player', 'Bo').you?.buzz).toBe('in');
    expect(view(sim, 'player', 'Cy').you?.buzz).toBe('locked');

    sim.do({ type: 'judge', correct: false });
    expect(view(sim, 'player', 'Bo').you?.buzz).toBe('lockedOut');
    expect(view(sim, 'player', 'Cy').you?.buzz).toBe('open');
  });

  it('send nothing about “you” to the host and display, or to a removed player', () => {
    const sim = Sim.started();
    expect(view(sim, 'host').you).toBeNull();
    expect(view(sim, 'display').you).toBeNull();
    sim.do({ type: 'kick', playerId: pid('Cy') });
    expect(view(sim, 'player', 'Cy').you).toBeNull();
  });

  it('only offer undo to the host', () => {
    const sim = Sim.started();
    expect(view(sim, 'host').canUndo).toBe(true);
    expect(view(sim, 'display').canUndo).toBe(false);
    expect(view(sim, 'player', 'Ann').canUndo).toBe(false);
  });

  it('report a frozen game and the time left', () => {
    const sim = Sim.started().select(0, 0).do({ type: 'openBuzzers' });
    sim.do({ type: 'pause' }, 2000);
    const snapshot = view(sim, 'display');
    expect(snapshot.frozen).toBe(true);
    expect(snapshot.paused).toBe(true);
    expect(snapshot.deadline).toBeNull();
    expect(snapshot.remainingMs).toBe(3000);
    expect(view(sim, 'player', 'Ann').you?.buzz).toBe('locked');
  });
});
