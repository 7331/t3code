import { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeStreamingTimelineFixture, makeThreadFixture } from "../../test-fixtures";
import { HOME_MAX_CARDS, latestHomeCardMessages, selectHomeThreads } from "./homeThreads.logic";

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
    );

    expect(selection.source).toBe("pinned");
    expect(selection.threads.map((thread) => thread.id)).toEqual(["a", "b"]);
  });

  it("falls back to the latest thread of each project when nothing is pinned", () => {
    const projectA = ProjectId.make("project-a");
    const projectB = ProjectId.make("project-b");
    const threads = [
      makeThreadFixture({ id: ThreadId.make("a-old"), projectId: projectA, updatedAt: at(1) }),
      makeThreadFixture({ id: ThreadId.make("a-new"), projectId: projectA, updatedAt: at(5) }),
      makeThreadFixture({ id: ThreadId.make("b-only"), projectId: projectB, updatedAt: at(3) }),
    ];

    const selection = selectHomeThreads(threads, "updated_at");

    expect(selection.source).toBe("recent");
    expect(selection.threads.map((thread) => thread.id)).toEqual(["a-new", "b-only"]);
  });

  it("caps the number of cards", () => {
    const threads = Array.from({ length: HOME_MAX_CARDS + 3 }, (_, index) =>
      makeThreadFixture({
        id: ThreadId.make(`pinned-${index}`),
        pinnedAt: at(index),
        pinOrderKey: `a${index}`,
      }),
    );

    expect(selectHomeThreads(threads, "updated_at").threads).toHaveLength(HOME_MAX_CARDS);
  });
});

describe("latestHomeCardMessages", () => {
  it("keeps the latest user and assistant messages in order and drops tool work", () => {
    const { visibleTurnItems } = makeStreamingTimelineFixture("Working on it");

    expect(latestHomeCardMessages(visibleTurnItems)).toEqual([
      { id: "history-user-item", role: "user", text: "Inspect", streaming: false },
      { id: "history-assistant-item", role: "assistant", text: "Done", streaming: false },
      { id: "live-user-item", role: "user", text: "Continue", streaming: false },
      { id: "live-assistant-item", role: "assistant", text: "Working on it", streaming: true },
    ]);
  });

  it("returns only the newest messages when over the limit", () => {
    const { visibleTurnItems } = makeStreamingTimelineFixture("Working on it");

    expect(latestHomeCardMessages(visibleTurnItems, 2).map((message) => message.id)).toEqual([
      "live-user-item",
      "live-assistant-item",
    ]);
  });
});
