import { deriveThreadRelationshipGraph } from "@t3tools/client-runtime/state/thread-relationships";
import { ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { HOME_MAX_CARDS } from "./homeThreads.logic";
import {
  selectSubagentBoardChildren,
  subagentCardTitle,
  subagentStatusTone,
} from "./subagentBoard.logic";

const parent = ThreadId.make("parent");

function shell(input: {
  readonly id: string;
  readonly minute: number;
  readonly status: string;
  readonly relationship?: "subagent" | "fork";
  readonly creationSource?: "provider" | "mcp";
  readonly parentId?: ThreadId | null;
  readonly archived?: boolean;
}) {
  return {
    id: ThreadId.make(input.id),
    archivedAt: input.archived ? "2026-10-21T10:00:00.000Z" : null,
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

function select(
  threads: ReadonlyArray<ReturnType<typeof shell>>,
  options: {
    readonly statusOverrides?: ReadonlyMap<string, string>;
    readonly isAvailable?: (threadId: ThreadId) => boolean;
  } = {},
) {
  const graph = deriveThreadRelationshipGraph({
    threads: [shell({ id: "parent", minute: 0, status: "running", parentId: null }), ...threads],
    projection: null,
  } as never);
  return selectSubagentBoardChildren({ graph, parentThreadId: parent, ...options });
}

describe("selectSubagentBoardChildren", () => {
  it("marks provider-native subagents read-only and T3-owned ones repliable", () => {
    const { children } = select([
      shell({ id: "native", minute: 1, status: "running", creationSource: "provider" }),
      shell({ id: "delegated", minute: 2, status: "running", creationSource: "mcp" }),
    ]);

    expect(children).toEqual([
      { threadId: "delegated", readOnly: false, active: true, status: "running" },
      { threadId: "native", readOnly: true, active: true, status: "running" },
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

  it("leaves out archived subagents and ones the client holds no shell for", () => {
    const selection = select(
      [
        shell({ id: "live", minute: 1, status: "running" }),
        shell({ id: "archived", minute: 2, status: "running", archived: true }),
        shell({ id: "unknown", minute: 3, status: "running" }),
      ],
      { isAvailable: (threadId) => threadId !== "unknown" },
    );

    expect(selection.children.map((child) => child.threadId)).toEqual(["live"]);
    expect(selection.total).toBe(1);
  });

  it("uses Lineage's workflow status over the child's own", () => {
    const { children } = select([shell({ id: "coordinator", minute: 1, status: "completed" })], {
      statusOverrides: new Map([["coordinator", "running"]]),
    });

    expect(children).toEqual([
      { threadId: "coordinator", readOnly: false, active: true, status: "running" },
    ]);
  });

  it("counts active subagents across the whole fan-out, not only the shown cards", () => {
    const selection = select(
      Array.from({ length: HOME_MAX_CARDS + 2 }, (_, index) =>
        shell({ id: `worker-${index}`, minute: index + 1, status: "running" }),
      ),
    );

    expect(selection.children).toHaveLength(HOME_MAX_CARDS - 1);
    expect(selection.total).toBe(HOME_MAX_CARDS + 2);
    expect(selection.activeCount).toBe(HOME_MAX_CARDS + 2);
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

describe("subagentCardTitle", () => {
  it("prefers the subagent's own title over its prompt-derived thread title", () => {
    expect(subagentCardTitle("You are part of a 6-agent team building…", "scaffold")).toBe(
      "scaffold",
    );
  });

  it("falls back to the thread title as the Lineage panel formats it", () => {
    expect(subagentCardTitle("Subagent: Review the diff", null)).toBe("Review the diff");
    expect(subagentCardTitle("Reply with ok", "  ")).toBe("Reply with ok");
  });
});

describe("subagentStatusTone", () => {
  it("separates live, finished, failed and stopped subagents", () => {
    expect(["running", "waiting", "queued"].map(subagentStatusTone)).toEqual([
      "active",
      "active",
      "active",
    ]);
    expect(subagentStatusTone("completed")).toBe("done");
    expect(subagentStatusTone("error")).toBe("failed");
    expect(["cancelled", "idle"].map(subagentStatusTone)).toEqual(["muted", "muted"]);
    // Lineage files an unknown status with the live agents, so the card does too.
    expect(subagentStatusTone(null)).toBe("active");
  });
});
