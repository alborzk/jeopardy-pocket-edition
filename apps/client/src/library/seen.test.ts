import { describe, expect, it } from 'vitest';
import {
  MAX_SEEN,
  clearSeen,
  clueKey,
  countSeen,
  loadAvoidSeen,
  loadSeen,
  markSeen,
  saveAvoidSeen,
} from './seen';
import { memoryStore } from './test-utils';

describe('clueKey', () => {
  it('is stable, and ignores case and spacing', () => {
    expect(clueKey('Famous Actors', 'Who played Neo?')).toBe(
      clueKey('  famous   actors ', 'who played   neo?'),
    );
  });

  it('tells categories and clues apart', () => {
    const keys = new Set([
      clueKey('Famous Actors', 'one'),
      clueKey('Famous Actors', 'two'),
      clueKey('Name That Movie', 'one'),
    ]);
    expect(keys.size).toBe(3);
  });

  it('does not let a category and clue blur together', () => {
    expect(clueKey('ab', 'c')).not.toBe(clueKey('a', 'bc'));
  });
});

describe('the seen memory', () => {
  it('remembers what was played and when', () => {
    const store = memoryStore();
    markSeen('Sports', 'a clue', 1000, store);
    markSeen('Sports', 'another', 2000, store);
    const seen = loadSeen(store);
    expect(seen[clueKey('Sports', 'a clue')]).toBe(1000);
    expect(seen[clueKey('Sports', 'another')]).toBe(2000);
    expect(countSeen(store)).toBe(2);
  });

  it('moves a clue to the new time when it is played again', () => {
    const store = memoryStore();
    markSeen('Sports', 'a clue', 1000, store);
    markSeen('Sports', 'a clue', 5000, store);
    expect(loadSeen(store)[clueKey('Sports', 'a clue')]).toBe(5000);
    expect(countSeen(store)).toBe(1);
  });

  it('can be cleared', () => {
    const store = memoryStore();
    markSeen('Sports', 'a clue', 1000, store);
    clearSeen(store);
    expect(countSeen(store)).toBe(0);
  });

  it('survives corrupt or odd saved data', () => {
    expect(loadSeen(memoryStore({ 'jeepy.seenClues.v1': '{not json' }))).toEqual({});
    expect(loadSeen(memoryStore({ 'jeepy.seenClues.v1': '[1,2,3]' }))).toEqual({});
    expect(loadSeen(memoryStore({ 'jeepy.seenClues.v1': '{"a":1,"b":"x"}' }))).toEqual({ a: 1 });
  });

  it('keeps the newest entries when it grows past its cap', () => {
    const full = Object.fromEntries(Array.from({ length: MAX_SEEN }, (_, i) => [`k${i}`, i + 10]));
    const store = memoryStore({ 'jeepy.seenClues.v1': JSON.stringify(full) });
    markSeen('Sports', 'fresh', 99999, store);
    const seen = loadSeen(store);
    expect(Object.keys(seen)).toHaveLength(MAX_SEEN);
    expect(seen[clueKey('Sports', 'fresh')]).toBe(99999);
    expect(seen['k0']).toBeUndefined();
    expect(seen[`k${MAX_SEEN - 1}`]).toBeDefined();
  });

  it('works without any storage at all', () => {
    expect(() => markSeen('Sports', 'a clue', 1, null)).not.toThrow();
    expect(loadSeen(null)).toEqual({});
    expect(countSeen(null)).toBe(0);
  });
});

describe('the avoid-seen setting', () => {
  it('is on until switched off', () => {
    const store = memoryStore();
    expect(loadAvoidSeen(store)).toBe(true);
    saveAvoidSeen(false, store);
    expect(loadAvoidSeen(store)).toBe(false);
    saveAvoidSeen(true, store);
    expect(loadAvoidSeen(store)).toBe(true);
  });
});
