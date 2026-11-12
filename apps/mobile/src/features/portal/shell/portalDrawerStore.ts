import { useSyncExternalStore } from "react";

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

/**
 * The Portal phone sidebar drawer lives outside the tab slots, so its state is a
 * module store shared by the header button and the overlay.
 */
export const portalDrawer = {
  open: () => open,
  setOpen,
  close: () => setOpen(false),
};

export function usePortalDrawerOpen(): boolean {
  return useSyncExternalStore(subscribe, portalDrawer.open);
}
