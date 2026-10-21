import {
  immediateThreadRelationships,
  isParentThreadRelationship,
  orderWebThreadLineageRows,
  threadRelationshipRowStatus,
  type ThreadRelationshipGraph,
} from "@t3tools/client-runtime/state/thread-relationships";
import { formatSubagentDisplayTitle } from "@t3tools/client-runtime/state/subagent-display";
import { isProviderNativeSubagentThread, type ThreadId } from "@t3tools/contracts";

import { HOME_MAX_CARDS } from "./homeThreads.logic";

/** The same settled set the Lineage panel files under "Previous agents". */
const SETTLED_SUBAGENT_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "error",
  "cancelled",
  "interrupted",
  "idle",
]);

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
}

/**
 * A thread's own subagent threads for the board: active first, then newest first, capped so the
 * board plus its parent card stays within Home's card budget.
 */
export function selectSubagentBoardChildren(
  graph: ThreadRelationshipGraph,
  parentThreadId: ThreadId,
): SubagentBoardSelection {
  const rows = orderWebThreadLineageRows({
    graph,
    rows: immediateThreadRelationships(graph, parentThreadId).filter(
      (row) =>
        row.edge.kind === "subagent" &&
        !isParentThreadRelationship(row.edge, parentThreadId) &&
        graph.nodes.get(row.threadId)?.thread != null,
    ),
    currentThreadId: parentThreadId,
    mergeTargetThreadId: null,
  });
  const children = rows.map((row): SubagentBoardChild => {
    const thread = graph.nodes.get(row.threadId)!.thread!;
    const status = threadRelationshipRowStatus(graph, row);
    return {
      threadId: row.threadId,
      readOnly: isProviderNativeSubagentThread(thread),
      active: status !== null && !SETTLED_SUBAGENT_STATUSES.has(status),
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

/** How a subagent card colours its status; still work is never animated. */
export function subagentStatusTone(status: string | null): SubagentStatusTone {
  if (status === "completed") return "done";
  if (status === "failed" || status === "error") return "failed";
  if (status === null || SETTLED_SUBAGENT_STATUSES.has(status)) return "muted";
  return "active";
}
