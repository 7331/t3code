import { describe, expect, it } from "vite-plus/test";

import { measureSkyClearance, paintSkyRows, readSkyRow } from "./skyFrame";

const layout = { columns: 8, rows: 2, cellWidth: 10, cellHeight: 10, left: 0, top: 0 };
const openSky = new Float32Array(layout.columns * layout.rows).fill(1);

describe("paintSkyRows", () => {
  it("keeps every glyph in its column and splits a row by ink level", () => {
    const clearance = openSky.slice();
    clearance[5] = 0.5;
    const painted = paintSkyRows(layout, {
      clearance,
      wind: ["  ─╮ ─  ", ""],
      stars: [],
      seconds: 0,
    });

    const segments = readSkyRow(painted[0] ?? "");
    expect(segments).toEqual([
      { level: 4, text: "  ─╮" },
      { level: 2, text: " ─" },
    ]);
    expect(segments.map((segment) => segment.text).join("")).toBe("  ─╮ ─");
    expect(painted[1]).toBe("");
  });

  it("leaves cells under a clear rect blank", () => {
    const clearance = measureSkyClearance(
      { ...layout, columns: 40, rows: 1 },
      { rects: [{ x: 150, y: 0, width: 100, height: 10 }] },
    );
    const painted = paintSkyRows(
      { columns: 40, rows: 1 },
      { clearance, wind: ["─".repeat(40)], stars: [], seconds: 0 },
    );

    const row = readSkyRow(painted[0] ?? "")
      .map((segment) => segment.text)
      .join("");
    expect(row.slice(14, 26)).toBe(" ".repeat(12));
    expect(row.startsWith("─")).toBe(true);
  });
});
