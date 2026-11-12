import { useEffect, useRef, useState } from "react";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { observeResize } from "~/lib/observeResize";
import { useClientSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { getThemeDefinition, resolveThemeHalf } from "~/themePalette";

import { PORTAL_THEME_ID } from "../portalTheme";
import { mountSky, type SkyHandle } from "./skyCanvas";
import "./ambientSky.css";

function useAmbientSkyShown(): boolean {
  const enabled = useClientSettings((settings) => settings.ambientSkyEnabled);
  const { theme, themeHalves, resolvedTheme } = useTheme();
  const activeTheme = resolveThemeHalf(theme, themeHalves, resolvedTheme);
  return enabled && getThemeDefinition(activeTheme)?.id === PORTAL_THEME_ID;
}

/** Portal's ASCII sky: stars in dark mode, wind in light. The parent must be `relative isolate`; mark text to keep clear with `data-sky-clear`. */
export function AmbientSky({ motion = "live" }: { readonly motion?: "live" | "still" }) {
  const shown = useAmbientSkyShown();
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const still = motion === "still" || reducedMotion;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sky, setSky] = useState<SkyHandle | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the canvas loop and its resize and visibility observers
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!shown || canvas === null) return undefined;
    const handle = mountSky(canvas);
    canvas.dataset.ready = "";
    const stopResize = observeResize(canvas, () => handle.layout());
    const visibility = new IntersectionObserver((entries) => {
      const entry = entries.at(-1);
      if (entry !== undefined) handle.setOnScreen(entry.isIntersecting);
    });
    visibility.observe(canvas);
    setSky(handle);
    return () => {
      stopResize();
      visibility.disconnect();
      handle.dispose();
      setSky(null);
    };
  }, [shown]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- freezes the running canvas loop in place instead of remounting it
  useEffect(() => {
    sky?.setStill(still);
  }, [sky, still]);

  if (!shown) return null;
  return <canvas ref={canvasRef} aria-hidden="true" data-portal-ambient-sky="" />;
}
