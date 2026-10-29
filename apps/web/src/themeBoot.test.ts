import { describe, expect, it } from "vite-plus/test";

import indexHtml from "../index.html?raw";
import { getThemeColorsForMode, GROVE_THEME, resolveThemePaints } from "./themePalette";

const THEME_PAINT_STORAGE_KEY = "t3code:theme-paint:v1";

const bootScript = (() => {
  const match = indexHtml.match(/<script>([\s\S]*?)<\/script>/);
  if (!match?.[1]) throw new Error("Could not find the inline boot script in index.html");
  return match[1];
})();

function runBootScript(options: {
  storedPaint?: string;
  storageThrows?: boolean;
  prefersDark: boolean;
}) {
  const classes = new Set<string>();
  const variables: Record<string, string> = {};
  const meta = { content: null as string | null };
  const documentElement = {
    dataset: {} as Record<string, string | undefined>,
    classList: {
      toggle: (name: string, force: boolean) => {
        if (force) classes.add(name);
        else classes.delete(name);
      },
    },
    style: {
      backgroundColor: "",
      setProperty: (name: string, value: string) => {
        variables[name] = value;
      },
    },
  };
  const fakeDocument = {
    documentElement,
    querySelectorAll: () => [
      { setAttribute: (_name: string, value: string) => void (meta.content = value) },
    ],
  };
  const fakeWindow = {
    localStorage: {
      getItem: (key: string): string | null => {
        if (options.storageThrows) throw new Error("storage blocked");
        return key === THEME_PAINT_STORAGE_KEY ? (options.storedPaint ?? null) : null;
      },
    },
    matchMedia: () => ({ matches: options.prefersDark }),
  };

  new Function("window", "document", bootScript)(fakeWindow, fakeDocument);

  return {
    isDark: classes.has("dark"),
    themeId: documentElement.dataset.themeId,
    backgroundColor: documentElement.style.backgroundColor,
    variables,
    metaContent: meta.content,
  };
}

describe("index.html boot script", () => {
  it("follows the OS appearance with nothing painted yet", () => {
    for (const prefersDark of [false, true]) {
      const boot = runBootScript({ prefersDark });
      expect(boot.isDark).toBe(prefersDark);
      expect(boot.themeId).toBeUndefined();
      expect(boot.metaContent).toBe(prefersDark ? "#000000" : "#ffffff");
    }
  });

  it("repaints the appearance the OS wants from a theme that follows it", () => {
    const paints = resolveThemePaints(GROVE_THEME.id, "system", null);
    const boot = runBootScript({ storedPaint: JSON.stringify(paints), prefersDark: true });
    const darkChrome = getThemeColorsForMode(GROVE_THEME, "dark")!.chrome;

    expect(boot.isDark).toBe(true);
    expect(boot.themeId).toBe(GROVE_THEME.id);
    expect(boot.variables).toEqual(paints.dark!.variables);
    expect(boot.backgroundColor).toBe(darkChrome);
    expect(boot.metaContent).toBe(darkChrome);
  });

  it("keeps a single painted appearance whatever the OS wants", () => {
    const paints = resolveThemePaints(GROVE_THEME.id, "dark", null);
    const boot = runBootScript({ storedPaint: JSON.stringify(paints), prefersDark: false });
    expect(boot.isDark).toBe(true);
    expect(boot.themeId).toBe(GROVE_THEME.id);
  });

  it("falls back to the OS appearance on unreadable or malformed storage", () => {
    for (const storedPaint of ["{", "42", '"light"', '{"other":{}}']) {
      expect(runBootScript({ storedPaint, prefersDark: true }).isDark).toBe(true);
    }
    expect(runBootScript({ storageThrows: true, prefersDark: true }).isDark).toBe(true);
    const boot = runBootScript({ storedPaint: '{"light":{"themeId":"x"}}', prefersDark: true });
    expect(boot.isDark).toBe(false);
    expect(boot.metaContent).toBe("#ffffff");
  });
});
