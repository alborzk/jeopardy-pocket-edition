import { describe, expect, it } from 'vitest';
import { FINAL_ANSWER_MS } from '@jeopardy/shared';
import { createGameState, dailyDoubleLimits, evaluateBuzz, reduce } from './reducer';
import { Sim, pid, testBoard } from './test-utils';

describe('lobby', () => {
  it('seats players with unique case-insensitive names', () => {
    const sim = new Sim().join('Ann', 'Bo');
    expect(sim.refused({ type: 'playerJoined', playerId: 'x', name: 'ANN' })).toMatch(/taken/);
    expect(sim.refused({ type: 'playerJoined', playerId: 'x', name: '  bo ' })).toMatch(/taken/);
    expect(sim.state.players.map((p) => p.name)).toEqual(['Ann', 'Bo']);
  });

  it('enforces name length and the 12 player maximum', () => {
    const sim = new Sim();
    expect(sim.refused({ type: 'playerJoined', playerId: 'x', name: '   ' })).toMatch(/1-16/);
    expect(sim.refused({ type: 'playerJoined', playerId: 'x', name: 'a'.repeat(17) })).toMatch(
      /1-16/,
    );
    for (let i = 0; i < 12; i++) sim.join(`Player${i}`);
    expect(sim.refused({ type: 'playerJoined', playerId: 'late', name: 'Late' })).toMatch(/full/);
  });

  it('needs a board and a player before it can start', () => {
    const sim = new Sim();
    expect(sim.refused({ type: 'start' })).toMatch(/board/i);
    sim.do({ type: 'loadBoard', board: testBoard() });
    expect(sim.refused({ type: 'start' })).toMatch(/player/);
    sim.join('Ann');
    sim.do({ type: 'start' });
    expect(sim.state.phase).toBe('board');
    expect(sim.state.controlPlayerId).toBe(pid('Ann'));
    expect(sim.state.used).toEqual([
      [false, false],
      [false, false],
    ]);
  });

  it('only loads a board in the lobby', () => {
    const sim = Sim.started();
    expect(sim.refused({ type: 'loadBoard', board: testBoard() })).toMatch(/lobby/);
  });

  it('keeps the requested first player in control', () => {
    const sim = new Sim().join('Ann', 'Bo');
    sim.do({ type: 'loadBoard', board: testBoard() });
    sim.do({ type: 'start', firstControlPlayerId: pid('Bo') });
    expect(sim.state.controlPlayerId).toBe(pid('Bo'));
  });

  it('validates the buzz timeout setting', () => {
    const sim = new Sim();
    expect(sim.refused({ type: 'setSettings', settings: { buzzTimeoutMs: 10 } })).toMatch(
      /timeout/,
    );
    sim.do({ type: 'setSettings', settings: { buzzTimeoutMs: null } });
    expect(sim.state.settings.buzzTimeoutMs).toBeNull();
    sim.do({ type: 'setSettings', settings: { finalIncludeAll: true } });
    expect(sim.state.settings).toEqual({ buzzTimeoutMs: null, finalIncludeAll: true });
  });
});

describe('selecting clues', () => {
  it('shows the clue and marks it used', () => {
    const sim = Sim.started().select(1, 0);
    expect(sim.state.phase).toBe('clue');
    expect(sim.state.current).toEqual({ categoryIndex: 1, clueIndex: 0 });
    expect(sim.state.used[1]?.[0]).toBe(true);
    expect(sim.state.used[0]?.[0]).toBe(false);
  });

  it('refuses clues that are out of range or already played', () => {
    const sim = Sim.started();
    expect(sim.refused({ type: 'selectClue', categoryIndex: 5, clueIndex: 0 })).toMatch(/No such/);
    expect(sim.refused({ type: 'selectClue', categoryIndex: 0, clueIndex: 9 })).toMatch(/No such/);
    sim.select(0, 0).do({ type: 'skipClue' }).do({ type: 'continue' });
    expect(sim.refused({ type: 'selectClue', categoryIndex: 0, clueIndex: 0 })).toMatch(/already/);
  });

  it('only allows picking on the board', () => {
    const sim = Sim.started().select(0, 0);
    expect(sim.refused({ type: 'selectClue', categoryIndex: 1, clueIndex: 0 })).toMatch(/Not time/);
  });
});

describe('buzzing', () => {
  it('ignores buzzes before a clue is up', () => {
    const sim = Sim.started();
    expect(evaluateBuzz(sim.state, pid('Ann'), sim.now)).toBe('notOpen');
  });

  it('keeps buzzers locked while the host reads the clue', () => {
    const sim = Sim.started().select(0, 0);
    expect(evaluateBuzz(sim.state, pid('Ann'), sim.now)).toBe('notOpen');
    expect(sim.state.deadline).toBeNull();
  });

  it('gives the first valid buzz the clue and everyone else a late result', () => {
    const sim = Sim.started().select(0, 0).do({ type: 'openBuzzers' });
    expect(evaluateBuzz(sim.state, pid('Bo'), sim.now)).toBe('won');
    sim.do({ type: 'buzz', playerId: pid('Bo') });
    expect(sim.state.phase).toBe('answering');
    expect(sim.state.buzzedPlayerId).toBe(pid('Bo'));
    expect(sim.state.deadline).toBeNull();
    expect(evaluateBuzz(sim.state, pid('Cy'), sim.now)).toBe('late');
    sim.do({ type: 'buzz', playerId: pid('Cy') });
    expect(sim.state.buzzedPlayerId).toBe(pid('Bo'));
  });

  it('locks out early buzzers until 250ms after the buzzers open', () => {
    const sim = Sim.started().select(0, 0);
    sim.do({ type: 'buzz', playerId: pid('Ann') });
    expect(sim.state.phase).toBe('clue');
    expect(sim.state.earlyBuzzers).toEqual([pid('Ann')]);

    sim.do({ type: 'openBuzzers' }, 1000);
    const opened = sim.now;
    expect(sim.state.earlyLockUntil[pid('Ann')]).toBe(opened + 250);
    expect(evaluateBuzz(sim.state, pid('Ann'), opened + 100)).toBe('locked');
    expect(evaluateBuzz(sim.state, pid('Ann'), opened + 249)).toBe('locked');
    expect(evaluateBuzz(sim.state, pid('Ann'), opened + 250)).toBe('won');
    expect(evaluateBuzz(sim.state, pid('Bo'), opened + 1)).toBe('won');
  });

  it('does not let a locked-out early buzzer take the clue', () => {
    const sim = Sim.started().select(0, 0);
    sim.do({ type: 'buzz', playerId: pid('Ann') });
    sim.do({ type: 'openBuzzers' });
    sim.do({ type: 'buzz', playerId: pid('Ann') }, 100);
    expect(sim.state.phase).toBe('buzzersOpen');
    sim.do({ type: 'buzz', playerId: pid('Bo') }, 50);
    expect(sim.state.buzzedPlayerId).toBe(pid('Bo'));
  });

  it('moves to the reveal when nobody buzzes before the timeout', () => {
    const sim = Sim.started().select(0, 0).do({ type: 'openBuzzers' });
    expect(sim.state.deadline).toBe(sim.now + 5000);
    expect(sim.refused({ type: 'timeout' }, 4999)).toMatch(/not up/);
    sim.do({ type: 'timeout' }, 1);
    expect(sim.state.phase).toBe('reveal');
    expect(sim.state.result).toEqual({ outcome: 'timeout', playerId: null, delta: 0 });
    expect(sim.state.deadline).toBeNull();
  });

  it('can run without a timeout', () => {
    const sim = Sim.started();
    sim.do({ type: 'setSettings', settings: { buzzTimeoutMs: null } });
    sim.select(0, 0).do({ type: 'openBuzzers' });
    expect(sim.state.deadline).toBeNull();
    expect(sim.refused({ type: 'timeout' }, 60_000)).toMatch(/not up/);
    expect(sim.state.phase).toBe('buzzersOpen');
  });

  it('uses the configured timeout', () => {
    const sim = Sim.started();
    sim.do({ type: 'setSettings', settings: { buzzTimeoutMs: 8000 } });
    sim.select(0, 0).do({ type: 'openBuzzers' });
    expect(sim.state.deadline).toBe(sim.now + 8000);
  });

  it('refuses unknown players', () => {
    const sim = Sim.started().select(0, 0).do({ type: 'openBuzzers' });
    expect(evaluateBuzz(sim.state, 'ghost', sim.now)).toBe('locked');
    expect(sim.refused({ type: 'buzz', playerId: 'ghost' })).toMatch(/Unknown/);
  });
});

describe('judging', () => {
  it('adds the value and gives control to a correct answer', () => {
    const sim = Sim.started().buzzIn(1, 1, 'Bo');
    sim.do({ type: 'judge', correct: true });
    expect(sim.score('Bo')).toBe(400);
    expect(sim.state.controlPlayerId).toBe(pid('Bo'));
    expect(sim.state.phase).toBe('reveal');
    expect(sim.state.result).toEqual({ outcome: 'correct', playerId: pid('Bo'), delta: 400 });
  });

  it('subtracts the value and reopens the buzzers on an incorrect answer', () => {
    const sim = Sim.started().buzzIn(0, 0, 'Bo');
    sim.do({ type: 'judge', correct: false }, 2000);
    expect(sim.score('Bo')).toBe(-200);
    expect(sim.state.phase).toBe('buzzersOpen');
    expect(sim.state.lockedOut).toEqual([pid('Bo')]);
    expect(sim.state.buzzedPlayerId).toBeNull();
    expect(sim.state.deadline).toBe(sim.now + 5000);
    expect(sim.state.controlPlayerId).toBe(pid('Ann'));
  });

  it('keeps an incorrect player locked out for the rest of the clue', () => {
    const sim = Sim.started().buzzIn(0, 0, 'Bo');
    sim.do({ type: 'judge', correct: false });
    expect(evaluateBuzz(sim.state, pid('Bo'), sim.now + 10_000)).toBe('locked');
    sim.do({ type: 'buzz', playerId: pid('Bo') }, 100);
    expect(sim.state.phase).toBe('buzzersOpen');
    sim.do({ type: 'buzz', playerId: pid('Cy') }, 100);
    sim.do({ type: 'judge', correct: true });
    expect(sim.score('Cy')).toBe(200);
    expect(sim.score('Bo')).toBe(-200);
    expect(sim.state.controlPlayerId).toBe(pid('Cy'));
  });

  it('goes to the reveal once everyone has been wrong', () => {
    const sim = Sim.started().buzzIn(0, 0, 'Ann');
    sim.do({ type: 'judge', correct: false });
    sim.do({ type: 'buzz', playerId: pid('Bo') }, 100).do({ type: 'judge', correct: false });
    sim.do({ type: 'buzz', playerId: pid('Cy') }, 100).do({ type: 'judge', correct: false });
    expect(sim.state.phase).toBe('reveal');
    expect(sim.state.deadline).toBeNull();
    expect(sim.state.players.map((p) => p.score)).toEqual([-200, -200, -200]);
    // Control stays with whoever had it.
    expect(sim.state.controlPlayerId).toBe(pid('Ann'));
  });

  it('does not wait on disconnected players', () => {
    const sim = Sim.started(['Ann', 'Bo']);
    sim.do({ type: 'playerConnection', playerId: pid('Bo'), connected: false });
    sim.buzzIn(0, 0, 'Ann').do({ type: 'judge', correct: false });
    expect(sim.state.phase).toBe('reveal');
  });

  it('refuses to judge when nobody is answering', () => {
    const sim = Sim.started().select(0, 0);
    expect(sim.refused({ type: 'judge', correct: true })).toMatch(/nothing to judge/);
  });

  it('plays the reveal then returns to the board', () => {
    const sim = Sim.started().buzzIn(0, 0, 'Bo').do({ type: 'judge', correct: true });
    sim.do({ type: 'continue' });
    expect(sim.state.phase).toBe('board');
    expect(sim.state.current).toBeNull();
    expect(sim.state.lockedOut).toEqual([]);
  });

  it('skips a clue without changing scores', () => {
    const sim = Sim.started().buzzIn(0, 0, 'Bo');
    sim.do({ type: 'skipClue' });
    expect(sim.state.phase).toBe('reveal');
    expect(sim.state.players.every((p) => p.score === 0)).toBe(true);
    expect(sim.state.result?.outcome).toBe('skipped');
    expect(sim.refused({ type: 'skipClue' })).toMatch(/no clue/);
  });
});

describe('Daily Double', () => {
  function atWager(): Sim {
    return Sim.started().select(0, 1);
  }

  it('asks only the player in control, with no buzzers', () => {
    const sim = atWager();
    expect(sim.state.phase).toBe('dailyDoubleWager');
    expect(evaluateBuzz(sim.state, pid('Bo'), sim.now)).toBe('notOpen');
    expect(sim.refused({ type: 'openBuzzers' })).toMatch(/Buzzers can only/);
    expect(sim.refused({ type: 'wager', playerId: pid('Bo'), amount: 100 })).toMatch(/in control/);
  });

  it('allows 5 up to the top clue value when the score is low', () => {
    const sim = atWager();
    expect(dailyDoubleLimits(sim.state)).toEqual({ min: 5, max: 400 });
    expect(sim.refused({ type: 'wager', playerId: pid('Ann'), amount: 4 })).toMatch(
      /between 5 and 400/,
    );
    expect(sim.refused({ type: 'wager', playerId: pid('Ann'), amount: 401 })).toMatch(
      /between 5 and 400/,
    );
    expect(sim.refused({ type: 'wager', playerId: pid('Ann'), amount: 100.5 })).toMatch(/whole/);
  });

  it('allows up to the score when it is above the top clue value', () => {
    const sim = Sim.started();
    sim.do({ type: 'adjustScore', playerId: pid('Ann'), delta: 1500 });
    sim.select(0, 1);
    expect(dailyDoubleLimits(sim.state)).toEqual({ min: 5, max: 1500 });
    sim.do({ type: 'wager', playerId: pid('Ann'), amount: 1500 });
    expect(sim.state.phase).toBe('dailyDoubleClue');
    expect(sim.state.wager).toBe(1500);
  });

  it('adds the wager for a correct answer and keeps control', () => {
    const sim = atWager().do({ type: 'wager', playerId: pid('Ann'), amount: 300 });
    sim.do({ type: 'judge', correct: true });
    expect(sim.score('Ann')).toBe(300);
    expect(sim.state.phase).toBe('reveal');
    expect(sim.state.controlPlayerId).toBe(pid('Ann'));
    expect(sim.state.result).toEqual({ outcome: 'correct', playerId: pid('Ann'), delta: 300 });
  });

  it('subtracts the wager for an incorrect answer', () => {
    const sim = atWager().do({ type: 'wager', playerId: pid('Ann'), amount: 400 });
    sim.do({ type: 'judge', correct: false });
    expect(sim.score('Ann')).toBe(-400);
    expect(sim.state.phase).toBe('reveal');
  });

  it('can be skipped', () => {
    const sim = atWager().do({ type: 'skipClue' });
    expect(sim.state.phase).toBe('reveal');
    expect(sim.score('Ann')).toBe(0);
  });
});

describe('rounds', () => {
  it('ends the round when the last clue is played', () => {
    const sim = Sim.started();
    sim.select(0, 0).do({ type: 'skipClue' }).do({ type: 'continue' });
    sim.select(0, 1).do({ type: 'skipClue' }).do({ type: 'continue' });
    sim.select(1, 0).do({ type: 'skipClue' }).do({ type: 'continue' });
    expect(sim.state.phase).toBe('board');
    sim.select(1, 1).do({ type: 'skipClue' }).do({ type: 'continue' });
    expect(sim.state.phase).toBe('roundEnd');
  });

  it('starts the next round with control going to the lowest score', () => {
    const sim = Sim.started();
    sim.do({ type: 'adjustScore', playerId: pid('Ann'), delta: 400 });
    sim.do({ type: 'adjustScore', playerId: pid('Bo'), delta: -100 });
    sim.do({ type: 'adjustScore', playerId: pid('Cy'), delta: 200 });
    sim.skipAll();
    expect(sim.state.phase).toBe('roundEnd');
    sim.do({ type: 'continue' });
    expect(sim.state.phase).toBe('board');
    expect(sim.state.roundIndex).toBe(1);
    expect(sim.state.controlPlayerId).toBe(pid('Bo'));
    expect(sim.state.used).toEqual([
      [false, false],
      [false, false],
    ]);
  });

  it('breaks a tie for lowest score in favor of whoever joined first', () => {
    const sim = Sim.started().skipAll().do({ type: 'continue' });
    expect(sim.state.controlPlayerId).toBe(pid('Ann'));
  });

  it('moves to Final Jeopardy after the last round', () => {
    const sim = Sim.started();
    sim.do({ type: 'adjustScore', playerId: pid('Ann'), delta: 800 });
    sim.do({ type: 'adjustScore', playerId: pid('Bo'), delta: 300 });
    sim.skipAll().do({ type: 'continue' }).skipAll().do({ type: 'continue' });
    expect(sim.state.phase).toBe('finalWager');
    expect(sim.state.final?.eligible).toEqual([pid('Ann'), pid('Bo')]);
  });

  it('goes straight to Final Jeopardy after a one-round board', () => {
    const sim = Sim.started(['Ann'], testBoard({ rounds: 1 }));
    sim.do({ type: 'adjustScore', playerId: pid('Ann'), delta: 100 });
    sim.skipAll().do({ type: 'continue' });
    expect(sim.state.phase).toBe('finalWager');
  });

  it('skips Final Jeopardy when nobody has a positive score', () => {
    const sim = Sim.started(['Ann'], testBoard({ rounds: 1 }))
      .skipAll()
      .do({ type: 'continue' });
    expect(sim.state.phase).toBe('gameOver');
  });

  it('lets the host include everyone in Final Jeopardy', () => {
    const sim = Sim.started(['Ann', 'Bo'], testBoard({ rounds: 1 }));
    sim.do({ type: 'setSettings', settings: { finalIncludeAll: true } });
    sim.skipAll().do({ type: 'continue' });
    expect(sim.state.phase).toBe('finalWager');
    expect(sim.state.final?.eligible).toEqual([pid('Ann'), pid('Bo')]);
    // A player at 0 can only wager 0.
    expect(sim.refused({ type: 'wager', playerId: pid('Ann'), amount: 1 })).toMatch(
      /between 0 and 0/,
    );
    sim.do({ type: 'wager', playerId: pid('Ann'), amount: 0 });
  });
});

describe('pause and host presence', () => {
  it('stops the timer while paused and restarts it with the time that was left', () => {
    const sim = Sim.started().select(0, 0).do({ type: 'openBuzzers' });
    sim.do({ type: 'pause' }, 1000);
    expect(sim.state.deadline).toBeNull();
    expect(sim.state.frozenRemainingMs).toBe(4000);
    expect(evaluateBuzz(sim.state, pid('Ann'), sim.now)).toBe('notOpen');
    expect(sim.refused({ type: 'buzz', playerId: pid('Ann') })).toMatch(/paused/);
    expect(sim.refused({ type: 'timeout' }, 60_000)).toMatch(/paused/);
    sim.do({ type: 'resume' }, 60_000);
    expect(sim.state.deadline).toBe(sim.now + 4000);
    expect(sim.state.frozenRemainingMs).toBeNull();
  });

  it('pauses the game while the host is disconnected and resumes when they return', () => {
    const sim = Sim.started().select(0, 0).do({ type: 'openBuzzers' });
    sim.do({ type: 'hostConnection', connected: false }, 2000);
    expect(sim.state.frozenRemainingMs).toBe(3000);
    expect(sim.refused({ type: 'selectClue', categoryIndex: 1, clueIndex: 0 })).toMatch(/paused/);
    sim.do({ type: 'hostConnection', connected: true }, 30_000);
    expect(sim.state.deadline).toBe(sim.now + 3000);
  });

  it('stays frozen until both the pause and the host absence are over', () => {
    const sim = Sim.started().select(0, 0).do({ type: 'openBuzzers' });
    sim.do({ type: 'pause' }, 1000);
    sim.do({ type: 'hostConnection', connected: false }, 1000);
    sim.do({ type: 'hostConnection', connected: true }, 1000);
    expect(sim.state.deadline).toBeNull();
    sim.do({ type: 'resume' }, 1000);
    expect(sim.state.deadline).toBe(sim.now + 4000);
  });

  it('still lets the host fix scores and kick players while paused', () => {
    const sim = Sim.started();
    sim.do({ type: 'pause' });
    sim.do({ type: 'adjustScore', playerId: pid('Ann'), delta: 100 });
    sim.do({ type: 'kick', playerId: pid('Cy') });
    expect(sim.score('Ann')).toBe(100);
    expect(sim.state.players).toHaveLength(2);
  });

  it('has nothing to pause in the lobby', () => {
    expect(new Sim().refused({ type: 'pause' })).toMatch(/Nothing to pause/);
  });
});

describe('Final Jeopardy', () => {
  function atFinalWager(): Sim {
    const sim = Sim.started(['Ann', 'Bo', 'Cy'], testBoard({ rounds: 1 }));
    sim.do({ type: 'adjustScore', playerId: pid('Ann'), delta: 1000 });
    sim.do({ type: 'adjustScore', playerId: pid('Bo'), delta: 600 });
    sim.skipAll().do({ type: 'continue' });
    return sim;
  }

  it('lets eligible players wager 0 up to their score', () => {
    const sim = atFinalWager();
    expect(sim.state.final?.eligible).toEqual([pid('Ann'), pid('Bo')]);
    expect(sim.refused({ type: 'wager', playerId: pid('Ann'), amount: 1001 })).toMatch(
      /between 0 and 1000/,
    );
    expect(sim.refused({ type: 'wager', playerId: pid('Ann'), amount: -1 })).toMatch(
      /between 0 and 1000/,
    );
    expect(sim.refused({ type: 'wager', playerId: pid('Cy'), amount: 0 })).toMatch(/not in Final/);
    sim.do({ type: 'wager', playerId: pid('Ann'), amount: 700 });
    sim.do({ type: 'wager', playerId: pid('Ann'), amount: 800 });
    expect(sim.state.final?.wagers).toEqual({ [pid('Ann')]: 800 });
  });

  it('runs a 30 second answer timer and locks submissions at the deadline', () => {
    const sim = atFinalWager().do({ type: 'continue' });
    expect(sim.state.phase).toBe('finalAnswer');
    expect(sim.state.deadline).toBe(sim.now + FINAL_ANSWER_MS);

    sim.do({ type: 'finalAnswer', playerId: pid('Ann'), text: '  What is X?  ' }, 5000);
    expect(sim.state.final?.answers[pid('Ann')]).toBe('What is X?');
    expect(sim.refused({ type: 'finalAnswer', playerId: pid('Ann'), text: 'Changed' })).toMatch(
      /already/,
    );
    expect(sim.refused({ type: 'finalAnswer', playerId: pid('Cy'), text: 'Hi' })).toMatch(
      /not in Final/,
    );
    expect(sim.refused({ type: 'finalAnswer', playerId: pid('Bo'), text: '   ' })).toMatch(/Enter/);

    // Bo is a hair too late.
    const deadline = sim.state.deadline ?? 0;
    expect(
      sim.refused({ type: 'finalAnswer', playerId: pid('Bo'), text: 'Late' }, deadline - sim.now),
    ).toMatch(/Time is up/);
    sim.do({ type: 'timeout' });
    expect(sim.state.phase).toBe('finalReveal');
  });

  it('reveals lowest score first, judges one player at a time and applies the wager', () => {
    const sim = atFinalWager();
    sim.do({ type: 'wager', playerId: pid('Ann'), amount: 1000 });
    sim.do({ type: 'wager', playerId: pid('Bo'), amount: 200 });
    sim.do({ type: 'continue' });
    sim.do({ type: 'finalAnswer', playerId: pid('Ann'), text: 'ann answer' }, 1000);
    sim.do({ type: 'finalAnswer', playerId: pid('Bo'), text: 'bo answer' }, 1000);
    sim.do({ type: 'continue' });
    expect(sim.state.final?.order).toEqual([pid('Bo'), pid('Ann')]);

    sim.do({ type: 'finalReveal', playerId: pid('Bo') });
    expect(sim.refused({ type: 'finalReveal', playerId: pid('Ann') })).toMatch(/Judge the current/);
    expect(sim.refused({ type: 'continue' })).toMatch(/Reveal and judge/);
    sim.do({ type: 'finalJudge', playerId: pid('Bo'), correct: true });
    expect(sim.score('Bo')).toBe(800);
    expect(sim.refused({ type: 'finalJudge', playerId: pid('Bo'), correct: false })).toMatch(
      /already/,
    );

    sim.do({ type: 'finalReveal', playerId: pid('Ann') });
    expect(sim.refused({ type: 'finalReveal', playerId: pid('Ann') })).toMatch(/already/);
    sim.do({ type: 'finalJudge', playerId: pid('Ann'), correct: false });
    expect(sim.score('Ann')).toBe(0);

    sim.do({ type: 'continue' });
    expect(sim.state.phase).toBe('gameOver');
  });

  it('treats a missing wager as 0 and a missing answer as blank', () => {
    const sim = atFinalWager().do({ type: 'continue' }).do({ type: 'continue' });
    expect(sim.state.phase).toBe('finalReveal');
    sim.do({ type: 'finalReveal', playerId: pid('Bo') });
    sim.do({ type: 'finalJudge', playerId: pid('Bo'), correct: false });
    expect(sim.score('Bo')).toBe(600);
  });

  it('refuses to judge a player who has not been revealed', () => {
    const sim = atFinalWager().do({ type: 'continue' }).do({ type: 'continue' });
    expect(sim.refused({ type: 'finalJudge', playerId: pid('Ann'), correct: true })).toMatch(
      /not been revealed/,
    );
  });

  it('only accepts wagers during the wager phase', () => {
    const sim = atFinalWager().do({ type: 'continue' });
    expect(sim.refused({ type: 'wager', playerId: pid('Ann'), amount: 1 })).toMatch(/not time/);
  });
});

describe('ending and removing', () => {
  it('lets the host end the game at any point', () => {
    const sim = Sim.started().buzzIn(0, 0, 'Ann');
    sim.do({ type: 'endGame' });
    expect(sim.state.phase).toBe('gameOver');
    expect(sim.state.buzzedPlayerId).toBeNull();
    expect(sim.refused({ type: 'endGame' })).toMatch(/already over/);
  });

  it('adjusts any score by any whole amount', () => {
    const sim = Sim.started();
    sim.do({ type: 'adjustScore', playerId: pid('Bo'), delta: -250 });
    expect(sim.score('Bo')).toBe(-250);
    expect(sim.refused({ type: 'adjustScore', playerId: pid('Bo'), delta: 1.5 })).toMatch(
      /Invalid/,
    );
    expect(sim.refused({ type: 'adjustScore', playerId: 'ghost', delta: 1 })).toMatch(/Unknown/);
  });

  it('reopens the buzzers when the player who buzzed in is kicked', () => {
    const sim = Sim.started().buzzIn(0, 0, 'Bo');
    sim.do({ type: 'kick', playerId: pid('Bo') });
    expect(sim.state.phase).toBe('buzzersOpen');
    expect(sim.state.buzzedPlayerId).toBeNull();
    expect(sim.state.players.map((p) => p.name)).toEqual(['Ann', 'Cy']);
  });

  it('hands control to the lowest scorer when the player in control is kicked', () => {
    const sim = Sim.started();
    sim.do({ type: 'adjustScore', playerId: pid('Bo'), delta: 400 });
    sim.do({ type: 'kick', playerId: pid('Ann') });
    expect(sim.state.controlPlayerId).toBe(pid('Cy'));
  });

  it('skips a Daily Double whose player is kicked', () => {
    const sim = Sim.started().select(0, 1);
    sim.do({ type: 'kick', playerId: pid('Ann') });
    expect(sim.state.phase).toBe('reveal');
    expect(sim.state.wager).toBeNull();
  });

  it('removes a kicked player from Final Jeopardy', () => {
    const sim = Sim.started(['Ann', 'Bo'], testBoard({ rounds: 1 }));
    sim.do({ type: 'adjustScore', playerId: pid('Ann'), delta: 500 });
    sim.do({ type: 'adjustScore', playerId: pid('Bo'), delta: 500 });
    sim.skipAll().do({ type: 'continue' });
    sim.do({ type: 'wager', playerId: pid('Bo'), amount: 100 });
    sim.do({ type: 'kick', playerId: pid('Bo') });
    expect(sim.state.final?.eligible).toEqual([pid('Ann')]);
    expect(sim.state.final?.wagers).toEqual({});
  });
});

describe('purity', () => {
  it('returns the same state for refused actions and never mutates its input', () => {
    const state = createGameState();
    const frozen = Object.freeze({ ...state, players: Object.freeze([]) as never });
    expect(reduce(frozen, { type: 'start' }, 0)).toBe(frozen);
  });
});
