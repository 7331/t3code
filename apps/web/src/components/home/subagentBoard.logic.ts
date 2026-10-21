import {
  immediateThreadRelationships,
  isParentThreadRelationship,
  orderWebThreadLineageRows,
  threadRelationshipRowStatus,
  type ThreadRelationshipGraph,
} from "@t3tools/client-runtime/state/thread-relationships";
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
