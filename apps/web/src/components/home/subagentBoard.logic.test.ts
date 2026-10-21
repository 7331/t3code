import { deriveThreadRelationshipGraph } from "@t3tools/client-runtime/state/thread-relationships";
import { ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { HOME_MAX_CARDS } from "./homeThreads.logic";
import { selectSubagentBoardChildren } from "./subagentBoard.logic";

const parent = ThreadId.make("parent");

function shell(input: {
  readonly id: string;
  readonly minute: number;
  readonly status: string;
  readonly relationship?: "subagent" | "fork";
  readonly creationSource?: "provider" | "mcp";
  readonly parentId?: ThreadId | null;
}) {
  return {
    id: ThreadId.make(input.id),
    title: input.id,
    status: input.status,
    creationSource: input.creationSource ?? "mcp",
    createdAt: DateTime.makeUnsafe(Date.UTC(2026, 9, 21, 9, input.minute)),
    lineage: {
      rootThreadId: parent,
      parentThreadId: input.parentId === undefined ? parent : input.parentId,
      relationshipToParent: input.relationship ?? "subagent",
    },
  };
}

function select(threads: ReadonlyArray<ReturnType<typeof shell>>) {
  const graph = deriveThreadRelationshipGraph({
    threads: [shell({ id: "parent", minute: 0, status: "running", parentId: null }), ...threads],
    projection: null,
  } as never);
  return selectSubagentBoardChildren(graph, parent);
}

describe("selectSubagentBoardChildren", () => {
  it("marks provider-native subagents read-only and T3-owned ones repliable", () => {
    const { children } = select([
      shell({ id: "native", minute: 1, status: "running", creationSource: "provider" }),
      shell({ id: "delegated", minute: 2, status: "running", creationSource: "mcp" }),
    ]);

    expect(children).toEqual([
      { threadId: "delegated", readOnly: false, active: true },
      { threadId: "native", readOnly: true, active: true },
    ]);
  });

  it("lists only this thread's subagents, active first and then newest first", () => {
    const { children } = select([
      shell({ id: "done-new", minute: 5, status: "completed" }),
      shell({ id: "running-old", minute: 1, status: "running" }),
      shell({ id: "done-old", minute: 2, status: "failed" }),
      shell({ id: "fork", minute: 6, status: "running", relationship: "fork" }),
      shell({
        id: "grandchild",
        minute: 7,
        status: "running",
        parentId: ThreadId.make("done-new"),
      }),
    ]);

    expect(children.map((child) => child.threadId)).toEqual([
      "running-old",
      "done-new",
      "done-old",
    ]);
  });

  it("caps the board and counts the subagents left off", () => {
    const total = HOME_MAX_CARDS + 2;
    const selection = select(
      Array.from({ length: total }, (_, index) =>
        shell({ id: `agent-${index}`, minute: index + 1, status: "completed" }),
      ),
    );

    expect(selection.children).toHaveLength(HOME_MAX_CARDS - 1);
    expect(selection.children[0]?.threadId).toBe(`agent-${total - 1}`);
    expect(selection.hiddenCount).toBe(total - (HOME_MAX_CARDS - 1));
  });
});
