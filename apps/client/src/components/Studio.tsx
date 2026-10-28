import { useEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import {
  SCENE_H,
  SCENE_SCALE,
  SCENE_W,
  aimBeams,
  drawBackdrop,
  drawBeams,
  idleBeamAngles,
} from '../lib/studioScene';
import type { Point } from '../lib/studioScene';

/**
 * Runs the studio scene on two canvases: the set behind the content and the spotlights
 * screen-blended over it. `fitWindow` sizes the canvases to the window instead of leaving them
 * at the display stage's fixed size. `spotlight` is in CSS pixels of the scene's box.
 */
function useStudioScene(
  backRef: RefObject<HTMLCanvasElement | null>,
  beamRef: RefObject<HTMLCanvasElement | null>,
  {
    audience,
    spotlight,
    fitWindow,
  }: { audience: boolean; spotlight: Point | null; fitWindow: boolean },
) {
  const target = useRef<Point | null>(null);
  const spotX = spotlight?.x ?? null;
  const spotY = spotlight?.y ?? null;
  useEffect(() => {
    target.current =
      spotX === null || spotY === null ? null : { x: spotX / SCENE_SCALE, y: spotY / SCENE_SCALE };
  }, [spotX, spotY]);

  useEffect(() => {
    const back = backRef.current?.getContext('2d');
    const beams = beamRef.current?.getContext('2d');
    if (!back || !beams) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    let angles: number[] | null = null;
    let last: number | null = null;

    const draw = (now: number) => {
      const t = now / 1000;
      angles ??= idleBeamAngles(t);
      aimBeams(angles, t, last === null ? 0 : t - last, target.current, back.canvas.width);
      last = t;
      drawBackdrop(back, t, audience);
      drawBeams(beams, angles);
      if (!still) frame = requestAnimationFrame(draw);
    };

    const fit = () => {
      const width = Math.ceil(window.innerWidth / SCENE_SCALE);
      const height = Math.ceil(window.innerHeight / SCENE_SCALE);
      for (const canvas of [back.canvas, beams.canvas]) {
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
      }
      // Resizing clears a canvas, so a still scene has to be drawn again.
      if (still) draw(performance.now());
    };

    if (fitWindow) {
      fit();
      window.addEventListener('resize', fit);
    }
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', fit);
    };
  }, [backRef, beamRef, audience, fitWindow]);
}

/**
 * The prime time studio on the 1920x1080 display stage: a pixel-art set behind the content and
 * spotlights washing over it. Fills its parent.
 */
export function Studio({
  audience = false,
  spotlight = null,
  children,
}: {
  audience?: boolean;
  /** A point in stage pixels for every spotlight to swing onto. */
  spotlight?: Point | null;
  children: ReactNode;
}) {
  const backRef = useRef<HTMLCanvasElement>(null);
  const beamRef = useRef<HTMLCanvasElement>(null);
  useStudioScene(backRef, beamRef, { audience, spotlight, fitWindow: false });

  return (
    <div className="relative h-full w-full overflow-hidden bg-studio">
      <canvas
        ref={backRef}
        width={SCENE_W}
        height={SCENE_H}
        className="pixel-canvas absolute inset-0 h-full w-full"
      />
      <div className="relative z-10 h-full">{children}</div>
      <canvas
        ref={beamRef}
        width={SCENE_W}
        height={SCENE_H}
        className="pixel-canvas pointer-events-none absolute inset-0 z-20 h-full w-full mix-blend-screen"
      />
    </div>
  );
}

/**
 * The studio as a full-window backdrop for an ordinary scrolling page. The set stays put while
 * the content scrolls over it.
 */
export function StudioBackdrop({
  audience = false,
  children,
}: {
  audience?: boolean;
  children: ReactNode;
}) {
  const backRef = useRef<HTMLCanvasElement>(null);
  const beamRef = useRef<HTMLCanvasElement>(null);
  useStudioScene(backRef, beamRef, { audience, spotlight: null, fitWindow: true });

  return (
    <div className="relative min-h-full">
      <canvas ref={backRef} className="pixel-canvas fixed inset-0 h-full w-full" />
      <div className="relative z-10 min-h-full">{children}</div>
      <canvas
        ref={beamRef}
        className="pixel-canvas pointer-events-none fixed inset-0 z-20 h-full w-full mix-blend-screen"
      />
    </div>
  );
}

/** Points spaced evenly around a rectangle's edge, clockwise from the top-left corner. */
function perimeter(width: number, height: number, spacing: number): [number, number][] {
  const across = Math.max(1, Math.round(width / spacing));
  const down = Math.max(1, Math.round(height / spacing));
  const dx = width / across;
  const dy = height / down;
  const points: [number, number][] = [];
  for (let i = 0; i < across; i++) points.push([i * dx, 0]);
  for (let i = 0; i < down; i++) points.push([width, i * dy]);
  for (let i = 0; i < across; i++) points.push([width - i * dx, height]);
  for (let i = 0; i < down; i++) points.push([0, height - i * dy]);
  return points;
}

/** Chasing marquee bulbs around the edge of a box of known size. Put it in a relative parent. */
export function MarqueeBulbs({
  width,
  height,
  spacing = 40,
}: {
  width: number;
  height: number;
  spacing?: number;
}) {
  return (
    <>
      {perimeter(width, height, spacing).map(([x, y], i) => (
        <span
          key={i}
          aria-hidden
          className="bulb"
          style={{ left: x - 7, top: y - 7, animationDelay: `${-(i % 3) * 0.4}s` }}
        />
      ))}
    </>
  );
}

/**
 * The show title, letters bobbing out of step like a marquee sign. Size it with `className`.
 * Each word is one unbreakable box, so a narrow screen wraps between words, never inside one.
 */
export function MarqueeTitle({ text, className = '' }: { text: string; className?: string }) {
  let letter = 0;
  return (
    <h1
      className={`studio-flicker font-pixel uppercase leading-[1.15] text-bulb chroma-text ${className}`}
    >
      {text.split(' ').map((word, w) => (
        <span key={w}>
          {w > 0 ? ' ' : null}
          <span className="inline-block whitespace-nowrap">
            {[...word].map((char) => {
              const i = letter++;
              return (
                <span key={i} className="studio-bob" style={{ animationDelay: `${i * -0.18}s` }}>
                  {char}
                </span>
              );
            })}
          </span>
        </span>
      ))}
    </h1>
  );
}

export function BlinkingCursor() {
  return <span className="studio-blink">_</span>;
}

/** Marks a Daily Double tile for the host. Put it in a relative parent. */
export function DailyDoubleBadge() {
  return (
    <span
      title="Daily Double"
      className="absolute right-1 top-1 bg-neon-pink px-1 py-0.5 font-pixel text-[9px] leading-none text-white"
    >
      DD
    </span>
  );
}

/** A small pixel triangle pointing right, for whoever is in control. */
export function ControlMarker({ className = '' }: { className?: string }) {
  return (
    <span
      aria-label="In control"
      className={`inline-block h-0 w-0 shrink-0 border-y-[0.4em] border-l-[0.55em] border-y-transparent border-l-bulb ${className}`}
    />
  );
}
