import { describe, expect, it } from 'vitest';
import { routeDepth, slideDirection } from './slide';

describe('routeDepth', () => {
  it('puts the landing page at the top, tools one step in and rooms two', () => {
    expect(routeDepth('/')).toBe(0);
    expect(routeDepth('/editor')).toBe(1);
    expect(routeDepth('/join')).toBe(1);
    expect(routeDepth('/host/ABCD')).toBe(2);
    expect(routeDepth('/display/ABCD')).toBe(2);
    expect(routeDepth('/play/ABCD')).toBe(2);
  });

  it('treats anything else as the top, since it redirects there', () => {
    expect(routeDepth('/nope')).toBe(0);
    expect(routeDepth('')).toBe(0);
  });
});

describe('slideDirection', () => {
  it('slides forward when going from home into the editor, the join form or a room', () => {
    expect(slideDirection('/', '/editor')).toBe('forward');
    expect(slideDirection('/', '/join')).toBe('forward');
    expect(slideDirection('/', '/host/ABCD')).toBe('forward');
  });

  it('slides forward from the editor or the join form into a room', () => {
    expect(slideDirection('/editor', '/host/ABCD')).toBe('forward');
    expect(slideDirection('/join', '/play/ABCD')).toBe('forward');
  });

  it('slides back towards home', () => {
    expect(slideDirection('/editor', '/')).toBe('back');
    expect(slideDirection('/join', '/')).toBe('back');
    expect(slideDirection('/host/ABCD', '/')).toBe('back');
    expect(slideDirection('/play/ABCD', '/join')).toBe('back');
  });

  it('goes forward between screens at the same depth', () => {
    expect(slideDirection('/editor', '/join')).toBe('forward');
  });
});
