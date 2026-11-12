// @license Adapted from ascii.rest: the "wind" piece (https://github.com/bas3line/ascii, src/pieces/wind.ts) (bas3line, MIT; licence in packages/shared/src/ambientSky/LICENSE.ascii-rest); modified by Portal since 2026-10-29 and by T3 Code since 2026-11-12.
const GAP = 4;
const BAR = "▔─▁";
const END = "'·.";
const MINIMUM = 10;
const TIP = 14;
const CURL = 16;
const MAXIMUM_CURLS = 2;
const FLAT = 4;
const EDGE = 12;
const EDGE_ON_CELLS = 10;
const GUST = 0.62;
const UINT32_RANGE = 4294967296;

function hash(x: number, y: number, z: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x2545f491);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / UINT32_RANGE;
}

function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

function mix(left: number, right: number, t: number): number {
  return left + (right - left) * t;
}

function noise(x: number, y: number, z: number): number {
  const index = Math.floor(x);
  const j = Math.floor(y);
  const k = Math.floor(z);
  const u = ease(x - index);
  const v = ease(y - j);
  const w = ease(z - k);
  const n = (left: number, right: number, c: number): number =>
    hash(index + left, j + right, k + c);
  return mix(
    mix(mix(n(0, 0, 0), n(1, 0, 0), u), mix(n(0, 1, 0), n(1, 1, 0), u), v),
    mix(mix(n(0, 0, 1), n(1, 0, 1), u), mix(n(0, 1, 1), n(1, 1, 1), u), v),
    w,
  );
}

function psi(x: number, y: number, t: number): number {
  return (
    y +
    5 *
      (noise(x * 0.04 - t * 0.05, y * 0.18, t * 0.02) +
        0.35 * noise(x * 0.07 + 4, y * 0.4, t * 0.04))
  );
}

interface Streamline {
  readonly mask: Uint8Array;
  readonly spans: (readonly [number, number])[];
  readonly row: Int16Array;
  readonly cells: number[];
}

export function windRows(columns: number, rows: number, seconds: number): string[] {
  const grid = Array.from({ length: rows }, () => new Array<string>(columns).fill(" "));
  const put = (row: number, column: number, glyph: string): void => {
    const line = grid[row];
    if (line !== undefined && column >= 0 && column < columns) line[column] = glyph;
  };
  const at = (row: number, column: number): string => grid[row]?.[column] ?? "";
  const free = (row: number, column: number): boolean => at(row, column) === " ";

  const gusts = (k: number): Streamline => {
    const mask = new Uint8Array(columns);
    const spans: (readonly [number, number])[] = [];
    for (let column = 0, from = -1; column <= columns; column += 1) {
      const edge = Math.min(1, (column + 1) / EDGE, (columns - column) / EDGE);
      const on =
        column < columns &&
        noise(column * 0.09 - seconds * 0.5, k * 1.7, seconds * 0.05) * edge > GUST;
      if (on && from < 0) from = column;
      if (!on && from >= 0) {
        if (column - from >= MINIMUM) {
          mask.fill(2, from, column);
          if (column - from >= TIP) mask[from] = 1;
          spans.push([from, column - 1]);
        }
        from = -1;
      }
    }
    return { mask, spans, row: new Int16Array(columns).fill(-1), cells: [] };
  };

  const lines = new Map<number, Streamline>();
  for (let column = 0; column < columns; column += 1) {
    let was = Math.floor(psi(column + 0.5, 0, seconds) / GAP);
    for (let third = 0; third < rows * 3; third += 1) {
      const now = Math.floor(psi(column + 0.5, (third + 1) / 3, seconds) / GAP);
      const k = Math.max(now, was);
      const same = now === was;
      was = now;
      if (same) continue;
      let line = lines.get(k);
      if (line === undefined) {
        line = gusts(k);
        lines.set(k, line);
      }
      const row = Math.floor(third / 3);
      if ((line.row[column] ?? -1) < 0) line.row[column] = row;
      const on = line.mask[column] ?? 0;
      if (on > 0) {
        put(row, column, (on === 1 ? END : BAR)[third % 3] ?? " ");
        line.cells.push(column, row);
      }
    }
  }

  for (const line of lines.values()) {
    const { cells } = line;
    let index = 0;
    for (const [from, to] of line.spans) {
      while (index < cells.length && (cells[index] ?? 0) < from) index += 2;
      let end = index;
      while (end < cells.length && (cells[end] ?? 0) <= to) end += 2;
      if (end - index <= EDGE_ON_CELLS)
        for (let cell = index; cell < end; cell += 2)
          put(cells[cell + 1] ?? -1, cells[cell] ?? -1, " ");
      index = end;
    }
  }

  const heads: [number, number, number][] = [];
  for (const [k, line] of lines) {
    for (const [from, to] of line.spans)
      if (to - from + 1 >= CURL && (line.row[to] ?? -1) >= 0) heads.push([to - from, k, to]);
  }
  heads.sort((left, right) => right[0] - left[0]);
  const curls: [number, number][] = [];
  const room = (row: number, to: number, direction: number): boolean => {
    if (!free(row + direction, to - 2) || !free(row, to + 1)) return false;
    for (const near of [row + direction, row + 2 * direction]) {
      for (let column = to - 5; column <= to + 2; column += 1) {
        if (near >= 0 && near < rows && column >= 0 && column < columns && at(near, column) !== " ")
          return false;
      }
    }
    return true;
  };
  for (const [, k, to] of heads) {
    const line = lines.get(k);
    if (line === undefined) continue;
    const row = line.row[to] ?? -1;
    const direction = k % 2 !== 0 ? 1 : -1;
    if (
      curls.length >= MAXIMUM_CURLS ||
      to < FLAT + 2 ||
      row + direction < 0 ||
      row + direction >= rows
    )
      continue;
    let level = true;
    for (let column = to - FLAT; column < to; column += 1)
      if (line.row[column] !== row || !BAR.includes(at(row, column))) level = false;
    if (!level || !room(row, to, direction)) continue;
    if (
      curls.some(
        ([curlRow, curlColumn]) => Math.abs(curlRow - row) < 5 && Math.abs(curlColumn - to) < 16,
      )
    )
      continue;
    curls.push([row, to]);
    for (let column = to - FLAT; column < to; column += 1) put(row, column, "─");
    put(row, to, direction > 0 ? "╮" : "╯");
    put(row + direction, to, direction > 0 ? "╯" : "╮");
    put(row + direction, to - 1, "─");
    put(row + direction, to - 2, direction > 0 ? "╰" : "╭");
  }
  return grid.map((line) => line.join(""));
}
