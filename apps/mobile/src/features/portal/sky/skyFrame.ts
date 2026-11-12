import { starFrame, type Star } from "@t3tools/shared/ambientSky/starField";

const SKY_INK_LEVELS = 4;
const CLEAR_PAD = 24;
const CLEAR_FEATHER = 40;
const SEGMENT_SEPARATOR = "\u0001";

export interface SkyGridLayout {
  readonly columns: number;
  readonly rows: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly left: number;
  readonly top: number;
}

export interface SkyRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SkySegment {
  readonly level: number;
  readonly text: string;
}

/** How much of each cell's ink survives, 1 in open sky and 0 under text the sky keeps clear of. */
export function measureSkyClearance(
  layout: SkyGridLayout,
  options: { readonly rects: ReadonlyArray<SkyRect> },
): Float32Array {
  const { columns, rows, cellWidth, cellHeight, left, top } = layout;
  const room = new Float32Array(columns * rows).fill(1);
  for (const rect of options.rects) {
    if (rect.width === 0 || rect.height === 0) continue;
    const rectLeft = rect.x - CLEAR_PAD;
    const rectRight = rect.x + rect.width + CLEAR_PAD;
    const rectTop = rect.y - CLEAR_PAD;
    const rectBottom = rect.y + rect.height + CLEAR_PAD;
    for (let row = 0; row < rows; row += 1) {
      const y = top + (row + 0.5) * cellHeight;
      const distanceY = Math.max(rectTop - y, 0, y - rectBottom);
      if (distanceY >= CLEAR_FEATHER) continue;
      for (let column = 0; column < columns; column += 1) {
        const x = left + (column + 0.5) * cellWidth;
        const distance = Math.hypot(Math.max(rectLeft - x, 0, x - rectRight), distanceY);
        const index = row * columns + column;
        room[index] = Math.min(room[index] ?? 1, Math.min(1, distance / CLEAR_FEATHER));
      }
    }
  }
  return room;
}

function inkLevel(alpha: number): number {
  return Math.min(SKY_INK_LEVELS, Math.round(alpha * SKY_INK_LEVELS));
}

/**
 * One string per row that encodes its runs of glyphs at the same ink level, so an unchanged row
 * keeps the same primitive key between frames and React skips it.
 */
export function paintSkyRows(
  layout: Pick<SkyGridLayout, "columns" | "rows">,
  options: {
    readonly clearance: Float32Array;
    readonly wind: ReadonlyArray<string> | null;
    readonly stars: ReadonlyArray<Star>;
    readonly seconds: number;
  },
): ReadonlyArray<string> {
  const { columns, rows } = layout;
  const glyphs = new Array<string>(columns * rows).fill(" ");
  const levels = new Uint8Array(columns * rows);
  const plot = (column: number, row: number, glyph: string, alpha: number): void => {
    const index = row * columns + column;
    const level = inkLevel(alpha * (options.clearance[index] ?? 1));
    if (level === 0) return;
    glyphs[index] = glyph;
    levels[index] = level;
  };
  options.wind?.forEach((line, row) => {
    for (let column = 0; column < Math.min(line.length, columns); column += 1) {
      const glyph = line[column];
      if (glyph !== undefined && glyph !== " ") plot(column, row, glyph, 1);
    }
  });
  for (const star of options.stars) {
    const frame = starFrame(star, options.seconds);
    if (frame.alpha <= 0) continue;
    const column = Math.floor((((star.column + frame.driftColumns) % columns) + columns) % columns);
    const row = Math.floor((((star.row + frame.driftRows) % rows) + rows) % rows);
    plot(column, row, frame.glyph, frame.alpha);
  }

  const painted: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    const segments: string[] = [];
    let level = 0;
    let text = "";
    let pendingSpaces = "";
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      const cellLevel = levels[index] ?? 0;
      if (cellLevel === 0) {
        pendingSpaces += " ";
        continue;
      }
      if (cellLevel !== level && text !== "") {
        segments.push(`${level}${text}`);
        text = "";
      }
      level = cellLevel;
      text += pendingSpaces + (glyphs[index] ?? " ");
      pendingSpaces = "";
    }
    if (text !== "") segments.push(`${level}${text}`);
    painted.push(segments.join(SEGMENT_SEPARATOR));
  }
  return painted;
}

export function readSkyRow(painted: string): ReadonlyArray<SkySegment> {
  if (painted === "") return [];
  return painted.split(SEGMENT_SEPARATOR).map((segment) => ({
    level: Number(segment[0]),
    text: segment.slice(1),
  }));
}
