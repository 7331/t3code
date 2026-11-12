import type { SkyHost } from "@t3tools/shared/ambientSky/skyClock";

export function createBrowserSkyHost(): SkyHost<number> {
  return {
    isActive: () => document.visibilityState === "visible" && document.hasFocus(),
    now: () => performance.now(),
    setTimer: (callback, milliseconds) => window.setTimeout(callback, milliseconds),
    clearTimer: (timer) => window.clearTimeout(timer),
    listen: ({ onActivityChange, onAppearanceChange }) => {
      window.addEventListener("focus", onActivityChange);
      window.addEventListener("blur", onActivityChange);
      document.addEventListener("visibilitychange", onActivityChange);
      const appearance = new MutationObserver(onAppearanceChange);
      appearance.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "data-theme-id"],
      });
      let listening = true;
      void document.fonts.ready.then(() => {
        if (listening) onAppearanceChange();
      });
      return () => {
        listening = false;
        window.removeEventListener("focus", onActivityChange);
        window.removeEventListener("blur", onActivityChange);
        document.removeEventListener("visibilitychange", onActivityChange);
        appearance.disconnect();
      };
    },
  };
}
