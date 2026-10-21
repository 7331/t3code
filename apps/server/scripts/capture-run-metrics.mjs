// Standalone evidence driver: synthetic events deliberately bypass contract validation.
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
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
const Effect = await load("effect/Effect");
const Metric = await load("effect/Metric");
const DateTime = await load("effect/DateTime");
const feature = NodeFS.existsSync(root + "/apps/server/src/orchestration-v2/RunMetrics.ts");
const makeRecorder = feature
  ? (await import(NodeURL.pathToFileURL(root + "/apps/server/src/orchestration-v2/RunMetrics.ts")))
      .makeRunOutcomeRecorder
  : undefined;
// Prepare as the EventSink transaction does, then record as its post-commit publication does.
const make = makeRecorder
  ? (isSubagent) => {
      const recorder = makeRecorder(isSubagent);
      return (batch) => recorder.prepare(batch).pipe(Effect.flatMap(recorder.record));
    }
  : () => () => Effect.void;
// Stands in for the projection store: only thread:child has subagent lineage.
const isSubagentThread = (threadId) => Effect.succeed(threadId === "thread:child");
const sha = NodeChildProcess.execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const fixture = JSON.parse(
  NodeFS.readFileSync(new URL("./run-metrics-fixtures.json", import.meta.url), "utf8"),
);
const at = (seconds) => DateTime.makeUnsafe(Date.parse(fixture.fixedBaseTime) + seconds * 1000);
let seq = 0;
const event = (id, patch = {}, type = "run.updated") => ({
  sequence: ++seq,
  commandId: null,
  event: {
    type,
    id: "event:" + seq,
    threadId: "thread:proof",
    providerInstanceId: "outer:third",
    occurredAt: at(630),
    payload: {
      id,
      threadId: "thread:proof",
      providerInstanceId: "proof:primary",
      modelSelection: { instanceId: "proof:primary", model: " GPT-6.1 " },
      status: "completed",
      requestedAt: at(0),
      startedAt: at(30),
      completedAt: at(630),
      ...patch,
    },
  },
});
const rows = [];
function row(id, batches, expected, options = {}) {
  const raw = batches[0][0].event.payload;
  const families = {
    " GPT-6.1 ": "gpt",
    "CLAUDE-opus-5-5": "claude",
    "Gemini-3": "gemini",
    "custom-reasoner": "other",
    "   ": undefined,
  };
  const expectedLabels = id.startsWith("L")
    ? {
        provider: raw.providerInstanceId,
        ...(families[raw.modelSelection.model]
          ? { modelFamily: families[raw.modelSelection.model] }
          : {}),
        outcome: raw.status,
        delegated: String(raw.delegatedTaskId !== undefined),
      }
    : undefined;
  rows.push({ id, batches, expected, expectedLabels, ...options });
}
let label = 0;
for (const providerInstanceId of fixture.providers)
  for (const model of fixture.models)
    for (const status of fixture.outcomes)
      for (const delegated of fixture.delegated) {
        const id = "L" + String(++label).padStart(2, "0");
        row(
          id,
          [
            [
              event("run:" + id, {
                providerInstanceId,
                modelSelection: { instanceId: providerInstanceId, model },
                status,
                ...(delegated ? { delegatedTaskId: "task:proof" } : {}),
              }),
            ],
          ],
          [1, 1, 30000, 1, 600000],
        );
      }
for (const status of fixture.outcomes)
  row("E01-" + status, [[event("r", { status, startedAt: null })]], [1, 0, 0, 0, 0]);
for (const [id, patch, expected, options] of [
  ["E02", { completedAt: null }, [1, 1, 30000, 0, 0]],
  ["E03", { startedAt: null, completedAt: null }, [1, 0, 0, 0, 0]],
  ["E04", { requestedAt: at(0), startedAt: at(0), completedAt: at(0) }, [1, 1, 0, 1, 0]],
  ["E05", { requestedAt: at(30), startedAt: at(0), completedAt: at(60) }, [1, 1, -30000, 1, 60000]],
  ["E06", { completedAt: at(10) }, [1, 1, 30000, 1, -20000]],
  [
    "E07",
    { requestedAt: at(30), startedAt: at(20), completedAt: at(0) },
    [1, 1, -10000, 1, -20000],
  ],
  ...["missing", null].map((m, i) => [
    "E08-" + i,
    { modelSelection: { instanceId: "proof:primary", ...(m === "missing" ? {} : { model: m }) } },
    [1, 1, 30000, 1, 600000],
  ]),
  ...["gpt-claude-gemini", "claude-gemini", "xGEMINIx", "gptish", ""].map((model, i) => [
    "E09-" + i,
    { modelSelection: { instanceId: "proof:primary", model } },
    [1, 1, 30000, 1, 600000],
  ]),
  [
    "E10",
    { modelSelection: { instanceId: "proof:secondary", model: "gpt" } },
    [1, 1, 30000, 1, 600000],
  ],
  ...["absent", "present", "parent", "lineage"].map((v, i) => [
    "E11-" + i,
    v === "present"
      ? { delegatedTaskId: "task:proof" }
      : v === "parent"
        ? { subagents: ["child"] }
        : v === "lineage"
          ? { threadId: "thread:child" }
          : {},
    [1, 1, 30000, 1, 600000],
    { delegated: v === "present" || v === "lineage" },
  ]),
])
  row(id, [[event("r", patch)]], expected, options);
for (const status of ["preparing", "queued", "starting", "running", "waiting"])
  row("N01-" + status, [[event("r", { status })]], [0, 0, 0, 0, 0]);
for (const [i, type] of ["run.created", "node.updated", "attempt.updated"].entries())
  row("N02-" + i, [[event("r", {}, type)]], [0, 0, 0, 0, 0]);
row("R01", [[event("r", { status: "rolled_back" })]], [0, 0, 0, 0, 0]);
row(
  "R02",
  [[event("r")], [event("r", { status: "rolled_back", completedAt: at(900) })]],
  [1, 1, 30000, 1, 600000],
);
row("R03", [[event("r", { status: "rolled_back" })], [event("r")]], [1, 1, 30000, 1, 600000]);
row(
  "D01",
  [[event("r"), event("r")], [event("r", { checkpointId: "checkpoint:proof" })]],
  [1, 1, 30000, 1, 600000],
);
row(
  "D02",
  [
    [event("r")],
    [
      event("r", {
        providerInstanceId: "changed",
        modelSelection: { instanceId: "changed", model: "claude" },
        status: "failed",
        delegatedTaskId: "task",
        requestedAt: at(10),
        completedAt: at(20),
      }),
    ],
  ],
  [1, 1, 30000, 1, 600000],
);
row("D03", [[event("r", { status: "running" })], [event("r")]], [1, 1, 30000, 1, 600000]);
for (const [id, n, tail, total] of [
  ["D04", 4096, [0], 4096],
  ["D05", 4096, [0, 4096, 0], 4098],
  ["D06", 4096, [0, 4096, 0], 4098],
  ["D07", 4097, [4096, 1], 4097],
  ["D06-mixed", 4096, [0, 4096, 0], 4098],
]) {
  const e = (i) =>
    event(
      "r" + i,
      id === "D06-mixed"
        ? {
            providerInstanceId: i % 2 ? "proof:primary" : "proof:secondary",
            threadId: "thread:" + (i % 2),
          }
        : {},
    );
  row(
    id,
    [Array.from({ length: n }, (_, i) => e(i)), ...tail.map((i) => [e(i)])],
    [total, total, total * 30000, total, total * 600000],
  );
}
row("D08", [[event("r")], [event("r")]], [2, 2, 60000, 2, 1200000], { reset: true });
row("D10", [[event("r")], [event("r")]], [2, 2, 60000, 2, 1200000], { reset: true });
row("D11", [[event("r", { startedAt: null })], [event("r")]], [1, 0, 0, 0, 0]);
row(
  "D12",
  [
    [event("retry-same-id", { status: "failed", startedAt: null, completedAt: at(10) })],
    [event("retry-same-id", { status: "preparing", startedAt: null, completedAt: null })],
    [event("retry-same-id", { status: "running", completedAt: null })],
    [event("retry-same-id", { status: "completed" })],
  ],
  [1, 0, 0, 0, 0],
);
// A run counted earlier, then repeated after enough new runs in one batch to evict it, counts again.
row(
  "D13",
  [[event("x")], [...Array.from({ length: 4096 }, (_, i) => event("r" + i)), event("x")]],
  [4098, 4098, 4098 * 30000, 4098, 4098 * 600000],
);
const output = [];
for (const r of rows) {
  const program = Effect.gen(function* () {
    let record = make(isSubagentThread);
    const before = yield* Metric.snapshot;
    const stages = [];
    for (const [i, batch] of r.batches.entries()) {
      if (r.reset && i) record = make(isSubagentThread);
      yield* record(batch);
      stages.push((yield* Metric.snapshot).filter((s) => s.id.startsWith("t3_run")));
    }
    const after = stages.at(-1);
    if (feature && r.expectedLabels)
      for (const s of after)
        NodeAssert.deepEqual(
          s.attributes,
          { ...(s.type === "Histogram" ? { time_unit: "milliseconds" } : {}), ...r.expectedLabels },
          r.id + " labels",
        );
    if (feature && r.delegated !== undefined)
      for (const s of after)
        NodeAssert.equal(s.attributes.delegated, String(r.delegated), r.id + " delegated");
    let totals = [0, 0, 0, 0, 0];
    for (const s of after) {
      if (s.id === "t3_runs_total") totals[0] += s.state.count;
      else if (s.id === "t3_run_queue_wait") {
        totals[1] += s.state.count;
        totals[2] += s.state.sum;
      } else if (s.id === "t3_run_duration") {
        totals[3] += s.state.count;
        totals[4] += s.state.sum;
      }
    }
    NodeAssert.deepEqual(totals, feature ? r.expected : [0, 0, 0, 0, 0], r.id);
    return {
      row: r.id,
      route: "HARNESS CAPTURE",
      sha,
      feature,
      fixture: r,
      before,
      after,
      stages,
      totals,
      units: { counter: "1", queue: "milliseconds", duration: "milliseconds" },
      status: "passed",
    };
  });
  output.push(
    await Effect.runPromise(program.pipe(Effect.provideService(Metric.MetricRegistry, new Map()))),
  );
}
NodeFS.writeFileSync(
  values.out ?? "/tmp/run-metrics-harness.ndjson",
  output.map((x) => JSON.stringify(x)).join("\n") + "\n",
);
console.log(JSON.stringify({ sha, feature, rows: output.length, status: "passed" }));
