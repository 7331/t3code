import { assert, describe, it } from "@effect/vitest";
import {
  EventId,
  NodeId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2Run,
  type OrchestrationV2StoredEvent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";

import { makeRunOutcomeRecorder } from "./RunMetrics.ts";

const at = (iso: string) => DateTime.makeUnsafe(iso);
const threadId = ThreadId.make("thread:metrics");

// Each test labels its runs with its own provider, since the metric registry is shared.
const runUpdated = (
  sequence: number,
  provider: string,
  run: Pick<OrchestrationV2Run, "id" | "status" | "startedAt" | "completedAt"> &
    Partial<OrchestrationV2Run>,
): OrchestrationV2StoredEvent => ({
  sequence,
  commandId: null,
  event: {
    type: "run.updated",
    id: EventId.make(`event:${provider}:${sequence}`),
    threadId,
    occurredAt: at("2026-10-19T12:00:00.000Z"),
    payload: {
      threadId,
      ordinal: 1,
      providerInstanceId: ProviderInstanceId.make(provider),
      modelSelection: { instanceId: ProviderInstanceId.make(provider), model: "claude-opus-5-5" },
      requestedAt: at("2026-10-19T12:00:00.000Z"),
      ...run,
    } as OrchestrationV2Run,
  },
});

const runSnapshots = (provider: string) =>
  Metric.snapshot.pipe(
    Effect.map((snapshots) =>
      snapshots.filter(
        (snapshot) =>
          snapshot.id.startsWith("t3_run") && snapshot.attributes?.["provider"] === provider,
      ),
    ),
  );

describe("makeRunOutcomeRecorder", () => {
  it.effect("records a finished run once, labelled, with its queue wait and duration", () =>
    Effect.gen(function* () {
      const record = makeRunOutcomeRecorder();
      const finished = {
        id: RunId.make("run:metrics:once"),
        status: "completed" as const,
        startedAt: at("2026-10-19T12:00:30.000Z"),
        completedAt: at("2026-10-19T12:10:30.000Z"),
        delegatedTaskId: NodeId.make("task:metrics"),
      };

      yield* record([runUpdated(1, "p1", { ...finished, status: "running", completedAt: null })]);
      yield* record([runUpdated(2, "p1", finished)]);
      // Later updates to a finished run, such as its checkpoint, are not another run.
      yield* record([runUpdated(3, "p1", finished)]);

      const snapshots = yield* runSnapshots("p1");
      const byId = (id: string) => snapshots.find((snapshot) => snapshot.id === id);
      const counter = byId("t3_runs_total");
      assert.strictEqual(counter?.type === "Counter" ? counter.state.count : undefined, 1);
      assert.deepStrictEqual(counter?.attributes, {
        provider: "p1",
        modelFamily: "claude",
        outcome: "completed",
        delegated: "true",
      });
      const histogramSum = (id: string) => {
        const snapshot = byId(id);
        return snapshot?.type === "Histogram" ? snapshot.state.sum : undefined;
      };
      assert.strictEqual(histogramSum("t3_run_queue_wait"), 30_000);
      assert.strictEqual(histogramSum("t3_run_duration"), 600_000);
    }),
  );

  it.effect("does not count a rollback of a run that already finished", () =>
    Effect.gen(function* () {
      // A fresh recorder stands in for a restart, which forgets the runs already counted.
      const record = makeRunOutcomeRecorder();
      yield* record([
        runUpdated(1, "p2", {
          id: RunId.make("run:metrics:rolled-back"),
          status: "rolled_back",
          startedAt: at("2026-10-19T12:00:30.000Z"),
          completedAt: at("2026-10-20T09:00:00.000Z"),
        }),
      ]);

      assert.deepStrictEqual(yield* runSnapshots("p2"), []);
    }),
  );

  it.effect("counts a run cancelled before it started without timing it", () =>
    Effect.gen(function* () {
      const record = makeRunOutcomeRecorder();
      yield* record([
        runUpdated(1, "p3", {
          id: RunId.make("run:metrics:cancelled"),
          status: "cancelled",
          startedAt: null,
          completedAt: at("2026-10-19T12:01:00.000Z"),
        }),
      ]);

      assert.deepStrictEqual(
        (yield* runSnapshots("p3")).map((snapshot) => snapshot.id),
        ["t3_runs_total"],
      );
    }),
  );
});
