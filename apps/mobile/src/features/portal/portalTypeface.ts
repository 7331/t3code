import { loadAsync } from "expo-font";
import { useEffect, useSyncExternalStore } from "react";

import type { FontFamilies } from "../../lib/fontFamilies";

export const PORTAL_FONT_FAMILIES = {
  regular: "Ubuntu-Regular",
  medium: "Ubuntu-Medium",
  bold: "Ubuntu-Bold",
} as const satisfies FontFamilies;

/** The `font-sans`, `font-t3-medium` and `font-t3-bold` utilities read these from global.css. */
export function fontFamilyVariables(families: FontFamilies) {
  return {
    "--font-sans": families.regular,
    "--font-medium": families.medium,
    "--font-bold": families.bold,
  } as const;
}

type TypefaceState = "idle" | "loading" | "ready" | "failed";

let typefaceState: TypefaceState = "idle";
const typefaceListeners = new Set<() => void>();

function setTypefaceState(next: TypefaceState): void {
  typefaceState = next;
  for (const listener of typefaceListeners) listener();
}

function subscribeTypeface(listener: () => void): () => void {
  typefaceListeners.add(listener);
  return () => typefaceListeners.delete(listener);
}

function readTypefaceState(): TypefaceState {
  return typefaceState;
}

// Loaded at runtime from the JS bundle, not embedded by the expo-font plugin, so no new native build is needed.
function loadPortalTypeface(): void {
  if (typefaceState !== "idle") return;
  setTypefaceState("loading");
  loadAsync({
    [PORTAL_FONT_FAMILIES.regular]: require("./fonts/Ubuntu-R.ttf"),
    [PORTAL_FONT_FAMILIES.medium]: require("./fonts/Ubuntu-M.ttf"),
    [PORTAL_FONT_FAMILIES.bold]: require("./fonts/Ubuntu-B.ttf"),
  }).then(
    () => setTypefaceState("ready"),
    () => setTypefaceState("failed"),
  );
}

/** Ubuntu once it is registered while Portal is on screen; the app font until then or if it fails. */
export function usePortalTypefaceReady(isPortalActive: boolean): boolean {
  const state = useSyncExternalStore(subscribeTypeface, readTypefaceState);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the bundled font with the native font manager the first time Portal is active
  useEffect(() => {
    if (isPortalActive) loadPortalTypeface();
  }, [isPortalActive]);
  return isPortalActive && state === "ready";
}
