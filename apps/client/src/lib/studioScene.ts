/**
 * The prime time studio set, drawn at a quarter of 1920x1080 and scaled up with
 * `image-rendering: pixelated`, so every scene pixel lands as a chunky 4x4 block on the TV.
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
/** Top of the stage lip; the audience sits below it. */
const LIP_Y = SCENE_H - 44;

interface Beam {
  x: number;
  /** "r, g, b" so the alpha can be added per layer. */
  rgb: string;
  /** Radians from straight down, positive to the right. */
  base: number;
  swing: number;
  speed: number;
  phase: number;
}

const BEAMS: Beam[] = [
  { x: 64, rgb: '255, 209, 102', base: 0.5, swing: 0.32, speed: 0.31, phase: 0 },
  { x: 186, rgb: '77, 227, 255', base: 0.12, swing: 0.42, speed: 0.23, phase: 1.7 },
  { x: 294, rgb: '255, 209, 102', base: -0.12, swing: 0.42, speed: 0.27, phase: 3.1 },
  { x: 416, rgb: '255, 93, 143', base: -0.5, swing: 0.32, speed: 0.19, phase: 4.4 },
];

interface Person {
  x: number;
  headR: number;
  shoulderW: number;
  phase: number;
}

/** A row of silhouettes. Seeded, so the same people sit in the same seats every frame. */
function seatRow(seed: number, spacing: number, headR: number): Person[] {
  let state = seed;
  const random = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const people: Person[] = [];
  for (let x = spacing / 2; x < SCENE_W + spacing; x += spacing) {
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

/** Everything behind the content: backdrop, sunburst, lighting truss and, in the lobby, the crowd. */
export function drawBackdrop(ctx: CanvasRenderingContext2D, t: number, audience: boolean) {
  ctx.fillStyle = '#0a0f2e';
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);

  // Slowly turning sunburst behind the set.
  const cx = SCENE_W / 2;
  const cy = SCENE_H * 0.55;
  const wedges = 18;
  const turn = t * 0.03;
  ctx.fillStyle = '#0d1440';
  for (let i = 0; i < wedges; i += 2) {
    const a0 = turn + (i / wedges) * Math.PI * 2;
    const a1 = turn + ((i + 1) / wedges) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a0) * 600, cy + Math.sin(a0) * 600);
    ctx.lineTo(cx + Math.cos(a1) * 600, cy + Math.sin(a1) * 600);
    ctx.closePath();
    ctx.fill();
  }

  // Lighting truss, with a lamp housing for each beam.
  ctx.fillStyle = '#050820';
  ctx.fillRect(0, 0, SCENE_W, TRUSS_H);
  ctx.fillStyle = '#1a2560';
  ctx.fillRect(0, 1, SCENE_W, 1);
  ctx.fillRect(0, TRUSS_H - 2, SCENE_W, 1);
  ctx.fillStyle = '#141d52';
  for (let x = 0; x < SCENE_W; x += 6) {
    for (let k = 0; k < 4; k++) ctx.fillRect(x + k, 2 + k, 1, 1);
  }
  for (const beam of BEAMS) {
    ctx.fillStyle = '#1d2766';
    ctx.fillRect(beam.x - 4, 5, 9, 6);
    ctx.fillStyle = `rgb(${beam.rgb})`;
    ctx.fillRect(beam.x - 2, LAMP_Y - 1, 5, 2);
  }

  if (!audience) return;

  // Stage lip with chasing marquee bulbs.
  ctx.fillStyle = '#070b26';
  ctx.fillRect(0, LIP_Y, SCENE_W, SCENE_H - LIP_Y);
  ctx.fillStyle = '#1b2fd1';
  ctx.fillRect(0, LIP_Y, SCENE_W, 2);
  const step = Math.floor(t * 5);
  for (let i = 0, x = 4; x < SCENE_W; i++, x += 10) {
    ctx.fillStyle = (i + step) % 3 === 0 ? '#ffe9a8' : '#4a3a14';
    ctx.fillRect(x, LIP_Y - 5, 3, 3);
  }

  // Each row is drawn twice, a pixel apart, so the stage lights leave a rim along the top.
  for (const [row, baseY, shoulderH, rim, body] of [
    [BACK_ROW, SCENE_H - 14, 8, '#2a3a8c', '#0f1846'],
    [FRONT_ROW, SCENE_H + 2, 12, '#1c2a70', '#03051a'],
  ] as const) {
    ctx.fillStyle = rim;
    for (const person of row) drawPerson(ctx, person, baseY - 1, shoulderH, t);
    ctx.fillStyle = body;
    for (const person of row) drawPerson(ctx, person, baseY, shoulderH, t);
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
export function aimBeams(angles: number[], t: number, dt: number, target: Point | null) {
  BEAMS.forEach((beam, i) => {
    const goal = target ? Math.atan2(target.x - beam.x, target.y - LAMP_Y) : idleAngle(beam, t);
    const angle = angles[i] ?? goal;
    angles[i] = angle + (goal - angle) * Math.min(1, dt * 4);
  });
}

/** Spotlight cones, drawn on their own canvas that is screen-blended over the content. */
export function drawBeams(ctx: CanvasRenderingContext2D, angles: number[]) {
  ctx.clearRect(0, 0, SCENE_W, SCENE_H);
  const length = 360;
  BEAMS.forEach((beam, i) => {
    const angle = angles[i] ?? beam.base;
    for (const [spread, alpha] of [
      [0.12, 0.07],
      [0.05, 0.08],
    ] as const) {
      ctx.fillStyle = `rgba(${beam.rgb}, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(beam.x, LAMP_Y);
      ctx.lineTo(
        beam.x + Math.sin(angle - spread) * length,
        LAMP_Y + Math.cos(angle - spread) * length,
      );
      ctx.lineTo(
        beam.x + Math.sin(angle + spread) * length,
        LAMP_Y + Math.cos(angle + spread) * length,
      );
      ctx.closePath();
      ctx.fill();
    }
  });
}
