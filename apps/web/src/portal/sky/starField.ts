// @license Adapted from ascii.rest: after https://7331.org, whose stars are the aurora piece (bas3line, MIT; licence in apps/web/src/portal/sky/LICENSE.ascii-rest); modified by Portal since 2026-10-29 and by T3 Code since 2026-11-12.
export interface Star {
  readonly column: number;
  readonly row: number;
  readonly bright: boolean;
  readonly rate: number;
  readonly phase: number;
  readonly depth: number;
}

export interface StarFrame {
  readonly glyph: string;
  readonly alpha: number;
  readonly driftColumns: number;
  readonly driftRows: number;
}

export interface FieldOptions {
  readonly columns: number;
  readonly rows: number;
  readonly cellsPerStar: number;
  readonly seed: number;
}

const TAU = Math.PI * 2;
const BRIGHT_SHARE = 0.16;
const TWINKLE_RATE = { min: 0.25, span: 0.55 } as const;
const BRIGHT_FLIP = 0.3;
const DIM_DARK = -0.6;
const UINT32_RANGE = 4294967296;
const DRIFT = { columns: -0.11, rows: 0.025 } as const;
const FAR_DRIFT_SHARE = 0.25;

function createRandom(seed: number): () => number {
  let state = Math.floor(seed * UINT32_RANGE) | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

export function sowStars({ columns, rows, cellsPerStar, seed }: FieldOptions): Star[] {
  const random = createRandom(seed);
  const taken = new Set<number>();
  const stars: Star[] = [];
  for (let count = Math.round((columns * rows) / cellsPerStar); count > 0; count -= 1) {
    const column = Math.floor(random() * columns);
    const row = Math.floor(random() * rows);
    const cell = row * columns + column;
    const bright = random() < BRIGHT_SHARE;
    const rate = TWINKLE_RATE.min + random() * TWINKLE_RATE.span;
    const phase = random() * TAU;
    const depth = random();
    if (taken.has(cell)) continue;
    taken.add(cell);
    stars.push({ column, row, bright, rate, phase, depth });
  }
  return stars;
}

export function starFrame(star: Star, seconds: number): StarFrame {
  const twinkle = Math.sin(seconds * star.rate * TAU + star.phase);
  const speed = FAR_DRIFT_SHARE + (1 - FAR_DRIFT_SHARE) * star.depth;
  const driftColumns = seconds * DRIFT.columns * speed;
  const driftRows = seconds * DRIFT.rows * speed;
  const level = (twinkle + 1) / 2;
  if (star.bright) {
    const glyph = twinkle > 0.85 ? "*" : twinkle > BRIGHT_FLIP ? "+" : "·";
    return { glyph, alpha: 0.45 + 0.55 * level, driftColumns, driftRows };
  }
  const alpha = twinkle > DIM_DARK ? (0.25 + 0.6 * level) * (0.6 + 0.4 * star.depth) : 0;
  return { glyph: ".", alpha, driftColumns, driftRows };
}
