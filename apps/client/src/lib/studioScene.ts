/**
 * The prime time studio set, drawn at a quarter of the screen's size and scaled up with
 * `image-rendering: pixelated`, so every scene pixel lands as a chunky 4x4 block. The display
 * stage is always 1920x1080, which makes its scene 480x270; elsewhere the scene matches the
 * window, so everything here works from the canvas's own size.
 */
export const SCENE_SCALE = 4;
export const SCENE_W = 1920 / SCENE_SCALE;
export const SCENE_H = 1080 / SCENE_SCALE;

export interface Point {
  x: number;
  y: number;
}

const TRUSS_H = 8;
/** Where the beams leave the lamps. */
const LAMP_Y = 11;
/** How far above the bottom edge the stage lip sits; the audience is below it. */
const LIP_FROM_BOTTOM = 44;

interface Beam {
  /** Across the truss, as a fraction of the width. */
  at: number;
  /** "r, g, b" so the alpha can be added per layer. */
  rgb: string;
  /** Radians from straight down, positive to the right. */
  base: number;
  swing: number;
  speed: number;
  phase: number;
}

const BEAMS: Beam[] = [
  { at: 0.133, rgb: '255, 209, 102', base: 0.5, swing: 0.32, speed: 0.31, phase: 0 },
  { at: 0.388, rgb: '77, 227, 255', base: 0.12, swing: 0.42, speed: 0.23, phase: 1.7 },
  { at: 0.613, rgb: '255, 209, 102', base: -0.12, swing: 0.42, speed: 0.27, phase: 3.1 },
  { at: 0.867, rgb: '255, 93, 143', base: -0.5, swing: 0.32, speed: 0.19, phase: 4.4 },
];

function lampX(beam: Beam, width: number): number {
  return Math.round(beam.at * width);
}

interface Person {
  x: number;
  headR: number;
  shoulderW: number;
  phase: number;
}

/** Wide enough for any screen; rows are cut to the canvas width when drawn. */
const MAX_SCENE_W = 1200;

/** A row of silhouettes. Seeded, so the same people sit in the same seats every frame. */
function seatRow(seed: number, spacing: number, headR: number): Person[] {
  let state = seed;
  const random = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const people: Person[] = [];
  for (let x = spacing / 2; x < MAX_SCENE_W + spacing; x += spacing) {
    const r = headR + (random() < 0.3 ? 1 : 0);
    people.push({
      x: Math.round(x + random() * 4 - 2),
      headR: r,
      shoulderW: Math.round(r * 3 + random() * 4),
      phase: random() * Math.PI * 2,
    });
  }
  return people;
}

const BACK_ROW = seatRow(7, 16, 4);
const FRONT_ROW = seatRow(19, 22, 6);

function drawPerson(
  ctx: CanvasRenderingContext2D,
  person: Person,
  baseY: number,
  shoulderH: number,
  t: number,
) {
  // Mostly still, with the odd fidget.
  const y = baseY - (Math.sin(t * 1.3 + person.phase) > 0.85 ? 1 : 0);
  const left = person.x - Math.floor(person.shoulderW / 2);
  ctx.fillRect(left + 2, y - shoulderH, person.shoulderW - 4, 2);
  ctx.fillRect(left, y - shoulderH + 2, person.shoulderW, shoulderH - 2);
  ctx.beginPath();
  ctx.arc(person.x, y - shoulderH - person.headR + 1, person.headR, 0, Math.PI * 2);
  ctx.fill();
}

/** Everything behind the content: backdrop, sunburst, lighting truss and, optionally, the crowd. */
export function drawBackdrop(ctx: CanvasRenderingContext2D, t: number, audience: boolean) {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = '#0a0f2e';
  ctx.fillRect(0, 0, width, height);

  // Slowly turning sunburst behind the set.
  const cx = width / 2;
  const cy = height * 0.55;
  const reach = Math.hypot(width, height);
  const wedges = 18;
  const turn = t * 0.03;
  ctx.fillStyle = '#0d1440';
  for (let i = 0; i < wedges; i += 2) {
    const a0 = turn + (i / wedges) * Math.PI * 2;
    const a1 = turn + ((i + 1) / wedges) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a0) * reach, cy + Math.sin(a0) * reach);
    ctx.lineTo(cx + Math.cos(a1) * reach, cy + Math.sin(a1) * reach);
    ctx.closePath();
    ctx.fill();
  }

  // Lighting truss, with a lamp housing for each beam.
  ctx.fillStyle = '#050820';
  ctx.fillRect(0, 0, width, TRUSS_H);
  ctx.fillStyle = '#1a2560';
  ctx.fillRect(0, 1, width, 1);
  ctx.fillRect(0, TRUSS_H - 2, width, 1);
  ctx.fillStyle = '#141d52';
  for (let x = 0; x < width; x += 6) {
    for (let k = 0; k < 4; k++) ctx.fillRect(x + k, 2 + k, 1, 1);
  }
  for (const beam of BEAMS) {
    const x = lampX(beam, width);
    ctx.fillStyle = '#1d2766';
    ctx.fillRect(x - 4, 5, 9, 6);
    ctx.fillStyle = `rgb(${beam.rgb})`;
    ctx.fillRect(x - 2, LAMP_Y - 1, 5, 2);
  }

  if (!audience) return;

  // Stage lip with chasing marquee bulbs.
  const lipY = height - LIP_FROM_BOTTOM;
  ctx.fillStyle = '#070b26';
  ctx.fillRect(0, lipY, width, height - lipY);
  ctx.fillStyle = '#1b2fd1';
  ctx.fillRect(0, lipY, width, 2);
  const step = Math.floor(t * 5);
  for (let i = 0, x = 4; x < width; i++, x += 10) {
    ctx.fillStyle = (i + step) % 3 === 0 ? '#ffe9a8' : '#4a3a14';
    ctx.fillRect(x, lipY - 5, 3, 3);
  }

  // Each row is drawn twice, a pixel apart, so the stage lights leave a rim along the top.
  for (const [row, baseY, shoulderH, rim, body] of [
    [BACK_ROW, height - 14, 8, '#2a3a8c', '#0f1846'],
    [FRONT_ROW, height + 2, 12, '#1c2a70', '#03051a'],
  ] as const) {
    const seated = row.filter((person) => person.x < width + 20);
    ctx.fillStyle = rim;
    for (const person of seated) drawPerson(ctx, person, baseY - 1, shoulderH, t);
    ctx.fillStyle = body;
    for (const person of seated) drawPerson(ctx, person, baseY, shoulderH, t);
  }
}

function idleAngle(beam: Beam, t: number): number {
  return beam.base + beam.swing * Math.sin(t * beam.speed + beam.phase);
}

/**
 * Where each beam points at time `t` when nothing is in the spotlight. The sweep only depends
 * on the clock, so a new scene picks up exactly where the last one left off.
 */
export function idleBeamAngles(t: number): number[] {
  return BEAMS.map((beam) => idleAngle(beam, t));
}

/** Eases each beam toward its idle sweep or, given a target in scene pixels, onto the target. */
export function aimBeams(
  angles: number[],
  t: number,
  dt: number,
  target: Point | null,
  width: number,
) {
  BEAMS.forEach((beam, i) => {
    const goal = target
      ? Math.atan2(target.x - lampX(beam, width), target.y - LAMP_Y)
      : idleAngle(beam, t);
    const angle = angles[i] ?? goal;
    angles[i] = angle + (goal - angle) * Math.min(1, dt * 4);
  });
}

/** Spotlight cones, drawn on their own canvas that is screen-blended over the content. */
export function drawBeams(ctx: CanvasRenderingContext2D, angles: number[]) {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  const length = Math.hypot(width, height) * 1.2;
  BEAMS.forEach((beam, i) => {
    const x = lampX(beam, width);
    const angle = angles[i] ?? beam.base;
    for (const [spread, alpha] of [
      [0.12, 0.07],
      [0.05, 0.08],
    ] as const) {
      ctx.fillStyle = `rgba(${beam.rgb}, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(x, LAMP_Y);
      ctx.lineTo(x + Math.sin(angle - spread) * length, LAMP_Y + Math.cos(angle - spread) * length);
      ctx.lineTo(x + Math.sin(angle + spread) * length, LAMP_Y + Math.cos(angle + spread) * length);
      ctx.closePath();
      ctx.fill();
    }
  });
}
