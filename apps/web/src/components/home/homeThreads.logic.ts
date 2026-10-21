import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  sortPinnedThreadsByOrderKey,
  sortThreads,
} from "@t3tools/client-runtime/state/thread-sort";
import type { OrchestrationV2ProjectedTurnItem, SidebarThreadSortOrder } from "@t3tools/contracts";

import { filterSidebarV2VisibleThreads } from "../Sidebar.logic";

/** Each card holds a live subscription to its thread's detail stream, so Home stays a handful. */
export const HOME_MAX_CARDS = 6;
/** Home is for glancing across threads, so a card previews only the last few messages. */
const HOME_CARD_MESSAGE_LIMIT = 3;

type HomeThreadInput = Pick<
  EnvironmentThreadShell,
  | "environmentId"
  | "id"
  | "projectId"
  | "archivedAt"
  | "lineage"
  | "pinnedAt"
  | "pinOrderKey"
  | "createdAt"
  | "updatedAt"
  | "latestUserMessageAt"
>;

export interface HomeThreadSelection<T> {
  /** "recent" means nothing is pinned, so Home shows each project's latest thread instead. */
  readonly source: "pinned" | "recent";
  readonly threads: ReadonlyArray<T>;
}

/** Pinned threads in the sidebar's pin order, else the latest thread of each project. */
export function selectHomeThreads<T extends HomeThreadInput>(
  threads: ReadonlyArray<T>,
  sortOrder: SidebarThreadSortOrder,
): HomeThreadSelection<T> {
  const visible = filterSidebarV2VisibleThreads(threads, null);
  const pinned = visible.filter((thread) => thread.pinnedAt !== null);
  if (pinned.length > 0) {
    return {
      source: "pinned",
      threads: sortPinnedThreadsByOrderKey(pinned).slice(0, HOME_MAX_CARDS),
    };
  }
  const seenProjects = new Set<string>();
  const recent: T[] = [];
  for (const thread of sortThreads(visible, sortOrder)) {
    const projectKey = `${thread.environmentId}:${thread.projectId}`;
    if (seenProjects.has(projectKey)) continue;
    seenProjects.add(projectKey);
    recent.push(thread);
    if (recent.length === HOME_MAX_CARDS) break;
  }
  return { source: "recent", threads: recent };
}

export interface HomeCardMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly streaming: boolean;
}

/** The conversation's last few user and assistant messages, oldest first; tool work is left to the thread. */
export function latestHomeCardMessages(
  items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
  limit: number = HOME_CARD_MESSAGE_LIMIT,
): ReadonlyArray<HomeCardMessage> {
  const messages: HomeCardMessage[] = [];
  for (let index = items.length - 1; index >= 0 && messages.length < limit; index -= 1) {
    const { item } = items[index]!;
    if (item.type === "user_message" && item.text.trim().length > 0) {
      messages.push({ id: item.id, role: "user", text: item.text, streaming: false });
    } else if (
      item.type === "assistant_message" &&
      (item.text.trim().length > 0 || item.streaming)
    ) {
      messages.push({ id: item.id, role: "assistant", text: item.text, streaming: item.streaming });
    }
  }
  return messages.toReversed();
}

/**
 * The first card spans the grid, the rest pair up in two columns, and a card left alone in the
 * last row spans too instead of leaving half the row empty.
 */
export function homeCardSpansFullWidth(index: number, count: number): boolean {
  if (index === 0) return true;
  return index === count - 1 && (count - 1) % 2 === 1;
}

/**
 * Pin and settle act on sidebar rows, and subagent threads have no row: the provider or parent
 * owns them. Cards offer the actions only for top-level threads whose environment supports them.
 */
export function homeCardThreadActions(input: {
  readonly thread: Pick<EnvironmentThreadShell, "lineage">;
  readonly supportsPinning: boolean;
  readonly supportsSettlement: boolean;
}): { readonly pin: boolean; readonly settle: boolean } {
  const topLevel = input.thread.lineage.relationshipToParent !== "subagent";
  return {
    pin: topLevel && input.supportsPinning,
    settle: topLevel && input.supportsSettlement,
  };
}

/** A card's second line: project and branch, skipping whichever a thread lacks. */
export function homeCardSubtitle(parts: {
  readonly projectTitle: string | null | undefined;
  readonly branch: string | null;
}): string {
  return [parts.projectTitle, parts.branch].filter(Boolean).join(" · ");
}
