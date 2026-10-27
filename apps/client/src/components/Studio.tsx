import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { SCENE_H, SCENE_W, drawBackdrop, drawBeams } from '../lib/studioScene';

/**
 * The prime time studio: a pixel-art set behind the content, spotlights washing over it, and a
 * CRT finish on top. Fills its parent, which is the 1920x1080 display stage.
 */
export function Studio({
  audience = false,
  children,
}: {
  audience?: boolean;
  children: ReactNode;
}) {
  const backRef = useRef<HTMLCanvasElement>(null);
  const beamRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const back = backRef.current?.getContext('2d');
    const beams = beamRef.current?.getContext('2d');
    if (!back || !beams) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    const draw = (now: number) => {
      const t = now / 1000;
      drawBackdrop(back, t, audience);
      drawBeams(beams, t);
      if (!still) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [audience]);

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
      <div className="studio-vignette pointer-events-none absolute inset-0 z-30" />
      <div className="studio-scanlines pointer-events-none absolute inset-0 z-30" />
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
