import {
  immediateThreadRelationships,
  isParentThreadRelationship,
  orderWebThreadLineageRows,
  isSettledSubagentStatus,
  threadRelationshipRowStatus,
  type ThreadRelationshipGraph,
} from "@t3tools/client-runtime/state/thread-relationships";
import { formatSubagentDisplayTitle } from "@t3tools/client-runtime/state/subagent-display";
import { isProviderNativeSubagentThread, type ThreadId } from "@t3tools/contracts";

import { HOME_MAX_CARDS } from "./homeThreads.logic";

export interface SubagentBoardChild {
  readonly threadId: ThreadId;
  /** Provider-native subagents belong to the provider's conversation; the server rejects messages. */
  readonly readOnly: boolean;
  readonly active: boolean;
  /** The subagent's status as the Lineage panel reads it, which outlives the child's own turn. */
  readonly status: string | null;
}

export interface SubagentBoardSelection {
  readonly children: ReadonlyArray<SubagentBoardChild>;
  /** Subagents left off the board by the card cap. */
  readonly hiddenCount: number;
  /** Every live subagent thread of the parent, shown or not. */
  readonly total: number;
  /** Active subagents among all of them, not only the shown ones. */
  readonly activeCount: number;
}

/**
 * A thread's live subagent threads for the board: active first, then newest first, capped so the
 * board plus its parent card stays within Home's card budget. Archived threads and threads the
 * client holds no shell for are left out, so counts always match what the board can show.
 */
export function selectSubagentBoardChildren(input: {
  readonly graph: ThreadRelationshipGraph;
  readonly parentThreadId: ThreadId;
  /** Lineage's workflow statuses, keyed by child thread, which win over the edge's own. */
  readonly statusOverrides?: ReadonlyMap<string, string>;
  readonly isAvailable?: (threadId: ThreadId) => boolean;
}): SubagentBoardSelection {
  const { graph, parentThreadId } = input;
  const rows = orderWebThreadLineageRows({
    graph,
    rows: immediateThreadRelationships(graph, parentThreadId).filter((row) => {
      const thread = graph.nodes.get(row.threadId)?.thread;
      return (
        row.edge.kind === "subagent" &&
        !isParentThreadRelationship(row.edge, parentThreadId) &&
        thread != null &&
        thread.archivedAt === null &&
        (input.isAvailable?.(row.threadId) ?? true)
      );
    }),
    currentThreadId: parentThreadId,
    mergeTargetThreadId: null,
  });
  const children = rows.map((row): SubagentBoardChild => {
    const thread = graph.nodes.get(row.threadId)!.thread!;
    const status =
      input.statusOverrides?.get(row.threadId) ?? threadRelationshipRowStatus(graph, row);
    return {
      threadId: row.threadId,
      readOnly: isProviderNativeSubagentThread(thread),
      active: !isSettledSubagentStatus(status),
      status,
    };
  });
  const ordered = [
    ...children.filter((child) => child.active),
    ...children.filter((child) => !child.active),
  ];
  const limit = HOME_MAX_CARDS - 1;
  return {
    children: ordered.slice(0, limit),
    hiddenCount: Math.max(0, ordered.length - limit),
    total: ordered.length,
    activeCount: children.filter((child) => child.active).length,
  };
}

/**
 * A subagent card's name: the subagent's own title when the provider or delegate gave one (a task
 * description, a teammate name), else its thread title as the Lineage panel shows it.
 */
export function subagentCardTitle(threadTitle: string, subagentTitle: string | null | undefined) {
  const named = subagentTitle?.trim();
  return named ? named : formatSubagentDisplayTitle(threadTitle);
}

export type SubagentStatusTone = "active" | "done" | "failed" | "muted";

/** How a subagent card colours its status, matching what the board counts as active. */
export function subagentStatusTone(status: string | null): SubagentStatusTone {
  if (status === "completed") return "done";
  if (status === "failed" || status === "error") return "failed";
  return isSettledSubagentStatus(status) ? "muted" : "active";
}
