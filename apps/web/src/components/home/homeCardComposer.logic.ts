import type { ModelSelection } from "@t3tools/contracts";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";

import {
  type ComposerTrigger,
  extendReplacementRangeForTrailingSpace,
  replaceTextRange,
} from "../../composer-logic";
import type { ComposerCommandItem } from "../chat/ComposerCommandMenu";

/**
 * The menu items a card can insert as plain prompt text. Pull requests and threads attach draft
 * context records, and /model and /plan change thread state; those stay in the thread's composer.
 */
export type HomeCardMenuItem = Extract<
  ComposerCommandItem,
  { readonly type: "path" | "skill" | "provider-slash-command" }
>;

/** Narrows the composer's menu items to the ones a card can insert. */
export function isHomeCardMenuItem(item: ComposerCommandItem): item is HomeCardMenuItem {
  return item.type === "path" || item.type === "skill" || item.type === "provider-slash-command";
}

function menuItemReplacement(item: HomeCardMenuItem): string {
  switch (item.type) {
    case "path":
      return `${serializeComposerFileLink(item.path)} `;
    case "skill":
      return `$${item.skill.name} `;
    case "provider-slash-command":
      return `/${item.command.name} `;
  }
}

/** The prompt after choosing `item` for the trigger under the cursor, with the expanded cursor. */
export function applyHomeCardMenuItem(
  value: string,
  trigger: ComposerTrigger,
  item: HomeCardMenuItem,
): { readonly text: string; readonly cursor: number } {
  const replacement = menuItemReplacement(item);
  const rangeEnd = extendReplacementRangeForTrailingSpace(value, trigger.rangeEnd, replacement);
  return replaceTextRange(value, trigger.rangeStart, rangeEnd, replacement);
}

/** The item the arrow keys move to, wrapping at either end like the thread composer's menu. */
export function stepHomeCardMenuHighlight(
  items: ReadonlyArray<{ readonly id: string }>,
  activeId: string | null,
  direction: 1 | -1,
): string | null {
  if (items.length === 0) return null;
  const index = items.findIndex((item) => item.id === activeId);
  const next = index === -1 ? (direction === 1 ? 0 : items.length - 1) : index + direction;
  return items[(next + items.length) % items.length]!.id;
}

/**
 * The model selection a card reply sends: the draft's pick for the thread's own provider instance,
 * options included, as the thread composer sends it. Without one the server keeps the thread's.
 */
export function homeCardSendModelSelection(
  threadSelection: ModelSelection,
  draftSelection: ModelSelection | undefined,
): ModelSelection | undefined {
  return draftSelection?.instanceId === threadSelection.instanceId ? draftSelection : undefined;
}

/** The model a card's next reply runs on: the draft's pick for the thread's instance, else the thread's. */
export function homeCardModelSlug(
  threadSelection: ModelSelection,
  draftSelection: ModelSelection | undefined,
): string {
  return draftSelection?.instanceId === threadSelection.instanceId && draftSelection.model
    ? draftSelection.model
    : threadSelection.model;
}
