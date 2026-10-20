import { assert, describe, it } from "@effect/vitest";
import {
  EventId,
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

const runUpdated = (
  sequence: number,
  run: Pick<OrchestrationV2Run, "id" | "status" | "startedAt" | "completedAt">,
  provider: string,
): OrchestrationV2StoredEvent => ({
  sequence,
  commandId: null,
  event: {
    type: "run.updated",
    id: EventId.make(`event:${sequence}`),
    threadId: ThreadId.make("thread:metrics"),
    occurredAt: at("2026-10-19T12:00:00.000Z"),
    payload: {
      threadId: ThreadId.make("thread:metrics"),
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
  it.effect("records a finished run once, with how long it waited and ran", () =>
    Effect.gen(function* () {
      const record = makeRunOutcomeRecorder();
      const id = RunId.make("run:metrics:once");
      const started = { startedAt: at("2026-10-19T12:00:30.000Z") };

      yield* record([
        runUpdated(1, { id, status: "running", ...started, completedAt: null }, "p1"),
      ]);
      const finished = { id, status: "completed" as const, ...started };
      yield* record([
        runUpdated(2, { ...finished, completedAt: at("2026-10-19T12:10:30.000Z") }, "p1"),
      ]);
      // A later update to the finished run, such as its checkpoint, is not a second run.
      yield* record([
        runUpdated(3, { ...finished, completedAt: at("2026-10-19T12:10:30.000Z") }, "p1"),
      ]);

      const snapshots = yield* runSnapshots("p1");
      const counter = snapshots.find((snapshot) => snapshot.id === "t3_runs_total");
      assert.strictEqual(counter?.type === "Counter" ? counter.state.count : undefined, 1);
      assert.strictEqual(counter?.attributes?.["outcome"], "completed");
      assert.strictEqual(counter?.attributes?.["modelFamily"], "claude");
      const histogram = (id: string) => {
        const snapshot = snapshots.find((candidate) => candidate.id === id);
        return snapshot?.type === "Histogram" ? snapshot.state : undefined;
      };
      assert.strictEqual(histogram("t3_run_duration")?.sum, 600_000);
      assert.strictEqual(histogram("t3_run_queue_wait")?.sum, 30_000);
    }),
  );

  it.effect("counts a run cancelled before it started without timing it", () =>
    Effect.gen(function* () {
      const record = makeRunOutcomeRecorder();
      yield* record([
        runUpdated(
          1,
          {
            id: RunId.make("run:metrics:cancelled"),
            status: "cancelled",
            startedAt: null,
            completedAt: at("2026-10-19T12:01:00.000Z"),
          },
          "p2",
        ),
      ]);

      const snapshots = yield* runSnapshots("p2");
      assert.deepStrictEqual(
        snapshots.map((snapshot) => snapshot.id),
        ["t3_runs_total"],
      );
    }),
  );
});
