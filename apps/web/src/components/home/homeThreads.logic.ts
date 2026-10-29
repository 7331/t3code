import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { sortPinnedThreadsByOrderKey } from "@t3tools/client-runtime/state/thread-sort";
import type { OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";

import { liveThoughtLine, summarizeToolGroup } from "@t3tools/client-runtime/work-log/presentation";

import { deriveTimelineEntriesFromVisibleTurnItems, type WorkLogEntry } from "../../session-logic";
import { liveWorkEntryLabel } from "../chat/MessagesTimeline.logic";
import { filterSidebarV2VisibleThreads } from "../Sidebar.logic";

/** Each card holds a live subscription to its thread's detail stream, so Home stays a handful. */
export const HOME_MAX_CARDS = 6;
/** Home is for glancing across threads, so a card previews only the last few messages. */
const HOME_CARD_MESSAGE_LIMIT = 3;

/** Pinned threads in the sidebar's pin order. */
export function selectHomeThreads(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  delegatedUnderParent: ReadonlySet<string>,
): ReadonlyArray<EnvironmentThreadShell> {
  const visible = filterSidebarV2VisibleThreads(threads, null, delegatedUnderParent);
  return sortPinnedThreadsByOrderKey(visible.filter((thread) => thread.pinnedAt !== null)).slice(
    0,
    HOME_MAX_CARDS,
  );
}

/** A card's transcript line: a message, or one muted line for the agent work between messages. */
export type HomeCardRow =
  | {
      readonly kind: "message";
      readonly id: string;
      readonly role: "user" | "assistant";
      readonly text: string;
      readonly streaming: boolean;
    }
  | {
      readonly kind: "activity";
      readonly id: string;
      readonly entries: ReadonlyArray<WorkLogEntry>;
    };

/**
 * The conversation's last few messages, oldest first, with each stretch of thinking and tool work
 * between them folded into one activity row. Plans, errors and other cards stay in the thread.
 */
export function latestHomeCardRows(
  items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
): ReadonlyArray<HomeCardRow> {
  // Derive only the tail from the oldest kept message, so a streamed token doesn't rebuild the
  // whole history.
  let tailStart = 0;
  let tailMessageCount = 0;
  for (
    let index = items.length - 1;
    index >= 0 && tailMessageCount < HOME_CARD_MESSAGE_LIMIT;
    index -= 1
  ) {
    const { item } = items[index]!;
    if (
      (item.type === "user_message" || item.type === "assistant_message") &&
      item.text.trim().length > 0
    ) {
      tailStart = index;
      tailMessageCount += 1;
    }
  }
  const entries = deriveTimelineEntriesFromVisibleTurnItems({
    visibleTurnItems: items.slice(tailStart),
    optimisticMessages: [],
  });
  const rows: HomeCardRow[] = [];
  let work: WorkLogEntry[] = [];
  const flushWork = () => {
    if (work.length === 0) return;
    const ordered = work.toReversed();
    rows.push({ kind: "activity", id: `activity:${ordered[0]!.id}`, entries: ordered });
    work = [];
  };
  let messageCount = 0;
  for (
    let index = entries.length - 1;
    index >= 0 && messageCount < HOME_CARD_MESSAGE_LIMIT;
    index -= 1
  ) {
    const entry = entries[index]!;
    if (entry.kind === "work") {
      work.push(entry.entry);
      continue;
    }
    if (entry.kind !== "message") continue;
    const { message } = entry;
    if (message.role !== "user" && message.role !== "assistant") continue;
    // A reply that has not produced text yet would hide the live activity row under it.
    if (message.text.trim().length === 0) continue;
    flushWork();
    rows.push({
      kind: "message",
      id: message.id,
      role: message.role,
      text: message.text,
      streaming: message.streaming,
    });
    messageCount += 1;
  }
  // Work left over is older than the oldest kept message, so it belongs to one the card drops.
  return rows.toReversed();
}

/**
 * What an activity row says. While the agent is on it, the newest step: its thought's lead line,
 * or the tool it is running. Once it has moved on, the same summary the thread's work log uses.
 */
export function homeCardActivityLabel(
  entries: ReadonlyArray<WorkLogEntry>,
  live: boolean,
  workspaceRoot: string | undefined,
): { readonly label: string; readonly thinking: boolean; readonly failed: boolean } {
  const latest = entries.at(-1);
  if (live && latest !== undefined) {
    if (latest.itemType === "reasoning") {
      return {
        label: liveThoughtLine(latest.detail ?? "") || "Thinking",
        thinking: true,
        failed: false,
      };
    }
    return {
      label: liveWorkEntryLabel(latest, workspaceRoot, true),
      thinking: false,
      failed: false,
    };
  }
  const { summary, hasFailure } = summarizeToolGroup(entries);
  return {
    label: summary,
    thinking: entries.every((entry) => entry.itemType === "reasoning"),
    failed: hasFailure,
  };
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
