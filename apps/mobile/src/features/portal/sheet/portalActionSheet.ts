import { useSyncExternalStore } from "react";
import type { ColorValue } from "react-native";

export interface PortalSheetAction {
  readonly kind: "action";
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly icon?: string;
  readonly iconColor?: ColorValue;
  readonly isSelected?: boolean;
  readonly isDestructive?: boolean;
  readonly isDisabled?: boolean;
  /** The sheet stays up after the press, such as a toggle the owner re-presents. */
  readonly keepsSheetOpen?: boolean;
  readonly onPress: () => void;
}

export interface PortalSheetSubmenu {
  readonly kind: "submenu";
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly icon?: string;
  readonly entries: ReadonlyArray<PortalSheetEntry>;
}

/** Rows that share one rounded card, optionally under a small label. */
export interface PortalSheetGroup {
  readonly kind: "group";
  readonly id: string;
  readonly title?: string;
  readonly rows: ReadonlyArray<PortalSheetAction | PortalSheetSubmenu>;
}

export type PortalSheetEntry = PortalSheetAction | PortalSheetSubmenu | PortalSheetGroup;

export interface PortalActionSheetContent {
  readonly title?: string;
  readonly subtitle?: string;
  readonly entries: ReadonlyArray<PortalSheetEntry>;
  readonly onDismiss?: () => void;
}

export interface PresentedPortalActionSheet {
  readonly ownerId: string;
  readonly content: PortalActionSheetContent;
}

let presented: PresentedPortalActionSheet | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish(next: PresentedPortalActionSheet | null) {
  presented = next;
  for (const listener of listeners) listener();
}

let nextAnonymousOwner = 0;

/**
 * Portal's phone menus are bottom action sheets, never anchored popovers. One sheet shows at a
 * time; presenting replaces whatever is up. The owner id lets a live menu refresh its rows while
 * open and lets an unmounting owner close only its own sheet.
 */
export const portalActionSheet = {
  present(content: PortalActionSheetContent, options?: { readonly ownerId?: string }) {
    const ownerId = options?.ownerId ?? `anonymous-${nextAnonymousOwner++}`;
    publish({ ownerId, content });
    return ownerId;
  },
  update(ownerId: string, content: PortalActionSheetContent) {
    if (presented?.ownerId === ownerId) publish({ ownerId, content });
  },
  dismiss(ownerId?: string) {
    if (presented === null) return;
    if (ownerId !== undefined && presented.ownerId !== ownerId) return;
    const closing = presented;
    publish(null);
    closing.content.onDismiss?.();
  },
  isPresentedBy(ownerId: string) {
    return presented?.ownerId === ownerId;
  },
};

export function usePresentedPortalActionSheet(): PresentedPortalActionSheet | null {
  return useSyncExternalStore(subscribe, () => presented);
}
