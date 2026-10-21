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
const [Effect, Layer, Metric, DateTime, Stream] = await Promise.all(
  ["effect/Effect", "effect/Layer", "effect/Metric", "effect/DateTime", "effect/Stream"].map(load),
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
const check = (ss, counts) => {
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
        NodeAssert.equal(s.state.sum, count * (s.id === "t3_run_queue_wait" ? 30000 : 600000));
      }
    }
  }
  NodeAssert.equal(ss.length, feature ? Object.keys(counts).length * 3 : 0);
};
const make = feature
  ? (await local("orchestration-v2/RunMetrics")).makeRunOutcomeRecorder
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
      yield* stage([stored(child)], { false: 1 }, 1);
      yield* stage([stored({ ...child, id: "run:new" })], { false: 1, true: 1 }, 2);
    } else if (id === "H-L03") {
      for (const type of ["run.created", "node.updated", "attempt.updated"])
        yield* stage([stored(child, type)], {}, 0);
      for (const status of ["preparing", "queued", "starting", "running", "waiting", "rolled_back"])
        yield* stage([stored({ ...child, status })], {}, 0);
      yield* stage([stored(run), stored(run)], { false: 1 }, 1);
      yield* stage(
        [stored({ ...run, checkpointId: "checkpoint:changed", threadId: "thread:child" })],
        { false: 1 },
        1,
      );
      yield* stage([stored({ ...child, id: "run:new" })], { false: 1, true: 1 }, 2);
    } else {
      yield* stage([stored(child)], {}, 1, "Failure");
      mode = "lineage";
      yield* stage([stored(child)], {}, 1);
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
            const durableSequence = yield* es.latestSequence();
            const durable = yield* ps.getThread(tid);
            const committedEvents = yield* es
              .read({ throughSequence: durableSequence })
              .pipe(Stream.runCollect);
            NodeAssert.equal(committedEvents.at(-1).event.type, "run.updated");
            NodeAssert.equal(committedEvents.at(-1).event.payload.status, "completed");
            calls.push({ threadId: tid, inject, durableSequence, durable, committedEvents });
            order.push({ phase: "lookup", durableSequence, threadId: tid });
            if (inject)
              return yield* id === "I09-not-found"
                ? new ProjectionStore.ProjectionStoreThreadNotFoundError({ threadId: tid })
                : new ProjectionStore.ProjectionStoreReadError({
                    threadId: tid,
                    cause: "controlled label read failure",
                  });
            return durable;
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
        NodeAssert.equal(calls.length, count);
        const fresh = ev("run.updated", { ...r, id: "run:recovered", ordinal: 2 });
        inputs.push([fresh]);
        yield* sink.write({ events: [fresh] });
        ss = yield* snapshot;
        check(ss, { false: 1, true: 1 });
        stages.push(ss);
      }
      NodeAssert.equal(calls.length, feature ? (id === "I07-deleted" ? 1 : 2) : 0);
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
