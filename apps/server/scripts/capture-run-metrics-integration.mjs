// Production EventSink/SQLite evidence, with failure injection only at external boundaries.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeAssert from "node:assert/strict";
import * as NodeModule from "node:module";
import * as NodeURL from "node:url";
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
const { values } = NodeUtil.parseArgs({
  options: { root: { type: "string" }, out: { type: "string" } },
});
const root = NodePath.resolve(values.root ?? NodePath.resolve(import.meta.dirname, "../../.."));
const require = NodeModule.createRequire(root + "/apps/server/package.json");
const load = (s) => import(NodeURL.pathToFileURL(require.resolve(s)).href);
const local = (s) => import(NodeURL.pathToFileURL(root + "/apps/server/src/" + s + ".ts").href);
const [Effect, Layer, Metric, DateTime, Fiber] = await Promise.all(
  ["effect/Effect", "effect/Layer", "effect/Metric", "effect/DateTime", "effect/Fiber"].map(load),
);
const [Database, EventSink, EventStore, ProjectionStore] = await Promise.all(
  [
    "persistence/Sqlite",
    "orchestration-v2/EventSink",
    "orchestration-v2/EventStore",
    "orchestration-v2/ProjectionStore",
  ].map(local),
);
const feature = NodeFS.existsSync(root + "/apps/server/src/orchestration-v2/RunMetrics.ts");
const sha = NodeChildProcess.execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const db = Database.layerMemory;
const stores = Layer.mergeAll(
  db,
  EventStore.layer.pipe(Layer.provide(db)),
  ProjectionStore.layer.pipe(Layer.provide(db)),
);
const at = (s) => DateTime.makeUnsafe(1792411200000 + s * 1000);
const now = at(630);
let seq = 0;
const threadId = "thread:integration";
const thread = {
  createdBy: "user",
  creationSource: "web",
  id: threadId,
  projectId: "project:proof",
  title: "Metric proof",
  providerInstanceId: "proof_primary",
  modelSelection: { instanceId: "proof_primary", model: "gpt-6.1" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  activeProviderThreadId: null,
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
  forkedFrom: null,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  lastVisitedAt: null,
  deletedAt: null,
};
const run = {
  id: "run:integration",
  threadId,
  ordinal: 1,
  providerInstanceId: "proof_primary",
  modelSelection: thread.modelSelection,
  providerThreadId: null,
  userMessageId: "message:proof",
  rootNodeId: null,
  activeAttemptId: "attempt:proof",
  status: "completed",
  queuePosition: null,
  requestedAt: at(0),
  startedAt: at(30),
  completedAt: at(630),
  checkpointId: null,
  contextHandoffId: null,
};
const providerThread = {
  id: "provider-thread:proof",
  driver: "codex",
  providerInstanceId: "proof_primary",
  providerSessionId: null,
  appThreadId: threadId,
  ownerNodeId: null,
  nativeThreadRef: null,
  nativeConversationHeadRef: null,
  status: "idle",
  firstRunOrdinal: 1,
  lastRunOrdinal: 1,
  handoffIds: [],
  forkedFrom: null,
  createdAt: now,
  updatedAt: now,
};
const event = (type, payload) => ({
  id: "event:" + ++seq,
  type,
  threadId,
  occurredAt: now,
  payload,
});
const runEvent = () => event("run.updated", run);
const snapshot = Metric.snapshot.pipe(
  Effect.map((ss) => ss.filter((s) => s.id.startsWith("t3_run"))),
);
const result = [];
for (const id of ["I01", "I02-current", "I02-owner", "I02-unchanged", "I03", "I04"]) {
  const program = Effect.gen(function* () {
    const eventStore = yield* EventStore.EventStoreV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    let failApply = false;
    let failPublish = false;
    let captured = [];
    let publicationCalls = 0;
    let retryBatch;
    const wrapped = Layer.mergeAll(
      Layer.succeed(EventStore.EventStoreV2, {
        ...eventStore,
        append: (input) => (retryBatch ? Effect.succeed(retryBatch) : eventStore.append(input)),
        publishCommitted: (events) =>
          Effect.suspend(() => {
            publicationCalls++;
            captured.push(...events);
            if (failPublish) {
              failPublish = false;
              return Effect.die("injected publication failure after commit");
            }
            return eventStore.publishCommitted(events);
          }),
      }),
      Layer.succeed(ProjectionStore.ProjectionStoreV2, {
        ...projections,
        apply: (e) =>
          failApply ? Effect.fail("injected projection failure") : projections.apply(e),
      }),
    );
    const sinkLayer = EventSink.layer.pipe(Layer.provide(wrapped), Layer.provide(stores));
    return yield* Effect.gen(function* () {
      const sink = yield* EventSink.EventSinkV2;
      yield* sink.write({
        events: [
          event("thread.created", thread),
          event("run.created", { ...run, status: "running", completedAt: null }),
          event("provider-thread.updated", providerThread),
        ],
      });
      const before = yield* snapshot;
      const beforeSequence = yield* eventStore.latestSequence();
      const beforePublication = publicationCalls;
      let observations = {};
      let input;
      if (id === "I01") {
        input = { events: [runEvent()] };
        failApply = true;
        const exit = yield* Effect.exit(sink.write(input));
        failApply = false;
        observations = { exit: exit._tag, sequence: yield* eventStore.latestSequence() };
        NodeAssert.equal(exit._tag, "Failure");
        NodeAssert.equal(observations.sequence, beforeSequence);
      } else if (id === "I02-current") {
        input = {
          threadId,
          runId: run.id,
          activeAttemptId: "stale",
          expectedStatus: "running",
          events: [runEvent()],
        };
        observations = yield* sink.writeIfRunCurrent(input);
        NodeAssert.equal(observations.committed, false);
      } else if (id === "I02-owner") {
        input = {
          providerThreadId: providerThread.id,
          runId: run.id,
          activeAttemptId: "stale",
          expectedLastRunOrdinal: 99,
          events: [runEvent()],
        };
        observations = yield* sink.writeIfProviderThreadOwner(input);
        NodeAssert.equal(observations.committed, false);
      } else if (id === "I02-unchanged") {
        input = { expected: { ...providerThread, updatedAt: at(900) }, events: [runEvent()] };
        observations = yield* sink.writeIfProviderThreadUnchanged(input);
        NodeAssert.equal(observations.committed, false);
      } else if (id === "I03") {
        input = {
          commandId: "command:proof",
          threadId,
          commandType: "message.dispatch",
          acceptedAt: now,
          events: [runEvent()],
          effects: [],
        };
        const first = yield* sink.commitCommand(input);
        const middle = yield* snapshot;
        const second = yield* sink.commitCommand(input);
        observations = { first, second, middle };
        NodeAssert.equal(first.committed, true);
        NodeAssert.equal(second.committed, false);
      } else {
        input = { events: [runEvent()] };
        failPublish = true;
        const first = yield* Effect.exit(sink.write(input));
        const middle = yield* snapshot;
        NodeAssert.equal(first._tag, "Failure");
        NodeAssert.equal(yield* eventStore.latestSequence(), beforeSequence + 1);
        // Replay the persisted batch at the append boundary without inserting duplicate event IDs.
        retryBatch = captured.slice(-1);
        const second = yield* Effect.exit(sink.write(input));
        NodeAssert.equal(second._tag, "Success");
        observations = { first: first._tag, second: second._tag, middle };
      }
      const after = yield* snapshot;
      const counter = after
        .filter((s) => s.id === "t3_runs_total")
        .reduce((n, s) => n + s.state.count, 0);
      const expected = feature && ["I03", "I04"].includes(id) ? 1 : 0;
      NodeAssert.equal(counter, expected, id);
      if (expected) {
        NodeAssert.equal(after.find((s) => s.id === "t3_run_queue_wait").state.sum, 30000);
        NodeAssert.equal(after.find((s) => s.id === "t3_run_duration").state.sum, 600000);
      }
      if (id === "I04") NodeAssert.deepEqual(after, observations.middle);
      if (id === "I03") NodeAssert.deepEqual(after, observations.middle);
      if (id === "I01") NodeAssert.equal(publicationCalls, beforePublication);
      return {
        row: id,
        route: "HARNESS CAPTURE / production EventSink + in-memory SQLite",
        sha,
        feature,
        input,
        before,
        after,
        observations,
        captured,
        publicationCalls,
        status: "passed",
      };
    }).pipe(Effect.provide(sinkLayer));
  }).pipe(
    Effect.provide(stores),
    Effect.scoped,
    Effect.provideService(Metric.MetricRegistry, new Map()),
  );
  result.push(await Effect.runPromise(program));
}
// The production EventSink labels runs from the committed thread lineage.
{
  const childId = "thread:integration-child";
  const child = {
    ...thread,
    id: childId,
    lineage: { parentThreadId: threadId, relationshipToParent: "subagent", rootThreadId: threadId },
  };
  const eventOn = (tid, type, payload) => ({ ...event(type, payload), threadId: tid });
  const runs = [
    { ...run, id: "run:i06-parent" },
    { ...run, id: "run:i06-child-initial", threadId: childId },
    {
      ...run,
      id: "run:i06-child-followup",
      threadId: childId,
      ordinal: 2,
      delegatedTaskId: "task:i06",
    },
  ];
  const program = Effect.gen(function* () {
    const sink = yield* EventSink.EventSinkV2;
    yield* sink.write({
      events: [
        event("thread.created", thread),
        eventOn(childId, "thread.created", child),
        ...runs.map((r) =>
          eventOn(r.threadId, "run.created", { ...r, status: "running", completedAt: null }),
        ),
      ],
    });
    const before = yield* snapshot;
    yield* sink.write({ events: runs.map((r) => eventOn(r.threadId, "run.updated", r)) });
    const after = yield* snapshot;
    const counts = Object.fromEntries(
      after
        .filter((s) => s.id === "t3_runs_total")
        .map((s) => [s.attributes.delegated, s.state.count]),
    );
    NodeAssert.deepEqual(counts, feature ? { false: 1, true: 2 } : {});
    return {
      row: "I06",
      route: "HARNESS CAPTURE / production EventSink + projection lineage",
      sha,
      feature,
      input: { threads: [thread, child], runs },
      before,
      after,
      observations: { counts },
      status: "passed",
    };
  }).pipe(
    Effect.provide(EventSink.layer.pipe(Layer.provideMerge(stores))),
    Effect.scoped,
    Effect.provideService(Metric.MetricRegistry, new Map()),
  );
  result.push(await Effect.runPromise(program));
}
// Synchronous metric hooks request fiber interruption exactly after the first instrument update.
if (feature) {
  const { makeRunOutcomeRecorder } = await local("orchestration-v2/RunMetrics");
  const registry = new Map();
  let fiber;
  const milestone = Promise.withResolvers();
  const release = Promise.withResolvers();
  const originalSet = registry.set.bind(registry);
  registry.set = (key, value) => {
    if (value.id === "t3_runs_total") {
      const original = value.hooks.update;
      value.hooks.update = (input, context) => {
        original(input, context);
        milestone.resolve();
        fiber.interruptUnsafe();
      };
    }
    return originalSet(key, value);
  };
  const program = Effect.gen(function* () {
    yield* Effect.promise(() => release.promise);
    yield* makeRunOutcomeRecorder(() => Effect.succeed(false))([
      { sequence: 1, commandId: null, event: runEvent() },
    ]);
  });
  fiber = Effect.runFork(program.pipe(Effect.provideService(Metric.MetricRegistry, registry)));
  release.resolve();
  await milestone.promise;
  const exit = await Effect.runPromise(Fiber.await(fiber));
  const after = await Effect.runPromise(
    snapshot.pipe(Effect.provideService(Metric.MetricRegistry, registry)),
  );
  NodeAssert.equal(exit._tag, "Failure");
  NodeAssert.equal(after.length, 3);
  NodeAssert.equal(after.find((s) => s.id === "t3_run_duration").state.sum, 600000);
  result.push({
    row: "I05",
    route: "HARNESS CAPTURE / production recorder; hook requests interruption after counter",
    sha,
    feature,
    input: run,
    before: [],
    after,
    observations: { exit: exit._tag },
    status: "passed",
  });
} else
  result.push({
    row: "I05",
    route: "HARNESS CAPTURE / recorder absent at merge-base",
    sha,
    feature,
    before: [],
    after: [],
    status: "absent instrument",
  });
NodeFS.writeFileSync(
  values.out ?? "/tmp/run-metrics-integration.ndjson",
  result.map((x) => JSON.stringify(x)).join("\n") + "\n",
);
console.log(JSON.stringify({ sha, feature, rows: result.length, status: "passed" }));
