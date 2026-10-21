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
const [Effect, Layer, Metric, DateTime, Stream, Option, Fiber, SqlClient] = await Promise.all(
  [
    "effect/Effect",
    "effect/Layer",
    "effect/Metric",
    "effect/DateTime",
    "effect/Stream",
    "effect/Option",
    "effect/Fiber",
    "effect/sql/SqlClient",
  ].map(load),
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
const event = (type, payload) => ({
  id: "event:" + ++seq,
  type,
  threadId,
  occurredAt: now,
  payload,
});
const snapshot = Metric.snapshot.pipe(
  Effect.map((ss) => ss.filter((s) => s.id.startsWith("t3_run"))),
);
const result = [];
const crypto = await import("node:crypto");
const check = (ss, counts, timerMultipliers = {}) => {
  for (const [delegated, count] of Object.entries(feature ? counts : {})) {
    const matching = ss.filter((s) => s.attributes.delegated === delegated);
    NodeAssert.equal(matching.length, 3);
    for (const s of matching) {
      NodeAssert.equal(s.attributes.provider, "proof_primary");
      NodeAssert.equal(s.attributes.modelFamily, "gpt");
      NodeAssert.equal(s.attributes.outcome, "completed");
      NodeAssert.equal(s.state.count, count);
      if (s.id !== "t3_runs_total") {
        NodeAssert.equal(s.attributes.time_unit, "milliseconds");
        NodeAssert.equal(
          s.state.sum,
          count *
            (timerMultipliers[delegated] ?? 1) *
            (s.id === "t3_run_queue_wait" ? 30000 : 600000),
        );
      }
    }
  }
  NodeAssert.equal(ss.length, feature ? Object.keys(counts).length * 3 : 0);
};
const makeRecorder = feature
  ? (await local("orchestration-v2/RunMetrics")).makeRunOutcomeRecorder
  : undefined;
// Prepare as the EventSink transaction does, then record as its post-commit publication does.
const make = makeRecorder
  ? (isSubagent) => {
      const recorder = makeRecorder(isSubagent);
      return (batch) => recorder.prepare(batch).pipe(Effect.flatMap(recorder.record));
    }
  : () => () => Effect.void;
const stored = (r, type = "run.updated") => ({
  sequence: ++seq,
  commandId: null,
  event: { ...event(type, r), threadId: "outer:different" },
});
for (const id of ["H-L01", "H-L02", "H-L03", "H-L04"]) {
  const program = Effect.gen(function* () {
    let mode = id === "H-L01" || id === "H-L04" ? "defect" : id === "H-L02" ? "fail" : "lineage";
    const calls = [],
      stages = [],
      inputs = [],
      exits = [];
    const record = make((tid) =>
      Effect.suspend(() => {
        calls.push({ threadId: tid, mode });
        return mode === "defect"
          ? Effect.die("controlled lookup defect")
          : mode === "fail"
            ? Effect.fail("controlled read failure")
            : Effect.succeed(tid === "thread:child");
      }),
    );
    const stage = function* (batch, expected, expectedCalls, exitTag = "Success") {
      inputs.push(batch);
      const exit = yield* Effect.exit(record(batch));
      exits.push({ tag: exit._tag, cause: exit._tag === "Failure" ? String(exit.cause) : null });
      NodeAssert.equal(exit._tag, feature ? exitTag : "Success");
      const ss = yield* snapshot;
      check(ss, expected);
      NodeAssert.equal(calls.length, feature ? expectedCalls : 0);
      stages.push({ metrics: ss, calls: [...calls], exit: exits.at(-1) });
    };
    const child = { ...run, threadId: "thread:child" };
    if (id === "H-L01") {
      yield* stage([stored({ ...child, delegatedTaskId: "task:explicit" })], { true: 1 }, 0);
      yield* stage([stored({ ...child, delegatedTaskId: "task:explicit" })], { true: 1 }, 0);
    } else if (id === "H-L02") {
      yield* stage([stored(child)], { false: 1 }, 1);
      mode = "lineage";
      // The repeat reads lineage again, now delegated, yet keeps its first count and label.
      yield* stage([stored(child)], { false: 1 }, 2);
      yield* stage([stored({ ...child, id: "run:new" })], { false: 1, true: 1 }, 3);
    } else if (id === "H-L03") {
      for (const type of ["run.created", "node.updated", "attempt.updated"])
        yield* stage([stored(child, type)], {}, 0);
      for (const status of ["preparing", "queued", "starting", "running", "waiting", "rolled_back"])
        yield* stage([stored({ ...child, status })], {}, 0);
      yield* stage([stored(run), stored(run)], { false: 1 }, 1);
      yield* stage(
        [stored({ ...run, checkpointId: "checkpoint:changed", threadId: "thread:child" })],
        { false: 1 },
        2,
      );
      yield* stage([stored({ ...child, id: "run:new" })], { false: 1, true: 1 }, 3);
    } else {
      // A lookup defect fails preparation, which rolls back the EventSink transaction, so it
      // reserves nothing and the next commit of the run counts it.
      yield* stage([stored(child)], {}, 1, "Failure");
      mode = "lineage";
      yield* stage([stored(child)], { true: 1 }, 2);
    }
    return {
      row: id,
      sha,
      feature,
      route: "HARNESS CAPTURE / production recorder",
      inputs,
      stages,
      calls,
      exits,
      before: [],
      after: stages.at(-1).metrics,
      status: feature ? "passed" : "absent instrument",
    };
  });
  result.push(
    await Effect.runPromise(program.pipe(Effect.provideService(Metric.MetricRegistry, new Map()))),
  );
}
for (const id of ["I07-deleted", "I08-read-error", "I09-not-found"]) {
  const program = Effect.gen(function* () {
    const es = yield* EventStore.EventStoreV2;
    const ps = yield* ProjectionStore.ProjectionStoreV2;
    const sql = yield* SqlClient.SqlClient;
    const calls = [],
      order = [],
      inputs = [],
      stages = [];
    let inject = false;
    const wrapped = Layer.mergeAll(
      Layer.succeed(EventStore.EventStoreV2, {
        ...es,
        publishCommitted: (events) =>
          Effect.gen(function* () {
            order.push({ phase: "publishCommitted", events });
            yield* es.publishCommitted(events);
          }),
      }),
      Layer.succeed(ProjectionStore.ProjectionStoreV2, {
        ...ps,
        getThread: (tid) =>
          Effect.gen(function* () {
            // The lookup runs inside the write transaction, on its connection, before the commit
            // and the publish lane: the terminal event is visible here but not yet published,
            // and its run is not yet counted.
            const inTransaction = Option.isSome(
              yield* Effect.serviceOption(sql.transactionService),
            );
            NodeAssert.ok(inTransaction);
            const visibleSequence = yield* es.latestSequence();
            const visible = yield* ps.getThread(tid);
            const uncommittedEvents = yield* es
              .read({ throughSequence: visibleSequence })
              .pipe(Stream.runCollect);
            NodeAssert.equal(uncommittedEvents.at(-1).event.type, "run.updated");
            NodeAssert.equal(uncommittedEvents.at(-1).event.payload.status, "completed");
            NodeAssert.ok(
              !order.some(
                (o) =>
                  o.phase === "publishCommitted" &&
                  o.events.some((e) => e.sequence === visibleSequence),
              ),
            );
            const metricsAtLookup = yield* snapshot;
            // Each distinct run looked up earlier in this row was counted once; a repeat of one is
            // prepared again but not counted again.
            const runId = uncommittedEvents.at(-1).event.payload.id;
            NodeAssert.equal(
              metricsAtLookup
                .filter((m) => m.id === "t3_runs_total")
                .reduce((sum, m) => sum + m.state.count, 0),
              new Set(calls.map((c) => c.runId)).size,
            );
            calls.push({
              threadId: tid,
              runId,
              inject,
              inTransaction,
              visibleSequence,
              visible,
              uncommittedEvents,
              metricsAtLookup,
            });
            order.push({ phase: "lookup", inTransaction, visibleSequence, threadId: tid });
            if (inject)
              return yield* id === "I09-not-found"
                ? new ProjectionStore.ProjectionStoreThreadNotFoundError({ threadId: tid })
                : new ProjectionStore.ProjectionStoreReadError({
                    threadId: tid,
                    cause: "controlled label read failure",
                  });
            return visible;
          }),
      }),
    );
    return yield* Effect.gen(function* () {
      const sink = yield* EventSink.EventSinkV2;
      const childId = "thread:deleted-child";
      const child = {
        ...thread,
        id: childId,
        lineage: {
          parentThreadId: threadId,
          relationshipToParent: "subagent",
          rootThreadId: threadId,
        },
      };
      const r = { ...run, threadId: childId };
      const ev = (type, payload) => ({
        ...event(type, payload),
        threadId: payload.threadId ?? payload.id,
      });
      const seed = [
        event("thread.created", thread),
        ev("thread.created", child),
        ev("run.created", { ...r, status: "running", completedAt: null }),
      ];
      inputs.push(seed);
      yield* sink.write({ events: seed });
      if (id === "I07-deleted") {
        const deletion = ev("thread.deleted", { ...child, deletedAt: now });
        inputs.push([deletion]);
        yield* sink.write({ events: [deletion] });
      }
      const persisted = yield* ps.getThread(childId);
      const shell = yield* ps.getThreadShell(childId);
      if (id === "I07-deleted") {
        NodeAssert.ok(persisted.deletedAt);
        NodeAssert.equal(shell, null);
      }
      const beforeSequence = yield* es.latestSequence();
      // A replayed seed event proves the live stream has subscribed before the terminal write.
      const ready = Promise.withResolvers(),
        received = Promise.withResolvers();
      yield* sink.stream({ afterSequence: 0 }).pipe(
        Stream.runForEach((e) =>
          Effect.sync(() => {
            order.push({ phase: "subscriber", sequence: e.sequence, type: e.event.type });
            if (e.sequence === beforeSequence) ready.resolve();
            if (e.event.type === "run.updated") received.resolve(e);
          }),
        ),
        Effect.forkScoped,
      );
      yield* Effect.promise(() => ready.promise);
      inject = id !== "I07-deleted";
      const terminal = ev("run.updated", r);
      inputs.push([terminal]);
      const exit = yield* Effect.exit(sink.write({ events: [terminal] }));
      NodeAssert.equal(exit._tag, "Success");
      const live = yield* Effect.promise(() => received.promise);
      NodeAssert.equal(live.event.id, terminal.id);
      order.push({ phase: "write-return", exit: exit._tag });
      if (feature) {
        const lookupAt = order.findIndex((o) => o.phase === "lookup");
        const publishAt = order.findIndex(
          (o) => o.phase === "publishCommitted" && o.events.some((e) => e.event.id === terminal.id),
        );
        NodeAssert.ok(lookupAt >= 0 && lookupAt < publishAt);
      }
      let ss = yield* snapshot;
      check(ss, { [id === "I07-deleted" ? "true" : "false"]: 1 });
      stages.push(ss);
      const count = calls.length;
      if (id !== "I07-deleted") {
        inject = false;
        const duplicate = ev("run.updated", r);
        inputs.push([duplicate]);
        yield* sink.write({ events: [duplicate] });
        ss = yield* snapshot;
        check(ss, { false: 1 });
        stages.push(ss);
        // The repeat is prepared again, reading lineage, but the recorder already counted it.
        NodeAssert.equal(calls.length, feature ? count + 1 : 0);
        const fresh = ev("run.updated", { ...r, id: "run:recovered", ordinal: 2 });
        inputs.push([fresh]);
        yield* sink.write({ events: [fresh] });
        ss = yield* snapshot;
        check(ss, { false: 1, true: 1 });
        stages.push(ss);
      }
      NodeAssert.equal(calls.length, feature ? (id === "I07-deleted" ? 1 : 3) : 0);
      return {
        row: id,
        sha,
        feature,
        route: "HARNESS CAPTURE / real EventSink + SQLite",
        inputs,
        persisted,
        shell,
        beforeSequence,
        calls,
        order,
        live,
        exit: exit._tag,
        before: [],
        after: ss,
        stages,
        status: feature ? "passed" : "absent instrument",
      };
    }).pipe(Effect.provide(EventSink.layer.pipe(Layer.provide(wrapped), Layer.provide(stores))));
  }).pipe(
    Effect.provide(stores),
    Effect.scoped,
    Effect.provideService(Metric.MetricRegistry, new Map()),
  );
  result.push(await Effect.runPromise(program));
}
// A terminal write pauses in its lineage read while an unrelated writer starts. The read must
// hold the transaction's connection, before the publish lane, so both writes commit and publish.
{
  const phases = [];
  const mark = (phase) => phases.push(phase);
  // Reports a stuck ordering instead of hanging; completion, not this timer, is the passing proof.
  const watchdog = setTimeout(() => {
    console.error(JSON.stringify({ row: "I10-concurrent-writer", stuck: true, phases }));
    process.exit(1);
  }, 30_000);
  const program = Effect.gen(function* () {
    const es = yield* EventStore.EventStoreV2;
    const ps = yield* ProjectionStore.ProjectionStoreV2;
    const sql = yield* SqlClient.SqlClient;
    const lookupEntered = Promise.withResolvers();
    const releaseLookup = Promise.withResolvers();
    const childId = "thread:concurrent-child";
    const otherId = "thread:concurrent-other";
    let armed = false;
    let inTransaction;
    const wrapped = Layer.mergeAll(
      Layer.succeed(EventStore.EventStoreV2, {
        ...es,
        publishCommitted: (events) =>
          Effect.sync(() =>
            mark("publishCommitted:" + events.map((e) => e.sequence).join(",")),
          ).pipe(Effect.andThen(es.publishCommitted(events))),
      }),
      Layer.succeed(ProjectionStore.ProjectionStoreV2, {
        ...ps,
        getThread: (tid) =>
          Effect.gen(function* () {
            if (armed && tid === childId) {
              armed = false;
              inTransaction = Option.isSome(yield* Effect.serviceOption(sql.transactionService));
              mark("lookup-entered:inTransaction=" + inTransaction);
              lookupEntered.resolve();
              // Outside a transaction this pause is the reviewer's deadlock, so only pause inside.
              if (inTransaction) yield* Effect.promise(() => releaseLookup.promise);
              mark("lookup-released");
            }
            return yield* ps.getThread(tid);
          }),
      }),
    );
    return yield* Effect.gen(function* () {
      const sink = yield* EventSink.EventSinkV2;
      const child = {
        ...thread,
        id: childId,
        lineage: {
          parentThreadId: threadId,
          relationshipToParent: "subagent",
          rootThreadId: threadId,
        },
      };
      const other = {
        ...thread,
        id: otherId,
        lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: otherId },
      };
      const r = { ...run, id: "run:concurrent", threadId: childId };
      const ev = (type, payload) => ({
        ...event(type, payload),
        threadId: payload.threadId ?? payload.id,
      });
      yield* sink.write({
        events: [
          event("thread.created", thread),
          ev("thread.created", child),
          ev("run.created", { ...r, status: "running", completedAt: null }),
        ],
      });
      const beforeSequence = yield* es.latestSequence();
      const terminal = ev("run.updated", r);
      const unrelated = ev("thread.created", other);
      const ready = Promise.withResolvers();
      const received = new Map([
        [terminal.id, Promise.withResolvers()],
        [unrelated.id, Promise.withResolvers()],
      ]);
      yield* sink.stream({ afterSequence: 0 }).pipe(
        Stream.runForEach((e) =>
          Effect.sync(() => {
            if (e.sequence === beforeSequence) ready.resolve();
            received.get(e.event.id)?.resolve(e);
          }),
        ),
        Effect.forkScoped,
      );
      yield* Effect.promise(() => ready.promise);
      armed = feature;
      const terminalFiber = yield* sink.write({ events: [terminal] }).pipe(Effect.forkScoped);
      if (feature) {
        yield* Effect.promise(() => lookupEntered.promise);
        NodeAssert.ok(inTransaction, "lineage read ran outside the write transaction");
      }
      mark("unrelated-write-requested");
      const unrelatedFiber = yield* sink.write({ events: [unrelated] }).pipe(Effect.forkScoped);
      releaseLookup.resolve();
      const terminalStored = yield* Fiber.join(terminalFiber);
      mark("terminal-write-returned");
      const unrelatedStored = yield* Fiber.join(unrelatedFiber);
      mark("unrelated-write-returned");
      const live = yield* Effect.promise(() =>
        Promise.all([...received.values()].map((d) => d.promise)),
      );
      mark("both-published-live");
      const ss = yield* snapshot;
      check(ss, { true: 1 });
      return {
        row: "I10-concurrent-writer",
        sha,
        feature,
        route: "HARNESS CAPTURE / real EventSink + SQLite, concurrent writers",
        inputs: [[terminal], [unrelated]],
        inTransaction,
        phases,
        receipts: {
          terminal: terminalStored.map((e) => e.sequence),
          unrelated: unrelatedStored.map((e) => e.sequence),
          live: live.map((e) => [e.sequence, e.event.type]),
        },
        before: [],
        after: ss,
        status: feature ? "passed" : "absent instrument",
      };
    }).pipe(Effect.provide(EventSink.layer.pipe(Layer.provide(wrapped), Layer.provide(stores))));
  }).pipe(
    Effect.provide(stores),
    Effect.scoped,
    Effect.provideService(Metric.MetricRegistry, new Map()),
  );
  result.push(await Effect.runPromise(program));
  clearTimeout(watchdog);
}

for (const id of [
  "D13-uncounted-same-batch",
  "H-P01-concurrent-prepared-duplicate",
  "H-P02-thread-cache",
]) {
  const program = Effect.gen(function* () {
    const calls = [],
      stages = [],
      inputs = [];
    let mode = "lineage";
    const recorder = makeRecorder?.((tid) =>
      Effect.suspend(() => {
        calls.push({ tid, mode });
        return mode === "die"
          ? Effect.die("record performed lookup")
          : mode === "fail"
            ? Effect.fail("typed cache failure")
            : Effect.succeed(tid === "thread:child" || mode === "true");
      }),
    );
    const prepare = function* (batch) {
      inputs.push(batch);
      const before = yield* snapshot;
      const outcomes = recorder ? yield* recorder.prepare(batch) : [];
      NodeAssert.deepEqual(yield* snapshot, before);
      stages.push({
        phase: "prepare",
        length: outcomes.length,
        calls: [...calls],
        metrics: before,
      });
      if (feature) NodeAssert.equal(outcomes.length, batch.length);
      return outcomes;
    };
    const record = function* (outcomes, expected) {
      if (recorder) yield* recorder.record(outcomes);
      const ss = yield* snapshot;
      check(ss, expected);
      stages.push({ phase: "record", calls: [...calls], metrics: ss });
    };
    if (id === "D13-uncounted-same-batch") {
      const x = stored({ ...run, id: "fifo:X" });
      const batch = [
        x,
        ...Array.from({ length: 4096 }, (_, i) => stored({ ...run, id: "fifo:" + i })),
        x,
        x,
      ];
      const prepared = yield* prepare(batch);
      NodeAssert.equal(calls.length, feature ? 1 : 0);
      yield* record(prepared, { false: 4098 });
    } else if (id === "H-P01-concurrent-prepared-duplicate") {
      for (const reverse of [false, true]) {
        // Each record order owns a fresh registry and recorder.
        yield* Effect.gen(function* () {
          const localCalls = [];
          let forbidden = false;
          const rec = makeRecorder?.((tid) =>
            Effect.suspend(() => {
              localCalls.push(tid);
              return forbidden
                ? Effect.die("record lookup")
                : Effect.succeed(tid === "thread:child");
            }),
          );
          const a = stored({ ...run, id: "prepared:X" });
          const b = stored({
            ...run,
            id: "prepared:X",
            threadId: "thread:child",
            requestedAt: at(0),
            startedAt: at(60),
            completedAt: at(1260),
          });
          inputs.push([a], [b]);
          const abandoned = rec ? yield* rec.prepare([stored({ ...run, id: "abandoned" })]) : [];
          const aa = rec ? yield* rec.prepare([a]) : [],
            bb = rec ? yield* rec.prepare([b]) : [];
          check(yield* snapshot, {});
          if (feature) NodeAssert.deepEqual([abandoned.length, aa.length, bb.length], [1, 1, 1]);
          stages.push({
            reverse,
            phase: "prepared",
            aa,
            bb,
            abandoned,
            calls: [...localCalls],
            metrics: yield* snapshot,
          });
          forbidden = true;
          for (const outcomes of reverse ? [bb, aa] : [aa, bb]) {
            if (rec) yield* rec.record(outcomes);
            const ss = yield* snapshot;
            check(ss, { [reverse ? "true" : "false"]: 1 }, { true: 2 });
            stages.push({ reverse, phase: "record", metrics: ss, calls: [...localCalls] });
          }
          // Abandonment did not reserve this ID; recording its later preparation counts it.
          forbidden = false;
          const retry = rec ? yield* rec.prepare([stored({ ...run, id: "abandoned" })]) : [];
          forbidden = true;
          if (rec) yield* rec.record(retry);
          check(yield* snapshot, reverse ? { true: 1, false: 1 } : { false: 2 }, { true: 2 });
          stages.push({
            reverse,
            phase: "abandoned-retry",
            metrics: yield* snapshot,
            calls: [...localCalls],
          });
        }).pipe(Effect.provideService(Metric.MetricRegistry, new Map()));
      }
    } else {
      let n = 0;
      const fresh = (tid, explicit = false) =>
        stored({
          ...run,
          id: "cache:" + ++n,
          threadId: tid,
          ...(explicit ? { delegatedTaskId: "explicit" } : {}),
        });
      const batches = [
        [fresh("root"), fresh("root")],
        [fresh("thread:child"), fresh("thread:child")],
        [fresh("new-root", true), fresh("new-root"), fresh("new-root")],
        [fresh("error"), fresh("error")],
        [fresh("error")],
      ];
      batches[0].push(batches[0][0]);
      const expected = [
        { false: 2 },
        { false: 2, true: 2 },
        { false: 4, true: 3 },
        { false: 6, true: 3 },
        { false: 6, true: 4 },
      ];
      for (let i = 0; i < batches.length; i++) {
        mode = i === 3 ? "fail" : i === 4 ? "true" : "lineage";
        const outcomes = yield* prepare(batches[i]);
        NodeAssert.equal(calls.length, feature ? i + 1 : 0);
        yield* record(outcomes, expected[i]);
      }
    }
    return {
      row: id,
      sha,
      feature,
      route: "HARNESS CAPTURE / staged production recorder",
      inputs,
      stages,
      calls,
      before: [],
      after: yield* snapshot,
      status: feature ? "passed" : "absent instrument",
    };
  }).pipe(Effect.provideService(Metric.MetricRegistry, new Map()));
  result.push(await Effect.runPromise(program));
}
{
  const [Outbox, Receipts, Projects, Positions] = await Promise.all(
    [
      "orchestration-v2/EffectOutbox",
      "orchestration-v2/CommandReceiptStore",
      "orchestration-v2/ProjectStore",
      "orchestration-v2/TurnItemPositionStore",
    ].map(local),
  );
  const extra = Layer.mergeAll(Outbox.layer, Receipts.layer, Projects.layer, Positions.layer).pipe(
    Layer.provide(db),
  );
  const program = Effect.gen(function* () {
    const es = yield* EventStore.EventStoreV2,
      ps = yield* ProjectionStore.ProjectionStoreV2,
      sql = yield* SqlClient.SqlClient;
    const outbox = yield* Outbox.EffectOutboxV2;
    const order = [],
      stages = [],
      inputs = [];
    let mode = "seed";
    const wrapped = Layer.mergeAll(
      Layer.succeed(EventStore.EventStoreV2, {
        ...es,
        publishCommitted: (events) =>
          Effect.sync(() => order.push({ phase: "publish", events })).pipe(
            Effect.andThen(es.publishCommitted(events)),
          ),
      }),
      Layer.succeed(ProjectionStore.ProjectionStoreV2, {
        ...ps,
        getThread: (tid) =>
          Effect.gen(function* () {
            const transaction = Option.isSome(yield* Effect.serviceOption(sql.transactionService));
            NodeAssert.ok(transaction);
            check(yield* snapshot, {});
            order.push({ phase: "lookup", tid, mode, transaction, metrics: yield* snapshot });
            if (mode === "defect" && tid === "rollback:B")
              return yield* Effect.die("partial preparation defect");
            return yield* ps.getThread(tid);
          }),
      }),
      Layer.succeed(Outbox.EffectOutboxV2, {
        ...outbox,
        enqueue: (effects) =>
          Effect.gen(function* () {
            order.push({ phase: "outbox", mode });
            if (mode === "outbox") return yield* Effect.fail("after successful prepare");
            return yield* outbox.enqueue(effects);
          }),
      }),
    );
    return yield* Effect.gen(function* () {
      const sink = yield* EventSink.EventSinkV2;
      const rr = ["A", "B"].map((x) => ({
        ...run,
        id: "rollback:" + x,
        threadId: "rollback:" + x,
      }));
      const ev = (type, payload) => ({
        ...event(type, payload),
        threadId: payload.threadId ?? payload.id,
      });
      const seed = rr.flatMap((r) => [
        ev("thread.created", {
          ...thread,
          id: r.threadId,
          lineage: {
            parentThreadId: threadId,
            relationshipToParent: "subagent",
            rootThreadId: threadId,
          },
        }),
        ev("run.created", { ...r, status: "running", completedAt: null }),
      ]);
      yield* sink.write({ events: seed });
      const beforeSequence = yield* es.latestSequence();
      const state = () =>
        Effect.gen(function* () {
          return {
            sequence: yield* es.latestSequence(),
            threads: yield* Effect.all(rr.map((r) => ps.getThread(r.threadId))),
            runs: yield* sql`SELECT * FROM orchestration_v2_projection_runs ORDER BY run_id`,
            metadata:
              yield* sql`SELECT * FROM orchestration_v2_projection_metadata ORDER BY projection_name`,
          };
        });
      const beforeState = yield* state();
      const ready = Promise.withResolvers(),
        liveDone = Promise.withResolvers(),
        live = [];
      yield* sink.stream({ afterSequence: 0 }).pipe(
        Stream.runForEach((e) =>
          Effect.sync(() => {
            if (e.sequence === beforeSequence) ready.resolve();
            if (e.event.type === "run.updated") {
              live.push(e);
              if (live.length === 2) liveDone.resolve();
            }
          }),
        ),
        Effect.forkScoped,
      );
      yield* Effect.promise(() => ready.promise);
      const publications = () =>
        order.filter(
          (o) => o.phase === "publish" && o.events.some((e) => e.event.type === "run.updated"),
        );
      for (const next of ["outbox", "defect", "retry"]) {
        mode = next;
        const batch = rr.map((r) => ev("run.updated", r));
        inputs.push(batch);
        const start = order.length;
        const exit = yield* Effect.exit(sink.writeWithEffects({ events: batch, effects: [] }));
        const trace = order.slice(start);
        if (next !== "retry") {
          NodeAssert.equal(exit._tag, "Failure");
          NodeAssert.deepEqual(yield* state(), beforeState);
          check(yield* snapshot, {});
          NodeAssert.equal(publications().length, 0);
          NodeAssert.equal(live.length, 0);
          if (feature) NodeAssert.equal(trace.filter((o) => o.phase === "lookup").length, 2);
          if (next === "outbox") NodeAssert.equal(trace.at(-1).phase, "outbox");
          else if (feature) NodeAssert.ok(!trace.some((o) => o.phase === "outbox"));
        } else {
          NodeAssert.equal(exit._tag, "Success");
          yield* Effect.promise(() => liveDone.promise);
          check(yield* snapshot, { true: 2 });
          NodeAssert.equal(live.length, 2);
          NodeAssert.equal(publications().length, 1);
        }
        stages.push({
          phase: next,
          exit: exit._tag,
          cause: exit._tag === "Failure" ? String(exit.cause) : null,
          trace,
          sql: yield* state(),
          metrics: yield* snapshot,
          live: [...live],
        });
      }
      return {
        row: "I11-rollback-after-prepare",
        sha,
        feature,
        route: "HARNESS CAPTURE / real EventSink SQLite outbox rollback",
        inputs,
        beforeState,
        stages,
        order,
        before: [],
        after: yield* snapshot,
        status: feature ? "passed" : "absent instrument",
      };
    }).pipe(Effect.provide(EventSink.layerFromStores.pipe(Layer.provide(wrapped))));
  }).pipe(
    Effect.provide(extra),
    Effect.provide(stores),
    Effect.scoped,
    Effect.provideService(Metric.MetricRegistry, new Map()),
  );
  if (feature) result.push(await Effect.runPromise(program));
  else
    result.push({
      row: "I11-rollback-after-prepare",
      sha,
      feature,
      route: "HARNESS CAPTURE / baseline has no preparation boundary",
      before: [],
      after: [],
      status: "absent instrument",
    });
}

// Execute the continuation and downstream blocks from the frozen capture source itself.
{
  const source = NodeFS.readFileSync(
    new URL("./capture-run-metrics-live.mjs", import.meta.url),
    "utf8",
  );
  const begin = source.indexOf('    saveProjection("S-delegate-parent-initial", final);');
  const end = source.indexOf(
    "    NodeFS.writeFileSync(",
    source.indexOf('      saveProjection("S-delegate-parent-followup", final);', begin),
  );
  const continuation = source.slice(begin, end);
  const downstream = source.slice(
    source.indexOf('  if (values.scenario !== "metrics") {', end),
    source.indexOf("  await stopServer(server);", end),
  );
  NodeAssert.ok(begin > 0 && end > begin && downstream.includes('await barrier("S-delegate")'));
  const calls = [],
    saved = [],
    wire = [];
  const receipt = {
    points: [
      { name: "rpc" },
      ...(feature
        ? [
            {
              name: "t3_runs_total",
              unit: "1",
              attrs: {
                provider: "proof_primary",
                modelFamily: "gpt",
                outcome: "completed",
                delegated: "false",
              },
              point: { asDouble: 2 },
            },
          ]
        : []),
    ],
  };
  const capture = {
    receipts: [],
    wait: async (predicate, boundary) => {
      NodeAssert.equal(boundary, capture.receipts.length);
      NodeAssert.ok(predicate(receipt));
      capture.receipts.push(receipt);
      return receipt;
    },
  };
  const saveBegin = source.indexOf("  const terminalRuns = new Map();");
  const saveEnd = source.indexOf("  const metricProgram =", saveBegin);
  const oracleSource = source.slice(saveBegin, saveEnd);
  const oracle = new Function(
    "NodeFS",
    "NodePath",
    "evidence",
    "feature",
    "capture",
    "points",
    oracleSource + "return {saveProjection, barrier};",
  )(
    { appendFileSync: (path, value) => wire.push({ path, value: JSON.parse(value) }) },
    NodePath,
    "/controlled",
    feature,
    capture,
    (r) => r.points,
  );
  const final = {
    thread: { id: threadId, lineage: thread.lineage },
    subagents: [],
    runs: [
      { ...run, id: "native:1" },
      { ...run, id: "native:2", ordinal: 2 },
    ],
    turnItems: [{ type: "notification" }],
  };
  const client = new Proxy(
    {},
    {
      get: (_, key) => () => {
        calls.push(key);
        throw new Error("Unexpected child operation: " + key);
      },
    },
  );
  const saveProjection = (row, p) => {
    saved.push({ row, projection: p });
    oracle.saveProjection(row, p);
  };
  const scope = {
    values: { scenario: "native" },
    client,
    saveProjection,
    NodeAssert,
    NodeFS: { readFileSync: () => JSON.stringify(final) },
    NodePath,
    evidence: "/controlled",
    origin: "http://127.0.0.1",
    headers: {},
    fetch: () => {
      throw new Error("Unexpected child HTTP fetch");
    },
    barrier: async (row) => {
      calls.push(row);
      await oracle.barrier(row);
    },
    final,
  };
  const names = Object.keys(scope),
    args = Object.values(scope);
  const runBlock = async (block) => {
    const fn = new Function(...names, "Effect", "return Effect.gen(function* () {" + block + "});");
    await Effect.runPromise(fn(...args, Effect));
  };
  await runBlock(continuation);
  const asyncFn = Object.getPrototypeOf(async function () {}).constructor;
  await new asyncFn(...names, downstream)(...args);
  NodeAssert.deepEqual(calls, ["S-delegate"]);
  NodeAssert.deepEqual(
    saved.map((x) => x.row),
    ["S-delegate-parent-initial", "S-delegate-parent"],
  );
  let oldFailure;
  try {
    await runBlock(continuation.replace('if (values.scenario !== "native") {', "if (true) {"));
  } catch (e) {
    oldFailure = String(e);
  }
  NodeAssert.match(oldFailure, /TypeError/);
  const nullParent = { ...final, subagents: [{ origin: "provider_native", childThreadId: null }] };
  const nullCalls = [];
  await new asyncFn(...names, downstream)(
    ...Object.values({
      ...scope,
      NodeFS: { readFileSync: () => JSON.stringify(nullParent) },
      saveProjection: (row) => nullCalls.push(row),
      barrier: async (row) => nullCalls.push(row),
    }),
  );
  NodeAssert.deepEqual(nullCalls, ["S-delegate-parent", "S-delegate"]);
  result.push({
    row: "NATIVE02-null-child",
    sha,
    feature,
    route: "HARNESS CAPTURE / exact downstream source block",
    downstream,
    input: nullParent,
    calls: nullCalls,
    before: [],
    after: [],
    status: "passed",
  });
  result.push({
    row: "NATIVE01",
    sha,
    feature,
    route: "HARNESS CAPTURE / exact frozen native source blocks",
    sourceSha256: crypto.createHash("sha256").update(source).digest("hex"),
    continuation,
    downstream,
    oracleSource,
    input: final,
    calls,
    saved,
    wire,
    receipts: capture.receipts,
    oldFailure,
    before: [],
    after: [],
    status: "passed",
    caveat: "Controlled native proof; real provider-native background execution not claimed",
  });
}
NodeFS.writeFileSync(
  values.out ?? "/tmp/run-metrics-lineage.ndjson",
  result.map((r) => JSON.stringify(r)).join("\n") + "\n",
);
console.log(JSON.stringify({ sha, feature, rows: result.length, status: "passed" }));
