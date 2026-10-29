import { useCallback, useLayoutEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { NavigateOptions } from 'react-router-dom';

export type SlideDirection = 'forward' | 'back';

/**
 * How far into the app a screen is. The landing page is 0, the editor and the join form are one
 * step in, and a room (host, display or player) is two.
 */
export function routeDepth(pathname: string): number {
  switch (pathname.split('/')[1]) {
    case 'editor':
    case 'join':
      return 1;
    case 'host':
    case 'display':
    case 'play':
      return 2;
    default:
      return 0;
  }
}

/** Going deeper slides the new screen in from the right. Going back brings it in from the left. */
export function slideDirection(from: string, to: string): SlideDirection {
  return routeDepth(to) < routeDepth(from) ? 'back' : 'forward';
}

// Resolves once the new screen is on the page, which is when the browser takes its "after" picture.
let arrived: (() => void) | null = null;
let slides = 0;

/**
 * Run `go` (which changes the screen) inside a browser view transition, so index.css can slide the
 * page. Where the browser can't, or the user asked for less motion, it just runs `go`.
 */
function startSlide(direction: SlideDirection, go: () => void): void {
  const canSlide =
    typeof document.startViewTransition === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!canSlide) {
    go();
    return;
  }

  const root = document.documentElement;
  const id = ++slides;
  root.dataset.slide = direction;
  const transition = document.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        arrived = resolve;
        go();
        // If the screen never changes, don't leave the page frozen waiting for it.
        window.setTimeout(resolve, 1000);
      }),
  );
  // A newer slide may have started since. Only clean up after the latest.
  void transition.finished.finally(() => {
    if (slides === id) delete root.dataset.slide;
  });
}

/** Like `navigate`, but slides to the new screen. Takes a plain path. */
export function useSlideNavigate(): (to: string, options?: NavigateOptions) => void {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return useCallback(
    (to, options) => {
      const target = to.split(/[?#]/)[0] ?? to;
      if (target === pathname) {
        navigate(to, options);
        return;
      }
      startSlide(slideDirection(pathname, target), () => navigate(to, options));
    },
    [navigate, pathname],
  );
}

/** Call once inside the router. Tells a slide in progress that the new screen is in place. */
export function useSlideArrival(): void {
  const location = useLocation();
  useLayoutEffect(() => {
    arrived?.();
    arrived = null;
  }, [location]);
}
