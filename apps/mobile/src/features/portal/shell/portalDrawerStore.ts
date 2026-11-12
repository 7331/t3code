import { createRef, useSyncExternalStore } from "react";
import type { TextInputInstance } from "react-native";

let open = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setOpen(next: boolean) {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
}

// The drawer slides in over this long before its search field can take focus.
const DRAWER_SLIDE_MS = 260;

/** The drawer's search field, so the bar's search button can focus it. */
export const portalDrawerSearchRef = createRef<TextInputInstance>();

/**
 * The Portal phone sidebar drawer lives outside the tab slots, so its state is a
 * module store shared by the header button and the overlay.
 */
export const portalDrawer = {
  open: () => open,
  setOpen,
  close: () => setOpen(false),
  /** Opens the drawer with its search field focused, like Portal's chat list search. */
  openSearch: () => {
    setOpen(true);
    setTimeout(() => portalDrawerSearchRef.current?.focus(), DRAWER_SLIDE_MS);
  },
};

export function usePortalDrawerOpen(): boolean {
  return useSyncExternalStore(subscribe, portalDrawer.open);
}
