import { SkyClock } from "@t3tools/shared/ambientSky/skyClock";
import { sowStars, starFrame, type Star } from "@t3tools/shared/ambientSky/starField";
import { windRows } from "@t3tools/shared/ambientSky/windField";

import { createBrowserSkyHost } from "./browserSkyHost";

export interface SkyHandle {
  readonly setOnScreen: (onScreen: boolean) => void;
  readonly setStill: (still: boolean) => void;
  readonly layout: () => void;
  readonly dispose: () => void;
}

const MAXIMUM_PIXEL_RATIO = 2;
const WIND_STEP_SECONDS = 0.25;
const FONT_PX = 13;
const CELLS_PER_STAR = 95;
const STILL_SECONDS = 24;
const CLEAR_PAD_PX = 24;
const CLEAR_FEATHER_PX = 40;
const CLEAR_EVERY_FRAMES = 10;
const UINT32_RANGE = 4294967296;

const LAUNCH_SEED = (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) / UINT32_RANGE;

function readInk(scope: Element): { readonly color: string; readonly alpha: number } {
  const probe = document.createElement("span");
  probe.style.color = "var(--sky-glyph, transparent)";
  probe.style.display = "none";
  scope.append(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  const pixel = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (pixel === null) return { color: "transparent", alpha: 0 };
  pixel.fillStyle = resolved;
  pixel.fillRect(0, 0, 1, 1);
  const [red = 0, green = 0, blue = 0, alpha = 0] = pixel.getImageData(0, 0, 1, 1).data;
  return { color: `rgb(${red} ${green} ${blue})`, alpha: alpha / 255 };
}

function readMonoStack(): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() || "monospace"
  );
}

class Sky {
  private readonly context: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private stars: readonly Star[] = [];
  private windy = false;
  private wind: string[] = [];
  private windAtSeconds = Number.NEGATIVE_INFINITY;
  private columns = 0;
  private rows = 0;
  private cellWidth = 0;
  private left = 0;
  private top = 0;
  private width = 0;
  private height = 0;
  private inkAlpha = 0;
  private cleared = new Float32Array(0);
  private frames = 0;
  onScreen = true;
  still = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("sky: no 2d context");
    this.context = context;
  }

  get moving(): boolean {
    return this.onScreen && !this.still && this.columns > 0;
  }

  layout(seconds: number): void {
    const box = this.canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, MAXIMUM_PIXEL_RATIO);
    this.canvas.width = Math.max(1, Math.round(box.width * ratio));
    this.canvas.height = Math.max(1, Math.round(box.height * ratio));
    this.width = box.width;
    this.height = box.height;
    const { context } = this;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.font = `${FONT_PX}px ${readMonoStack()}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    const ink = readInk(this.canvas.parentElement ?? this.canvas);
    context.fillStyle = ink.color;
    this.inkAlpha = ink.alpha;
    this.cellWidth = context.measureText("M").width || FONT_PX * 0.6;
    this.columns = Math.floor(box.width / this.cellWidth);
    this.rows = Math.floor(box.height / FONT_PX);
    this.left = (box.width - this.columns * this.cellWidth) / 2;
    this.top = (box.height - this.rows * FONT_PX) / 2;
    const sized = this.columns > 0 && this.rows > 0;
    this.windy = sized && !document.documentElement.classList.contains("dark");
    this.stars =
      sized && !this.windy
        ? sowStars({
            columns: this.columns,
            rows: this.rows,
            cellsPerStar: CELLS_PER_STAR,
            seed: LAUNCH_SEED,
          })
        : [];
    this.windAtSeconds = Number.NEGATIVE_INFINITY;
    this.measureClear();
    this.paint(seconds);
  }

  private measureClear(): void {
    const { columns, rows, cellWidth } = this;
    this.cleared = new Float32Array(columns * rows).fill(1);
    const host = this.canvas.parentElement;
    if (host === null || columns === 0) return;
    const box = this.canvas.getBoundingClientRect();
    for (const element of host.querySelectorAll("[data-sky-clear]")) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const left = rect.left - box.left - CLEAR_PAD_PX;
      const right = rect.right - box.left + CLEAR_PAD_PX;
      const top = rect.top - box.top - CLEAR_PAD_PX;
      const bottom = rect.bottom - box.top + CLEAR_PAD_PX;
      for (let row = 0; row < rows; row += 1) {
        const y = this.top + (row + 0.5) * FONT_PX;
        const dy = Math.max(top - y, 0, y - bottom);
        if (dy >= CLEAR_FEATHER_PX) continue;
        for (let column = 0; column < columns; column += 1) {
          const x = this.left + (column + 0.5) * cellWidth;
          const distance = Math.hypot(Math.max(left - x, 0, x - right), dy);
          const index = row * columns + column;
          this.cleared[index] = Math.min(
            this.cleared[index] ?? 1,
            Math.min(1, distance / CLEAR_FEATHER_PX),
          );
        }
      }
    }
  }

  private glyph(glyph: string, column: number, row: number, alpha: number): void {
    const room = this.cleared[row * this.columns + column] ?? 1;
    if (room <= 0) return;
    this.context.globalAlpha = Math.min(1, alpha * room * this.inkAlpha);
    this.context.fillText(
      glyph,
      this.left + column * this.cellWidth + this.cellWidth / 2,
      this.top + row * FONT_PX + FONT_PX / 2,
    );
  }

  draw(seconds: number): void {
    this.frames += 1;
    const remeasure = this.frames % CLEAR_EVERY_FRAMES === 0;
    if (remeasure) this.measureClear();
    const windStale = Math.abs(seconds + STILL_SECONDS - this.windAtSeconds) >= WIND_STEP_SECONDS;
    if (this.windy && !windStale && !remeasure) return;
    this.paint(seconds);
  }

  private paint(seconds: number): void {
    const at = seconds + STILL_SECONDS;
    this.context.clearRect(0, 0, this.width, this.height);
    const { columns, rows } = this;
    if (this.windy) {
      if (Math.abs(at - this.windAtSeconds) >= WIND_STEP_SECONDS) {
        this.wind = windRows(columns, rows, at);
        this.windAtSeconds = at;
      }
      this.wind.forEach((line, row) => {
        for (let column = 0; column < line.length; column += 1) {
          const glyph = line[column];
          if (glyph !== undefined && glyph !== " ") this.glyph(glyph, column, row, 1);
        }
      });
    }
    for (const star of this.stars) {
      const frame = starFrame(star, at);
      if (frame.alpha <= 0) continue;
      const column = Math.floor(
        (((star.column + frame.driftColumns) % columns) + columns) % columns,
      );
      const row = Math.floor((((star.row + frame.driftRows) % rows) + rows) % rows);
      this.glyph(frame.glyph, column, row, frame.alpha);
    }
    this.context.globalAlpha = 1;
  }
}

let clock: SkyClock<number> | null = null;

/** Mounts still; call `setStill(false)` to start the drift. */
export function mountSky(canvas: HTMLCanvasElement): SkyHandle {
  clock ??= new SkyClock(createBrowserSkyHost());
  const sharedClock = clock;
  const sky = new Sky(canvas);
  const remove = sharedClock.add(sky);
  return {
    setOnScreen: (onScreen) => {
      sky.onScreen = onScreen;
      sharedClock.schedule();
    },
    setStill: (still) => {
      if (sky.still === still) return;
      sky.still = still;
      sky.layout(sharedClock.seconds);
      sharedClock.schedule();
    },
    layout: () => sky.layout(sharedClock.seconds),
    dispose: remove,
  };
}
