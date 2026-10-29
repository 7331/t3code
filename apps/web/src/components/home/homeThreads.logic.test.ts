import { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeStreamingTimelineFixture, makeThreadFixture } from "../../test-fixtures";
import {
  HOME_MAX_CARDS,
  homeCardSpansFullWidth,
  homeCardSubtitle,
  homeCardThreadActions,
  homeCardActivityLabel,
  latestHomeCardRows,
  selectHomeRailThreads,
  selectHomeThreads,
} from "./homeThreads.logic";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 21, 9, minute)).toISOString();

describe("selectHomeThreads", () => {
  it("shows pinned threads in pin order and skips archived and subagent threads", () => {
    const first = makeThreadFixture({ id: ThreadId.make("a"), pinnedAt: at(1), pinOrderKey: "a0" });
    const second = makeThreadFixture({
      id: ThreadId.make("b"),
      pinnedAt: at(2),
      pinOrderKey: "a1",
    });
    const archived = makeThreadFixture({
      id: ThreadId.make("archived"),
      pinnedAt: at(3),
      pinOrderKey: "Zz",
      archivedAt: at(4),
    });
    const subagent = makeThreadFixture({
      id: ThreadId.make("subagent"),
      pinnedAt: at(3),
      pinOrderKey: "Zy",
      lineage: {
        rootThreadId: first.id,
        parentThreadId: first.id,
        relationshipToParent: "subagent",
      },
    });
    const unpinned = makeThreadFixture({ id: ThreadId.make("loose"), updatedAt: at(9) });

    const selection = selectHomeThreads(
      [unpinned, second, archived, subagent, first],
      "updated_at",
      new Set(),
    );

    expect(selection.source).toBe("pinned");
    expect(selection.threads.map((thread) => thread.id)).toEqual(["a", "b"]);
  });

  it("falls back to the latest thread of each project when nothing is pinned", () => {
    const projectA = ProjectId.make("project-a");
    const projectB = ProjectId.make("project-b");
    const threads = [
      makeThreadFixture({
        id: ThreadId.make("a-old"),
        projectId: projectA,
        updatedAt: at(1),
        visibleItemCount: 4,
      }),
      makeThreadFixture({
        id: ThreadId.make("a-new"),
        projectId: projectA,
        updatedAt: at(5),
        visibleItemCount: 2,
      }),
      makeThreadFixture({
        id: ThreadId.make("b-only"),
        projectId: projectB,
        updatedAt: at(3),
        visibleItemCount: 1,
      }),
    ];

    const selection = selectHomeThreads(threads, "updated_at", new Set());

    expect(selection.source).toBe("recent");
    expect(selection.threads.map((thread) => thread.id)).toEqual(["a-new", "b-only"]);
  });

  it("skips empty threads in the recent fallback, keeping each project's latest with messages", () => {
    const projectA = ProjectId.make("project-a");
    const projectB = ProjectId.make("project-b");
    const threads = [
      makeThreadFixture({
        id: ThreadId.make("a-empty"),
        projectId: projectA,
        updatedAt: at(9),
        visibleItemCount: 0,
      }),
      makeThreadFixture({
        id: ThreadId.make("a-talked"),
        projectId: projectA,
        updatedAt: at(2),
        visibleItemCount: 3,
      }),
      makeThreadFixture({
        id: ThreadId.make("b-empty"),
        projectId: projectB,
        updatedAt: at(8),
        visibleItemCount: 0,
      }),
    ];

    expect(
      selectHomeThreads(threads, "updated_at", new Set()).threads.map((thread) => thread.id),
    ).toEqual(["a-talked"]);
  });

  it("still shows an empty thread the user pinned", () => {
    const pinnedEmpty = makeThreadFixture({
      id: ThreadId.make("pinned-empty"),
      pinnedAt: at(1),
      visibleItemCount: 0,
    });

    expect(selectHomeThreads([pinnedEmpty], "updated_at", new Set()).threads).toEqual([
      pinnedEmpty,
    ]);
  });

  it("caps the number of cards", () => {
    const threads = Array.from({ length: HOME_MAX_CARDS + 3 }, (_, index) =>
      makeThreadFixture({
        id: ThreadId.make(`pinned-${index}`),
        pinnedAt: at(index),
        pinOrderKey: `a${index}`,
      }),
    );

    expect(selectHomeThreads(threads, "updated_at", new Set()).threads).toHaveLength(
      HOME_MAX_CARDS,
    );
  });
});

describe("selectHomeRailThreads", () => {
  it("lists pinned and recent side by side without repeating a thread", () => {
    const pinned = makeThreadFixture({
      id: ThreadId.make("pin"),
      pinnedAt: at(1),
      pinOrderKey: "a0",
      updatedAt: at(2),
    });
    const otherProjectRecent = makeThreadFixture({
      id: ThreadId.make("fresh"),
      projectId: ProjectId.make("other"),
      updatedAt: at(9),
      visibleItemCount: 3,
    });
    const selection = selectHomeRailThreads([pinned, otherProjectRecent], "updated_at", new Set());
    expect(selection.pinned.map((thread) => thread.id)).toEqual([pinned.id]);
    expect(selection.recent.map((thread) => thread.id)).toEqual([otherProjectRecent.id]);
  });

  it("keeps one recent thread per project and skips empty and pinned threads", () => {
    const pinnedFresh = makeThreadFixture({
      id: ThreadId.make("pinned-fresh"),
      pinnedAt: at(1),
      pinOrderKey: "a0",
      updatedAt: at(8),
      visibleItemCount: 5,
    });
    const olderSameProject = makeThreadFixture({
      id: ThreadId.make("older"),
      updatedAt: at(3),
      visibleItemCount: 2,
    });
    const emptyThread = makeThreadFixture({
      id: ThreadId.make("empty"),
      updatedAt: at(7),
      visibleItemCount: 0,
    });
    const selection = selectHomeRailThreads(
      [pinnedFresh, olderSameProject, emptyThread],
      "updated_at",
      new Set(),
    );
    expect(selection.pinned.map((thread) => thread.id)).toEqual([pinnedFresh.id]);
    expect(selection.recent).toEqual([]);
  });
});

describe("latestHomeCardRows", () => {
  const summarize = (rows: ReturnType<typeof latestHomeCardRows>) =>
    rows.map((row) =>
      row.kind === "message"
        ? `${row.role}:${row.text}`
        : `activity:${row.entries.map((entry) => entry.itemType).join(",")}`,
    );

  it("keeps messages in order and folds the work between them into one row each", () => {
    const { visibleTurnItems } = makeStreamingTimelineFixture("Working on it");

    expect(summarize(latestHomeCardRows(visibleTurnItems, 4))).toEqual([
      "user:Inspect",
      "activity:command_execution",
      "assistant:Done",
      "user:Continue",
      "activity:dynamic_tool",
      "assistant:Working on it",
    ]);
  });

  it("previews the last three messages and drops work that came before them", () => {
    const { visibleTurnItems } = makeStreamingTimelineFixture("Working on it");

    expect(summarize(latestHomeCardRows(visibleTurnItems))).toEqual([
      "assistant:Done",
      "user:Continue",
      "activity:dynamic_tool",
      "assistant:Working on it",
    ]);
  });

  it("shows work the agent is doing before it has written any reply", () => {
    const { visibleTurnItems } = makeStreamingTimelineFixture("");

    expect(summarize(latestHomeCardRows(visibleTurnItems)).slice(-2)).toEqual([
      "user:Continue",
      "activity:dynamic_tool",
    ]);
  });
});

describe("homeCardActivityLabel", () => {
  const activity = (text: string) => {
    const row = latestHomeCardRows(makeStreamingTimelineFixture(text).visibleTurnItems, 4).find(
      (candidate) => candidate.kind === "activity",
    );
    if (row?.kind !== "activity") throw new Error("fixture has no activity row");
    return row.entries;
  };

  it("summarizes finished work the way the thread's work log does, flagging failures", () => {
    expect(homeCardActivityLabel(activity("Working on it"), false, "/repo")).toEqual({
      label: "Ran 1 command",
      thinking: false,
      failed: true,
    });
  });

  it("leads with the thought's heading while the agent is thinking", () => {
    const thought = {
      id: "thought",
      createdAt: at(1),
      label: "Reasoning",
      tone: "thinking" as const,
      itemType: "reasoning" as const,
      detail: "**Checking the cart totals**\n\nThe discount runs before shipping.",
    };

    expect(homeCardActivityLabel([thought], true, "/repo")).toEqual({
      label: "Checking the cart totals",
      thinking: true,
      failed: false,
    });
    expect(homeCardActivityLabel([thought], false, "/repo").label).toBe("Thought");
  });
});

describe("homeCardSpansFullWidth", () => {
  const spans = (count: number) =>
    Array.from({ length: count }, (_, index) => homeCardSpansFullWidth(index, count));

  it("pairs cards side by side and gives the first a full row only when the count is odd", () => {
    expect(spans(1)).toEqual([true]);
    expect(spans(2)).toEqual([false, false]);
    expect(spans(3)).toEqual([true, false, false]);
    expect(spans(4)).toEqual([false, false, false, false]);
    expect(spans(5)).toEqual([true, false, false, false, false]);
  });
});

describe("homeCardThreadActions", () => {
  const topLevel = makeThreadFixture({ id: ThreadId.make("top") });
  const fork = makeThreadFixture({
    id: ThreadId.make("fork"),
    lineage: {
      rootThreadId: topLevel.id,
      parentThreadId: topLevel.id,
      relationshipToParent: "fork",
    },
  });
  const subagent = makeThreadFixture({
    id: ThreadId.make("child"),
    lineage: {
      rootThreadId: topLevel.id,
      parentThreadId: topLevel.id,
      relationshipToParent: "subagent",
    },
  });
  const supported = { supportsPinning: true, supportsSettlement: true };

  it("offers pin and settle on top-level threads, forks included", () => {
    expect(homeCardThreadActions({ thread: topLevel, ...supported })).toEqual({
      pin: true,
      settle: true,
    });
    expect(homeCardThreadActions({ thread: fork, ...supported })).toEqual({
      pin: true,
      settle: true,
    });
  });

  it("never offers them on subagent threads, which have no sidebar row", () => {
    expect(homeCardThreadActions({ thread: subagent, ...supported })).toEqual({
      pin: false,
      settle: false,
    });
  });

  it("follows the environment's capabilities", () => {
    expect(
      homeCardThreadActions({
        thread: topLevel,
        supportsPinning: false,
        supportsSettlement: true,
      }),
    ).toEqual({ pin: false, settle: true });
  });
});

describe("homeCardSubtitle", () => {
  it("joins project and branch, skipping what a thread lacks", () => {
    expect(homeCardSubtitle({ projectTitle: "Desktop", branch: "feat/home" })).toBe(
      "Desktop · feat/home",
    );
    expect(homeCardSubtitle({ projectTitle: "Desktop", branch: null })).toBe("Desktop");
  });
});
