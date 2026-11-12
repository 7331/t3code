import { SkyClock } from "@t3tools/shared/ambientSky/skyClock";

import { isAppActive, subscribeAppState } from "../../../lib/appState";

let clock: SkyClock<ReturnType<typeof setTimeout>> | null = null;

/** One timer for every mounted sky; it stops while the app is in the background or nothing moves. */
export function sharedSkyClock(): SkyClock<ReturnType<typeof setTimeout>> {
  clock ??= new SkyClock({
    isActive: isAppActive,
    now: () => performance.now(),
    setTimer: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimer: (timer) => clearTimeout(timer),
    listen: ({ onActivityChange }) => subscribeAppState(onActivityChange),
  });
  return clock;
}
