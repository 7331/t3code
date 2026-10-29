import { safeErrorLogAttributes } from "@t3tools/client-runtime/errors";
import * as Schema from "effect/Schema";
import { useSyncExternalStore } from "react";
import {
  applyThemePaint,
  canonicalThemeId,
  CUSTOM_THEMES_STORAGE_KEY,
  getThemeDefinition,
  getThemePreviewAppearance,
  isKnownThemePreference,
  parseThemeHalves,
  resolveDesktopTheme,
  resolveThemeAppearance,
  resolveThemePaints,
  STANDARD_THEME_PREFERENCE,
  subscribeToThemePreview,
  THEME_APPEARANCE_MODE_STORAGE_KEY,
  THEME_HALVES_STORAGE_KEY,
  ThemePreference,
  type ThemeAppearance,
  type ThemeHalves,
  type ThemePreferenceMode,
} from "../themePalette";

type Theme = ThemePreference;
type ThemeSnapshot = {
  theme: Theme;
  resolvedTheme: ThemeAppearance;
  appearanceMode: ThemePreferenceMode;
  themeHalves: ThemeHalves | null;
};

const STORAGE_KEY = "t3code:theme";
/** index.html's boot script reads this to paint the last theme before the app loads. */
const THEME_PAINT_STORAGE_KEY = "t3code:theme-paint:v1";
const LEGACY_FOLLOW_SYSTEM_STORAGE_KEY = "t3code:theme-follow-system";
const THEME_STORAGE_KEYS = new Set([
  STORAGE_KEY,
  THEME_APPEARANCE_MODE_STORAGE_KEY,
  THEME_HALVES_STORAGE_KEY,
  CUSTOM_THEMES_STORAGE_KEY,
]);
const MEDIA_QUERY = "(prefers-color-scheme: dark)";
const DEFAULT_THEME_SNAPSHOT: ThemeSnapshot = {
  theme: STANDARD_THEME_PREFERENCE,
  resolvedTheme: "light",
  appearanceMode: "system",
  themeHalves: null,
};

class ThemeStorageError extends Schema.TaggedError<ThemeStorageError>()("ThemeStorageError", {
  operation: Schema.Literals(["read", "write"]),
  storageKey: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Failed to ${this.operation} theme preference for ${this.storageKey}.`;
  }
}

const isThemeStorageError = Schema.is(ThemeStorageError);

class DesktopThemeSyncError extends Schema.TaggedError<DesktopThemeSyncError>()(
  "DesktopThemeSyncError",
  {
    theme: Schema.Literals(["light", "dark", "system"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to sync the ${this.theme} theme to the desktop shell.`;
  }
}

let listeners: Array<() => void> = [];
let lastSnapshot: ThemeSnapshot | null = null;
let snapshotStale = true;
let lastAppliedSnapshot: ThemeSnapshot | null = null;
let lastDesktopTheme: ThemePreferenceMode | null = null;
let themeStorageReadFailed = false;

function logThemeStorageError(error: ThemeStorageError): void {
  console.error(error.message, {
    operation: error.operation,
    storageKey: error.storageKey,
    ...safeErrorLogAttributes(error),
  });
}

/** Captures the stored mix as-is: published halves that have not streamed in yet still count. */
export function readThemeHalvesRaw(): { light?: string; dark?: string } {
  if (typeof window === "undefined") return {};
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(THEME_HALVES_STORAGE_KEY) ?? "null",
    );
    if (value === null || typeof value !== "object") return {};
    const halves: { light?: string; dark?: string } = {};
    for (const appearance of ["light", "dark"] as const) {
      const themeId = (value as Record<string, unknown>)[appearance];
      if (typeof themeId === "string") halves[appearance] = themeId;
    }
    return halves;
  } catch {
    return {};
  }
}

export function readThemeHalves(): ThemeHalves | null {
  if (typeof window === "undefined") return null;
  try {
    return parseThemeHalves(window.localStorage.getItem(THEME_HALVES_STORAGE_KEY));
  } catch {
    return null;
  }
}

function isThemePreferenceMode(value: string | null): value is ThemePreferenceMode {
  return value === "light" || value === "dark" || value === "system";
}

export function readAppearanceModePreference(): ThemePreferenceMode {
  if (typeof window === "undefined") return DEFAULT_THEME_SNAPSHOT.appearanceMode;
  try {
    const raw = window.localStorage.getItem(THEME_APPEARANCE_MODE_STORAGE_KEY);
    if (isThemePreferenceMode(raw)) return raw;
  } catch {}
  return DEFAULT_THEME_SNAPSHOT.appearanceMode;
}

export function readThemePreference(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME_SNAPSHOT.theme;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch (cause) {
    throw new ThemeStorageError({ operation: "read", storageKey: STORAGE_KEY, cause });
  }
  return raw !== null && isKnownThemePreference(raw)
    ? canonicalThemeId(raw)
    : DEFAULT_THEME_SNAPSHOT.theme;
}

function getStored(): Theme {
  if (themeStorageReadFailed) return DEFAULT_THEME_SNAPSHOT.theme;
  try {
    return readThemePreference();
  } catch (cause) {
    themeStorageReadFailed = true;
    logThemeStorageError(
      isThemeStorageError(cause)
        ? cause
        : new ThemeStorageError({ operation: "read", storageKey: STORAGE_KEY, cause }),
    );
    return DEFAULT_THEME_SNAPSHOT.theme;
  }
}

/**
 * Earlier builds kept the standard theme's mode in the theme key ("light", "dark",
 * "t3-chat-dark") and in a follow-system flag; the appearance mode key now owns it.
 */
function migrateLegacyThemeStorage(): void {
  try {
    const storage = window.localStorage;
    const storedTheme = storage.getItem(STORAGE_KEY);
    const followSystem = storage.getItem(LEGACY_FOLLOW_SYSTEM_STORAGE_KEY);
    const legacyMode =
      storedTheme === "light" || storedTheme === "dark"
        ? storedTheme
        : storedTheme === "t3-chat-dark"
          ? "dark"
          : null;
    const hasAppearanceMode = isThemePreferenceMode(
      storage.getItem(THEME_APPEARANCE_MODE_STORAGE_KEY),
    );
    if (!hasAppearanceMode && (storedTheme !== null || followSystem !== null)) {
      const followsSystem =
        followSystem === "true" ||
        (followSystem !== "false" && legacyMode === null && getStored() === "system");
      storage.setItem(
        THEME_APPEARANCE_MODE_STORAGE_KEY,
        followsSystem
          ? "system"
          : (legacyMode ?? getThemeDefinition(storedTheme ?? "")?.appearance ?? "light"),
      );
    }
    if (legacyMode !== null) {
      storage.setItem(
        STORAGE_KEY,
        storedTheme === "t3-chat-dark" ? canonicalThemeId(storedTheme) : STANDARD_THEME_PREFERENCE,
      );
    }
    storage.removeItem(LEGACY_FOLLOW_SYSTEM_STORAGE_KEY);
  } catch {
    // Unreadable storage has nothing to migrate; getStored reports it.
  }
}

function getSystemDark() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(MEDIA_QUERY).matches
  );
}

/** Cached until a change is signalled; useTheme calls this every render. */
export function getThemeSnapshot(): ThemeSnapshot {
  if (typeof window === "undefined") return DEFAULT_THEME_SNAPSHOT;
  if (!snapshotStale && lastSnapshot) return lastSnapshot;
  snapshotStale = false;
  const theme = getStored();
  const appearanceMode = readAppearanceModePreference();
  const themeHalves = readThemeHalves();
  const resolvedTheme = resolveThemeAppearance(
    theme,
    appearanceMode === "system" && getSystemDark(),
    appearanceMode,
    themeHalves,
  );
  if (
    lastSnapshot &&
    lastSnapshot.theme === theme &&
    lastSnapshot.resolvedTheme === resolvedTheme &&
    lastSnapshot.appearanceMode === appearanceMode &&
    lastSnapshot.themeHalves?.light === themeHalves?.light &&
    lastSnapshot.themeHalves?.dark === themeHalves?.dark
  ) {
    return lastSnapshot;
  }
  lastSnapshot = { theme, resolvedTheme, appearanceMode, themeHalves };
  return lastSnapshot;
}

function getServerSnapshot() {
  return DEFAULT_THEME_SNAPSHOT;
}

function syncDesktopTheme({ theme, appearanceMode, themeHalves }: ThemeSnapshot) {
  const bridge = window.desktopBridge;
  if (!bridge || typeof bridge.setTheme !== "function") return;
  const desktopTheme = resolveDesktopTheme(theme, appearanceMode, themeHalves);
  if (lastDesktopTheme === desktopTheme) return;
  lastDesktopTheme = desktopTheme;
  void (async () => {
    try {
      await bridge.setTheme(desktopTheme);
    } catch (cause) {
      const error = new DesktopThemeSyncError({ theme: desktopTheme, cause });
      console.error(error.message, { theme: desktopTheme, ...safeErrorLogAttributes(error) });
      if (lastDesktopTheme === desktopTheme) lastDesktopTheme = null;
    }
  })();
}

function applyTheme(snapshot: ThemeSnapshot, { preservePreview = true } = {}) {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  if (preservePreview && getThemePreviewAppearance() !== null) return;
  syncDesktopTheme(snapshot);
  if (snapshot === lastAppliedSnapshot) return;

  const { theme, resolvedTheme, appearanceMode, themeHalves } = snapshot;
  const paints = resolveThemePaints(theme, appearanceMode, themeHalves);
  const root = document.documentElement;
  root.classList.add("no-transitions");
  applyThemePaint(paints[resolvedTheme]!, resolvedTheme);
  lastAppliedSnapshot = snapshot;
  try {
    window.localStorage.setItem(THEME_PAINT_STORAGE_KEY, JSON.stringify(paints));
  } catch {
    // Only the boot splash reads it; without it the next load starts unthemed.
  }
  // Force a reflow so the no-transitions class takes effect before removal
  void root.offsetHeight;
  requestAnimationFrame(() => root.classList.remove("no-transitions"));
}

function publishThemeChange(options?: { preservePreview?: boolean }) {
  snapshotStale = true;
  applyTheme(getThemeSnapshot(), options);
  for (const listener of listeners) listener();
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  migrateLegacyThemeStorage();
  // The boot script already painted the last theme, which may be a published palette that only
  // resolves once the server's themes arrive and repaint (startEnvironmentThemeRepaint).
  let hasBootPaint = false;
  try {
    hasBootPaint = window.localStorage.getItem(THEME_PAINT_STORAGE_KEY) !== null;
  } catch {}
  if (hasBootPaint) syncDesktopTheme(getThemeSnapshot());
  else applyTheme(getThemeSnapshot());
}

function handleStorageChange(event: StorageEvent) {
  if (event.key !== null && !THEME_STORAGE_KEYS.has(event.key)) return;
  themeStorageReadFailed = false;
  lastAppliedSnapshot = null;
  publishThemeChange();
}

let removeWindowListeners: (() => void) | null = null;

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  listeners.push(listener);

  if (!removeWindowListeners) {
    const mq = typeof window.matchMedia === "function" ? window.matchMedia(MEDIA_QUERY) : null;
    const handleSystemAppearanceChange = () => publishThemeChange();
    mq?.addEventListener("change", handleSystemAppearanceChange);
    window.addEventListener("storage", handleStorageChange);
    removeWindowListeners = () => {
      mq?.removeEventListener("change", handleSystemAppearanceChange);
      window.removeEventListener("storage", handleStorageChange);
    };
  }

  return () => {
    listeners = listeners.filter((l) => l !== listener);
    if (listeners.length === 0) {
      removeWindowListeners?.();
      removeWindowListeners = null;
    }
  };
}

/** For code outside React (worker pools) that follows the rendered appearance. */
export function subscribeRenderedAppearance(listener: () => void): () => void {
  const unsubscribeTheme = subscribe(listener);
  const unsubscribePreview = subscribeToThemePreview(listener);
  return () => {
    unsubscribeTheme();
    unsubscribePreview();
  };
}

export function getRenderedAppearance(): ThemeAppearance {
  return getThemePreviewAppearance() ?? getThemeSnapshot().resolvedTheme;
}

export function useRenderedAppearance() {
  const { resolvedTheme } = useSyncExternalStore(subscribe, getThemeSnapshot, getServerSnapshot);
  const previewAppearance = useSyncExternalStore(
    subscribeToThemePreview,
    getThemePreviewAppearance,
    () => null,
  );
  return previewAppearance ?? resolvedTheme;
}

function writeThemeStorage(storageKey: string, write: (storage: Storage) => void): boolean {
  if (typeof window === "undefined") return false;
  try {
    write(window.localStorage);
  } catch (cause) {
    logThemeStorageError(new ThemeStorageError({ operation: "write", storageKey, cause }));
    return false;
  }
  themeStorageReadFailed = false;
  publishThemeChange();
  return true;
}

/** A whole theme replaces the mix. */
export function setTheme(next: Theme): boolean {
  return writeThemeStorage(STORAGE_KEY, (storage) => {
    storage.setItem(STORAGE_KEY, next);
    storage.removeItem(THEME_HALVES_STORAGE_KEY);
  });
}

export function setAppearanceMode(next: ThemePreferenceMode): boolean {
  return writeThemeStorage(THEME_APPEARANCE_MODE_STORAGE_KEY, (storage) =>
    storage.setItem(THEME_APPEARANCE_MODE_STORAGE_KEY, next),
  );
}

function setThemeHalf(appearance: ThemeAppearance, themeId: string | null): boolean {
  return writeThemeStorage(THEME_HALVES_STORAGE_KEY, (storage) => {
    const next = { ...readThemeHalvesRaw() };
    if (themeId === null) delete next[appearance];
    else next[appearance] = themeId;
    if (next.light === undefined && next.dark === undefined) {
      storage.removeItem(THEME_HALVES_STORAGE_KEY);
    } else {
      storage.setItem(THEME_HALVES_STORAGE_KEY, JSON.stringify(next));
    }
  });
}

function clearThemeHalves(): boolean {
  return writeThemeStorage(THEME_HALVES_STORAGE_KEY, (storage) =>
    storage.removeItem(THEME_HALVES_STORAGE_KEY),
  );
}

export function refreshTheme({ preservePreview = false } = {}): void {
  if (typeof window === "undefined") return;
  lastAppliedSnapshot = null;
  publishThemeChange({ preservePreview });
}

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getThemeSnapshot, getServerSnapshot);
  return {
    theme: snapshot.theme,
    setTheme,
    setAppearanceMode,
    setThemeHalf,
    clearThemeHalves,
    refreshTheme,
    appearanceMode: snapshot.appearanceMode,
    resolvedTheme: snapshot.resolvedTheme,
    themeHalves: snapshot.themeHalves,
  } as const;
}
