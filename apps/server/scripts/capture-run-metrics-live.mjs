import { collector, points } from "./run-metrics-collector.mjs";
// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off globalFetch:off globalConsole:off preferSchemaOverJson:off - Host-side process verifier retains raw wire evidence and owns deadline timers.
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";

import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Socket } from "effect/socket";
import { RpcClient, RpcSerialization } from "effect/rpc";
import {
  ORCHESTRATION_PROTOCOL_VERSION,
  ORCHESTRATION_PROTOCOL_HEADER,
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WsRpcGroup,
} from "@t3tools/contracts";

const { values } = NodeUtil.parseArgs({
  options: {
    root: { type: "string" },
    model: { type: "string", default: "claude-sonnet-4-6" },
    provider: { type: "string", default: "claudeAgent" },
    timeout: { type: "string", default: "240" },
    scenario: { type: "string", default: "all" },
    repeat: { type: "string", default: "1" },
    "fail-gate": { type: "boolean", default: false },
  },
});
const timeoutMs = Number(values.timeout) * 1000;
NodeAssert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0, "timeout must be positive seconds");
NodeAssert.ok(
  ["metrics", "all", "idle", "active", "native", "nested"].includes(values.scenario),
  "scenario must be all, idle, active, native or nested",
);
const root = values.root ?? NodePath.resolve(import.meta.dirname, "../../..");
const repeat = Number(values.repeat);
NodeAssert.ok(Number.isSafeInteger(repeat) && repeat > 0, "repeat must be a positive integer");
if (values.scenario === "all" || repeat > 1) {
  const reportDirectory = NodeFS.mkdtempSync(
    NodePath.join(NodeOS.tmpdir(), "t3-background-suite-"),
  );
  console.log(`Suite report: ${reportDirectory}`);
  const outcomes = [];
  attempts: for (let iteration = 1; iteration <= repeat; iteration++) {
    for (const scenario of values.scenario === "all"
      ? ["idle", "active", "native", "nested"]
      : [values.scenario]) {
      console.log(`Verification ${iteration}/${repeat}: ${scenario}`);
      const child = NodeChildProcess.spawn(
        process.execPath,
        [
          import.meta.filename,
          "--scenario",
          scenario,
          "--model",
          values.model,
          "--provider",
          values.provider,
          "--timeout",
          values.timeout,
          ...(values["fail-gate"] ? ["--fail-gate"] : []),
        ],
        { cwd: root, stdio: ["ignore", "pipe", "inherit"] },
      );
      let childOutput = "";
      let interrupted = false;
      const interrupt = () => {
        interrupted = true;
        child.kill("SIGTERM");
      };
      process.on("SIGINT", interrupt);
      process.on("SIGTERM", interrupt);
      child.stdout?.on("data", (chunk) => {
        process.stdout.write(chunk);
        childOutput += chunk.toString();
      });
      const status = await new Promise((done, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => done(code ?? 1));
      });
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", interrupt);
      outcomes.push({
        iteration,
        scenario,
        status: status === 0 && !interrupted ? "passed" : "failed",
        evidence: /^Evidence: (.+)$/m.exec(childOutput)?.[1] ?? null,
      });
      NodeFS.writeFileSync(
        NodePath.join(reportDirectory, "results.json"),
        JSON.stringify(outcomes, null, 2),
      );
      if (interrupted) break attempts;
    }
  }
  console.log(JSON.stringify(outcomes, null, 2));
  process.exit(outcomes.some((outcome) => outcome.status === "failed") ? 1 : 0);
}
const evidence = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-background-live-"));
const home = NodePath.join(evidence, "home");
const project = NodePath.join(evidence, "project");
NodeFS.mkdirSync(project);
NodeChildProcess.execFileSync("git", ["init", "-q", project]);
NodeChildProcess.execFileSync("git", [
  "-C",
  project,
  "-c",
  "user.name=Verifier",
  "-c",
  "user.email=verifier@localhost",
  "commit",
  "--allow-empty",
  "-qm",
  "initial",
]);
console.log(`Evidence: ${evidence}`);
NodeFS.copyFileSync(import.meta.filename, NodePath.join(evidence, "verifier.ts"));
NodeFS.writeFileSync(
  NodePath.join(evidence, "working-tree.patch"),
  NodeChildProcess.execFileSync("git", ["diff", "--binary", "HEAD"], {
    cwd: root,
    maxBuffer: 32 * 1024 * 1024,
  }),
);
NodeFS.writeFileSync(
  NodePath.join(evidence, "manifest.json"),
  JSON.stringify(
    {
      driverRevision: NodeChildProcess.execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: NodePath.resolve(import.meta.dirname, "../../.."),
        encoding: "utf8",
      }).trim(),
      revision: NodeChildProcess.execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
      dirty: NodeChildProcess.execFileSync("git", ["status", "--porcelain"], {
        cwd: root,
        encoding: "utf8",
      }),
      provider: values.provider,
      model: values.model,
      scenario: values.scenario,
      startedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);

const capture = await collector(evidence);
for (const key of Object.keys(process.env))
  if (key.startsWith("OTEL_") || key.startsWith("T3CODE_OTLP_")) delete process.env[key];
process.env.T3CODE_OTLP_METRICS_URL = `http://127.0.0.1:${capture.port}/v1/metrics`;
process.env.T3CODE_OTLP_EXPORT_INTERVAL_MS = "500";
process.env.T3CODE_OTLP_PROTOCOL = "http/json";
for (const key of [
  "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
  "OTEL_EXPORTER_OTLP_METRICS_PROTOCOL",
  "OTEL_METRIC_EXPORT_INTERVAL",
])
  delete process.env[key];
const feature = NodeFS.existsSync(
  NodePath.join(root, "apps/server/src/orchestration-v2/RunMetrics.ts"),
);
NodeFS.appendFileSync(
  NodePath.join(evidence, "environment.json"),
  JSON.stringify({
    node: process.version,
    root,
    collectorPort: capture.port,
    protocol: process.env.T3CODE_OTLP_PROTOCOL,
    interval: 500,
  }),
);
const secret = `RESULT_${NodeCrypto.randomUUID()}`;
const gatePath = `/${NodeCrypto.randomUUID()}`;
const gateReached = Promise.withResolvers();
let response;
let parentResponse;
let parentFinished = false;
let nestedChildFinished = values.scenario !== "nested";
let released = false;
function release() {
  if (!parentFinished || !nestedChildFinished || !response || released) return;
  released = true;
  NodeFS.appendFileSync(
    NodePath.join(evidence, "milestones.ndjson"),
    JSON.stringify({ kind: "gate-released", at: new Date().toISOString() }) + "\n",
  );
  if (values["fail-gate"]) response.writeHead(503).end("Injected dependency failure");
  else response.end(secret);
}
const gate = NodeHttp.createServer((request, res) => {
  if (request.url === `${gatePath}/parent` && !parentResponse) {
    parentResponse = res;
    parentFinished = true;
    release();
    return;
  }
  if (request.url !== gatePath || response) {
    res.writeHead(404).end();
    return;
  }
  response = res;
  gateReached.resolve();
  release();
});
gate.listen(0, "127.0.0.1");
await new Promise((done) => gate.once("listening", done));
const gateAddress = gate.address();
NodeAssert.ok(gateAddress && typeof gateAddress !== "string");

const reservation = NodeHttp.createServer();
reservation.listen(0, "127.0.0.1");
await new Promise((done) => reservation.once("listening", done));
const address = reservation.address();
NodeAssert.ok(address && typeof address !== "string");
await new Promise((done) => reservation.close(() => done()));
const port = address.port;
const origin = `http://127.0.0.1:${port}`;
const bootstrap = NodeCrypto.randomUUID();
function startServer() {
  const server = NodeChildProcess.spawn(
    process.execPath,
    [
      "apps/server/src/bin.ts",
      "start",
      "--base-dir",
      home,
      "--bootstrap-fd",
      "3",
      "--log-level",
      "debug",
    ],
    {
      cwd: root,
      detached: true,
      stdio: ["ignore", "pipe", "pipe", "pipe"],
    },
  );
  const bootstrapPipe = server.stdio[3];
  NodeAssert.ok(bootstrapPipe && "write" in bootstrapPipe);
  bootstrapPipe.on("error", () => {});
  bootstrapPipe.end(
    JSON.stringify({
      mode: "desktop",
      noBrowser: true,
      port,
      t3Home: home,
      host: "127.0.0.1",
      desktopBootstrapToken: bootstrap,
      tailscaleServeEnabled: false,
      tailscaleServePort: 443,
    }),
  );
  NodeFS.appendFileSync(
    NodePath.join(evidence, "processes.ndjson"),
    JSON.stringify({
      pid: server.pid,
      port,
      home,
      root,
      at: new Date().toISOString(),
      command: [
        process.execPath,
        "apps/server/src/bin.ts",
        "start",
        "--bootstrap-fd",
        "3",
        "--log-level",
        "debug",
      ],
    }) + "\n",
  );
  const ready = Promise.withResolvers();
  let output = "";
  for (const pipe of [server.stdout, server.stderr])
    pipe?.on("data", (data) => {
      const text = data.toString().replaceAll(bootstrap, "[REDACTED]");
      NodeFS.appendFileSync(NodePath.join(evidence, "server.log"), text);
      output = (output + text).slice(-8192);
      if (output.includes("startup phase: complete")) ready.resolve();
    });
  server.once("error", ready.reject);
  server.once("exit", (code) => ready.reject(new Error(`Server exited ${code}`)));
  const startupDeadline = setTimeout(
    () => ready.reject(new Error("Server startup timed out")),
    60_000,
  );
  return { server, ready: ready.promise.finally(() => clearTimeout(startupDeadline)) };
}
let { server, ready } = startServer();
const abort = new AbortController();
const onSignal = () => abort.abort(new Error("Verification interrupted"));
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);
let verdict = { status: "failed", reason: "verification did not finish" };
try {
  await ready;
  const tokenResponse = await fetch(`${origin}/oauth/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: bootstrap,
      subject_token_type: "urn:t3:params:oauth:token-type:environment-bootstrap",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    }),
  });
  NodeAssert.ok(tokenResponse.ok, `Authentication failed: ${tokenResponse.status}`);
  const token = Schema.decodeUnknownSync(Schema.Struct({ access_token: Schema.String }))(
    await tokenResponse.json(),
  );
  const headers = {
    Authorization: `Bearer ${token.access_token}`,
    "Content-Type": "application/json",
    [ORCHESTRATION_PROTOCOL_HEADER]: String(ORCHESTRATION_PROTOCOL_VERSION),
  };
  const projectId = ProjectId.make(NodeCrypto.randomUUID());
  const created = await fetch(`${origin}/api/projects/mutate`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      type: "project.create",
      commandId: NodeCrypto.randomUUID(),
      projectId,
      title: "Background verification",
      workspaceRoot: project,
    }),
  });
  NodeAssert.ok(created.ok, `Project creation failed: ${created.status} ${await created.text()}`);
  const ticketResponse = await fetch(`${origin}/api/auth/websocket-ticket`, {
    method: "POST",
    headers,
  });
  NodeAssert.ok(ticketResponse.ok, `WebSocket authentication failed: ${ticketResponse.status}`);
  const ticket = Schema.decodeUnknownSync(Schema.Struct({ ticket: Schema.String }))(
    await ticketResponse.json(),
  );
  const layerSocket = Socket.layerWebSocket(
    `${origin.replace("http:", "ws:")}/ws?orchestrationProtocol=${ORCHESTRATION_PROTOCOL_VERSION}&wsTicket=${encodeURIComponent(ticket.ticket)}`,
  ).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal));
  const layerProtocol = RpcClient.layerProtocolSocket().pipe(
    Layer.provide(layerSocket),
    Layer.provide(RpcSerialization.layerJson),
  );
  const threadId = ThreadId.make(NodeCrypto.randomUUID());
  const gateUrl = `http://127.0.0.1:${gateAddress.port}${gatePath}`;
  const terminalRuns = new Map();
  const saveProjection = (row, projection) => {
    NodeFS.appendFileSync(
      NodePath.join(evidence, "scenarios.ndjson"),
      JSON.stringify({ row, at: new Date().toISOString(), projection }) + "\n",
    );
    for (const run of projection.runs)
      if (["completed", "cancelled", "interrupted", "failed"].includes(run.status))
        terminalRuns.set(run.id, run);
  };
  const barrier = async (row) => {
    const boundary = capture.receipts.length;
    const expected = {};
    for (const run of terminalRuns.values()) {
      const key = run.status + ":" + (run.delegatedTaskId !== undefined);
      expected[key] = (expected[key] ?? 0) + 1;
    }
    const receipt = await capture.wait((r) => {
      const ps = points(r);
      if (!ps.some((p) => p.name.includes("rpc"))) return false;
      if (!feature) return !ps.some((p) => p.name === "t3_runs_total");
      return Object.entries(expected).every(([key, count]) => {
        const [status, delegated] = key.split(":");
        return (
          ps
            .filter(
              (p) =>
                p.name === "t3_runs_total" &&
                p.attrs.outcome === status &&
                String(p.attrs.delegated) === delegated,
            )
            .reduce((n, p) => n + Number(p.point.asDouble ?? p.point.asInt ?? 0), 0) >= count
        );
      });
    }, boundary);
    NodeFS.appendFileSync(
      NodePath.join(evidence, "receipts.ndjson"),
      JSON.stringify({
        row,
        at: new Date().toISOString(),
        expected,
        receiptIndex: capture.receipts.indexOf(receipt),
        points: points(receipt),
      }) + "\n",
    );
  };
  const metricProgram = Effect.gen(function* () {
    const client = yield* RpcClient.make(WsRpcGroup);
    const uuid = () => NodeCrypto.randomUUID();
    const dispatch = (command) =>
      client["orchestration.dispatchCommand"](command).pipe(
        Effect.tap((receipt) =>
          Effect.sync(() =>
            NodeFS.appendFileSync(
              NodePath.join(evidence, "commands.ndjson"),
              JSON.stringify({ at: new Date().toISOString(), command, receipt }) + "\n",
            ),
          ),
        ),
      );
    const message = (text, dispatchMode) =>
      dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(uuid()),
        threadId,
        messageId: MessageId.make(uuid()),
        createdBy: "user",
        creationSource: "web",
        text,
        attachments: [],
        dispatchMode,
      });
    const observe = (predicate) =>
      client["orchestration.subscribeThread"]({ threadId }).pipe(
        Stream.mapEffect((item) =>
          Effect.gen(function* () {
            NodeFS.appendFileSync(
              NodePath.join(evidence, "events.ndjson"),
              JSON.stringify(item) + "\n",
            );
            return item.kind === "snapshot"
              ? item.projection
              : yield* client["orchestration.getThreadProjection"]({ threadId });
          }),
        ),
        Stream.filter(predicate),
        Stream.take(1),
        Stream.runCollect,
        Effect.map((xs) => xs[0]),
      );
    yield* client["orchestration.launchThread"]({
      commandId: CommandId.make(uuid()),
      threadId,
      projectId,
      title: "Run metrics proof",
      modelSelection: { instanceId: ProviderInstanceId.make(values.provider), model: values.model },
      runtimeMode: "full-access",
      interactionMode: "default",
      workspaceStrategy: { type: "root" },
      initialMessage: { text: "Reply exactly METRIC_DONE; do not call tools.", attachments: [] },
    });
    let p = yield* observe((p) => p.runs.some((r) => ["completed", "failed"].includes(r.status)));
    saveProjection("S-complete", p);
    NodeAssert.ok(
      p.runs.some((r) => r.status === "completed"),
      "initial run failed",
    );
    yield* Effect.promise(() => barrier("S-complete"));
    const prior = new Set(p.runs.map((r) => r.id));
    yield* message(
      `Run curl --fail --silent ${gateUrl} in your foreground terminal with a 600000ms timeout. Wait for its response. Do not delegate or start background work.`,
      { type: "start_immediately" },
    );
    p = yield* observe((p) => p.runs.some((r) => !prior.has(r.id) && r.status === "running"));

    yield* Effect.promise(() => gateReached.promise);
    yield* message("Reply QUEUED_CANCELLED without tools.", { type: "queue_after_active" });
    p = yield* observe((p) => p.runs.some((r) => r.status === "queued"));
    saveProjection("S-running-queued-silence", p);
    yield* Effect.promise(() => barrier("S-running-queued-silence"));
    const queuedId = p.runs.find((r) => r.status === "queued").id;
    const cancel = {
      type: "queued-run.cancel",
      commandId: CommandId.make(uuid()),
      threadId,
      runId: queuedId,
    };
    yield* dispatch(cancel);
    p = yield* observe((p) => p.runs.some((r) => r.id === queuedId && r.status === "cancelled"));
    saveProjection("S-cancel", p);
    yield* Effect.promise(() => barrier("S-cancel"));
    yield* dispatch(cancel);
    yield* Effect.promise(() => barrier("S-cancel-duplicate-receipt"));
    yield* message("Reply QUEUED_DONE without tools.", { type: "queue_after_active" });
    p = yield* observe((p) => p.runs.some((r) => r.status === "queued"));
    const followId = p.runs.find((r) => r.status === "queued").id;
    saveProjection("S-queue-held", p);
    yield* Effect.promise(() => barrier("S-queue-held"));
    response.end("RELEASED");
    released = true;
    p = yield* observe((p) =>
      p.runs.some((r) => r.id === followId && ["completed", "failed"].includes(r.status)),
    );
    saveProjection("S-queue", p);
    yield* Effect.promise(() => barrier("S-queue"));
    const seen = new Set(p.runs.map((r) => r.id));
    yield* message(
      "Use your foreground terminal to run node -e 'process.stdin.resume()' with a 600000ms timeout. Wait for the command, do not delegate.",
      { type: "start_immediately" },
    );
    p = yield* observe((p) => p.runs.some((r) => !seen.has(r.id) && r.status === "running"));
    const interruptId = p.runs.find((r) => !seen.has(r.id) && r.status === "running").id;
    yield* dispatch({
      type: "run.interrupt",
      commandId: CommandId.make(uuid()),
      threadId,
      runId: interruptId,
      holdQueue: true,
    });
    p = yield* observe((p) =>
      p.runs.some((r) => r.id === interruptId && r.status === "interrupted"),
    );
    saveProjection("S-interrupt", p);
    yield* Effect.promise(() => barrier("S-interrupt"));
    p = yield* observe((p) => p.checkpoints.filter((c) => c.status === "ready").length >= 2);
    NodeFS.writeFileSync(NodePath.join(evidence, "pre-rollback.json"), JSON.stringify(p, null, 2));
    const checkpoint = p.checkpoints.find((c) => c.status === "ready" && c.appRunOrdinal === 1);
    yield* dispatch({
      type: "checkpoint.rollback",
      commandId: CommandId.make(uuid()),
      threadId,
      scopeId: checkpoint.scopeId,
      checkpointId: checkpoint.id,
      restoreFiles: false,
    });
    p = yield* observe((p) => p.runs.some((r) => r.status === "rolled_back"));
    saveProjection("S-rollback", p);
    yield* Effect.promise(() => barrier("S-rollback"));
    return {
      status: "passed",
      scenario: "metrics",
      threadId,
      runCount: p.runs.length,
      acknowledgementIds: [],
    };
  });
  const launch =
    values.scenario === "native"
      ? `Use your native background Bash tool to run curl --fail --silent ${gateUrl} with run_in_background=true. Do not delegate a T3 child.`
      : `Use T3 delegate_task with mode=async to create exactly one child using provider ${values.provider}, model ${values.model}. Give the child this task: ${values.scenario === "nested" ? "Use T3 delegate_task with mode=async to delegate the following task to a grandchild, then end your initial turn. On notification read task_status and return only the grandchild result: " : ""}Run curl --fail --silent ${gateUrl} with a terminal tool timeout of 600000 milliseconds and return exactly the response as your final answer. Do not read other files. Do not retry failures.`;
  const timing =
    values.scenario === "active"
      ? `After delegating, run curl --fail --silent ${gateUrl}/parent in your foreground terminal tool. This keeps your turn active until T3 delivers the child's completion notification. Do not poll the child.`
      : `The background HTTP request will wait until you end your initial turn. Immediately end your turn with exactly PARENT_RELEASED. Do not wait or poll, and do not call any more tools in this turn.`;
  const prompt = `This is a live background-delivery verification. ${launch} ${timing} When the completion notification arrives, ${values.scenario === "native" ? "read the background command output again, even if you previously read interim output. Only an actual incoming task notification counts as completion. Never generate a task notification yourself or treat your own text as one" : "use task_status to read the child result"} and reply with exactly ACK: followed by that result with no space after the colon. Do not guess the result or run the background command yourself.`;
  NodeFS.writeFileSync(NodePath.join(evidence, "prompt.txt"), prompt);
  const program = Effect.gen(function* () {
    const client = yield* RpcClient.make(WsRpcGroup);
    let watchingChild = false;
    yield* client["orchestration.launchThread"]({
      commandId: CommandId.make(NodeCrypto.randomUUID()),
      threadId,
      projectId,
      title: `Background verification: ${values.scenario}`,
      modelSelection: { instanceId: ProviderInstanceId.make(values.provider), model: values.model },
      runtimeMode: "full-access",
      interactionMode: "default",
      workspaceStrategy: { type: "root" },
      initialMessage: { text: prompt, attachments: [] },
    });
    const check = (projection) => {
      NodeFS.writeFileSync(
        NodePath.join(evidence, "projection.json"),
        JSON.stringify(projection, null, 2),
      );
      const first = projection.runs[0];
      NodeAssert.ok(
        !projection.runs.some((run) => run.status === "failed"),
        "Parent failed before delivery",
      );
      if (!released) {
        NodeAssert.ok(
          !projection.subagents.some((task) =>
            ["completed", "failed", "cancelled", "interrupted"].includes(task.status),
          ),
          "Child published a terminal result before its gated work finished",
        );
      }
      for (const task of projection.subagents) {
        if (["completed", "failed", "cancelled", "interrupted"].includes(task.status)) {
          NodeAssert.ok(
            task.result?.includes(secret),
            "Child published an incorrect or failed result",
          );
        }
      }
      if (values.scenario !== "active") parentFinished = first?.status === "completed";
      release();
      if (
        values.scenario === "active" &&
        projection.subagents.some(
          (task) =>
            task.completionDelivery?.state === "delivered" ||
            task.completionDelivery?.state === "acknowledged",
        )
      ) {
        parentResponse?.end("Completion notification delivered. Read task_status now.");
      }
      const acknowledged = projection.messages.some(
        (message) => message.role === "assistant" && message.text.includes(secret),
      );
      return (
        acknowledged &&
        projection.runs.every((run) =>
          ["completed", "failed", "cancelled", "interrupted", "rolled_back"].includes(run.status),
        )
      );
    };
    const result = yield* client["orchestration.subscribeThread"]({ threadId }).pipe(
      Stream.mapEffect(
        Effect.fn(function* (item) {
          NodeFS.appendFileSync(
            NodePath.join(evidence, "events.ndjson"),
            JSON.stringify(item) + "\n",
          );
          const projection =
            item.kind === "snapshot"
              ? item.projection
              : yield* client["orchestration.getThreadProjection"]({ threadId });
          const childThreadId = projection.subagents[0]?.childThreadId;
          if (values.scenario === "nested" && childThreadId && !watchingChild) {
            watchingChild = true;
            yield* client["orchestration.subscribeThread"]({ threadId: childThreadId }).pipe(
              Stream.runForEach(
                Effect.fn(function* (childItem) {
                  NodeFS.appendFileSync(
                    NodePath.join(evidence, "nested-events.ndjson"),
                    JSON.stringify(childItem) + "\n",
                  );
                  const child =
                    childItem.kind === "snapshot"
                      ? childItem.projection
                      : yield* client["orchestration.getThreadProjection"]({
                          threadId: childThreadId,
                        });
                  nestedChildFinished =
                    child.runs[0]?.status === "completed" && child.subagents.length === 1;
                  release();
                }),
              ),
              Effect.forkScoped,
            );
          }
          return { projection, complete: check(projection) };
        }),
      ),
      Stream.filter((item) => item.complete),
      Stream.take(1),
      Stream.runCollect,
    );
    let final = result[0]?.projection;
    NodeAssert.ok(final, "Stream ended without proof of delivery");
    NodeAssert.ok(released, "Child did not use the controlled gate");
    NodeAssert.equal(
      final.subagents.filter((task) => task.origin === "app_owned").length,
      values.scenario === "native" ? 0 : 1,
      "Wrong delegation path",
    );
    NodeAssert.ok(
      final.turnItems.some((item) => item.type === "notification"),
      "Missing typed notification",
    );
    NodeAssert.equal(
      final.turnItems.filter((item) => item.type === "user_message").length,
      1,
      "Background delivery appeared as an ordinary user message",
    );
    NodeAssert.ok(!final.runs.some((run) => run.status === "failed"), "A parent run failed");
    NodeAssert.equal(
      final.turnItems.filter((item) => item.type === "notification").length,
      1,
      "One completion produced multiple notifications",
    );
    for (const task of final.subagents.filter((task) => task.origin === "app_owned")) {
      NodeAssert.equal(task.status, "completed", "Child did not complete successfully");
      NodeAssert.ok(task.result?.includes(secret), "Published task result lost the actual work");
      NodeAssert.equal(
        task.completionDelivery?.state,
        "acknowledged",
        "Parent did not read task_status",
      );
    }
    if (values.scenario === "nested") {
      const childThreadId = final.subagents[0]?.childThreadId;
      NodeAssert.ok(childThreadId, "Missing nested task owner");
      const child = yield* client["orchestration.getThreadProjection"]({ threadId: childThreadId });
      NodeFS.writeFileSync(
        NodePath.join(evidence, "nested-projection.json"),
        JSON.stringify(child, null, 2),
      );
      NodeAssert.equal(child.subagents.length, 1, "Missing grandchild");
      NodeAssert.ok(child.subagents[0]?.result?.includes(secret), "Nested result was lost");
    }
    NodeAssert.ok(
      final.providerThreads.every((thread) => (thread.pendingBackgroundTasks?.length ?? 0) === 0),
      "Stale background work remains after completion",
    );
    if (values.scenario === "active") {
      NodeAssert.equal(final.runs.length, 1, "Active delivery unexpectedly started another run");
      NodeAssert.ok(parentResponse, "Parent never entered the foreground gate");
    } else {
      NodeAssert.ok(
        final.runs.length >= 2,
        "Expected a new continuation after the initial turn ended",
      );
    }
    saveProjection("S-delegate-parent-initial", final);
    const childId = final.subagents[0].childThreadId;
    const initialChild = yield* client["orchestration.getThreadProjection"]({ threadId: childId });
    saveProjection("S-delegate-child-initial", initialChild);
    const lastChildOrdinal = Math.max(...initialChild.runs.map((r) => r.ordinal));
    const lastParentOrdinal = Math.max(...final.runs.map((r) => r.ordinal));
    const followup = {
      type: "message.dispatch",
      commandId: CommandId.make(NodeCrypto.randomUUID()),
      threadId: childId,
      messageId: MessageId.make(NodeCrypto.randomUUID()),
      createdBy: "user",
      creationSource: "web",
      text: "Reply exactly METRIC_CHILD_FOLLOWUP; do not call tools.",
      attachments: [],
      dispatchMode: { type: "start_immediately" },
    };
    const receipt = yield* client["orchestration.dispatchCommand"](followup);
    NodeFS.appendFileSync(
      NodePath.join(evidence, "commands.ndjson"),
      JSON.stringify({ at: new Date().toISOString(), command: followup, receipt }) + "\n",
    );
    const observeThread = (id, predicate) =>
      client["orchestration.subscribeThread"]({ threadId: id }).pipe(
        Stream.mapEffect((item) =>
          Effect.gen(function* () {
            NodeFS.appendFileSync(
              NodePath.join(evidence, "followup-events.ndjson"),
              JSON.stringify({ threadId: id, item }) + "\n",
            );
            return item.kind === "snapshot"
              ? item.projection
              : yield* client["orchestration.getThreadProjection"]({ threadId: id });
          }),
        ),
        Stream.filter(predicate),
        Stream.take(1),
        Stream.runCollect,
        Effect.map((xs) => xs[0]),
      );
    const child = yield* observeThread(childId, (p) =>
      p.runs.some((r) => r.ordinal > lastChildOrdinal && r.status === "completed"),
    );
    NodeAssert.ok(
      child.runs.some((r) => r.ordinal > lastChildOrdinal && r.delegatedTaskId !== undefined),
      "Follow-up child lacks delegatedTaskId",
    );
    saveProjection("S-delegate-child-followup", child);
    final = yield* observeThread(
      threadId,
      (p) =>
        p.runs.some((r) => r.ordinal > lastParentOrdinal && r.status === "completed") &&
        p.runs.every((r) =>
          ["completed", "failed", "cancelled", "interrupted", "rolled_back"].includes(r.status),
        ),
    );
    saveProjection("S-delegate-parent-followup", final);
    NodeFS.writeFileSync(
      NodePath.join(evidence, "projection.json"),
      JSON.stringify(final, null, 2),
    );
    return {
      status: "passed",
      scenario: values.scenario,
      threadId,
      runCount: final.runs.length,
      acknowledgementIds: final.messages
        .filter((message) => message.role === "assistant" && message.text.includes(secret))
        .map((message) => message.id),
    };
  });
  const selected = (values.scenario === "metrics" ? metricProgram : program).pipe(
    Effect.scoped,
    Effect.provide(layerProtocol),
    Effect.timeout(timeoutMs),
  );
  const finished = await Effect.runPromise(selected, { signal: abort.signal });
  const beforeRestartResponse = await fetch(`${origin}/api/orchestration/threads/${threadId}`, {
    headers,
  });
  const beforeRestart = await beforeRestartResponse.json();
  NodeFS.writeFileSync(
    NodePath.join(evidence, "before-restart.json"),
    JSON.stringify(beforeRestart, null, 2),
  );
  verdict = finished;
  if (values.scenario !== "metrics") {
    const parent = JSON.parse(
      NodeFS.readFileSync(NodePath.join(evidence, "projection.json"), "utf8"),
    );
    saveProjection("S-delegate-parent", parent);
    for (const task of parent.subagents) {
      const r = await fetch(
        `${origin}/api/orchestration/threads/${encodeURIComponent(task.childThreadId)}`,
        {
          headers,
        },
      );
      NodeAssert.ok(r.ok, `Child read failed: ${r.status}`);
      const child = await r.json();
      saveProjection("S-delegate-child", child.projection);
    }
    await barrier("S-delegate");
  }
  await stopServer(server);
  const restartBoundary = capture.receipts.length;
  ({ server, ready } = startServer());
  await ready;
  const restored = await fetch(`${origin}/api/orchestration/threads/${threadId}`, { headers });
  NodeAssert.ok(restored.ok, `Restart read failed: ${restored.status}`);
  const snapshot = await restored.json();
  NodeFS.writeFileSync(
    NodePath.join(evidence, "after-restart.json"),
    JSON.stringify(snapshot, null, 2),
  );
  const durable = Schema.decodeUnknownSync(
    Schema.Struct({
      projection: Schema.Struct({
        messages: Schema.Array(
          Schema.Struct({ id: Schema.String, role: Schema.String, text: Schema.String }),
        ),
        runs: Schema.Array(Schema.Struct({ id: Schema.String, status: Schema.String })),
      }),
    }),
  )(snapshot);
  NodeAssert.deepEqual(
    durable.projection.runs.map((r) => [r.id, r.status]),
    beforeRestart.projection.runs.map((r) => [r.id, r.status]),
    "Restart changed runs",
  );
  const restartReceipt = await capture.wait(
    (r) => points(r).length > 0 && !points(r).some((p) => p.name === "t3_runs_total"),
    restartBoundary,
  );
  NodeFS.appendFileSync(
    NodePath.join(evidence, "receipts.ndjson"),
    JSON.stringify({
      row: "S-restart",
      receiptIndex: capture.receipts.indexOf(restartReceipt),
      points: points(restartReceipt),
    }) + "\n",
  );
  if (values.scenario === "metrics") {
    const initial = snapshot.projection.checkpoints.find(
      (c) => c.ordinalWithinScope === 0 && c.status === "ready",
    );
    NodeAssert.ok(initial, "Missing initial checkpoint after restart");
    const stillCompleted = snapshot.projection.runs.find((r) => r.status === "completed");
    NodeAssert.ok(
      stillCompleted,
      "Rollback fixture must retain a completed run for restart exclusion",
    );
    const ticketResponse = await fetch(`${origin}/api/auth/websocket-ticket`, {
      method: "POST",
      headers,
    });
    NodeAssert.ok(ticketResponse.ok);
    const restartTicket = await ticketResponse.json();
    const restartSocket = Socket.layerWebSocket(
      `${origin.replace("http:", "ws:")}/ws?orchestrationProtocol=${ORCHESTRATION_PROTOCOL_VERSION}&wsTicket=${encodeURIComponent(restartTicket.ticket)}`,
    ).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal));
    const restartProtocol = RpcClient.layerProtocolSocket().pipe(
      Layer.provide(restartSocket),
      Layer.provide(RpcSerialization.layerJson),
    );
    const rolled = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* RpcClient.make(WsRpcGroup);
        yield* client["orchestration.dispatchCommand"]({
          type: "checkpoint.rollback",
          commandId: CommandId.make(NodeCrypto.randomUUID()),
          threadId,
          scopeId: initial.scopeId,
          checkpointId: initial.id,
          restoreFiles: false,
        });
        return yield* client["orchestration.subscribeThread"]({ threadId }).pipe(
          Stream.mapEffect((item) =>
            Effect.gen(function* () {
              NodeFS.appendFileSync(
                NodePath.join(evidence, "restart-events.ndjson"),
                JSON.stringify(item) + "\n",
              );
              return {
                item,
                projection:
                  item.kind === "snapshot"
                    ? item.projection
                    : yield* client["orchestration.getThreadProjection"]({ threadId }),
              };
            }),
          ),
          Stream.filter(
            (p) =>
              (p.item.kind === "event" &&
                p.item.event.type === "run.updated" &&
                p.item.event.payload.id === stillCompleted.id &&
                p.item.event.payload.status === "rolled_back") ||
              p.projection.runs.some(
                (r) => r.id === stillCompleted.id && r.status === "rolled_back",
              ),
          ),
          Stream.take(1),
          Stream.runCollect,
          Effect.map((xs) => xs[0]),
        );
      }).pipe(Effect.scoped, Effect.provide(restartProtocol), Effect.timeout(timeoutMs)),
    );
    saveProjection("S-rollback-after-restart", rolled.projection);
    NodeFS.writeFileSync(
      NodePath.join(evidence, "restart-rollback-event.json"),
      JSON.stringify(rolled.item, null, 2),
    );
    const receipt = await capture.wait(
      (r) =>
        points(r).some((p) => p.name.includes("rpc")) &&
        !points(r).some((p) => p.name === "t3_runs_total"),
    );
    NodeFS.appendFileSync(
      NodePath.join(evidence, "receipts.ndjson"),
      JSON.stringify({
        row: "S-rollback-after-restart",
        receiptIndex: capture.receipts.indexOf(receipt),
        points: points(receipt),
      }) + "\n",
    );
  }
  verdict = { ...verdict, restart: "passed" };
  console.log(JSON.stringify(verdict));
} catch (error) {
  verdict = {
    status: "failed",
    scenario: values.scenario,
    reason: String(error),
    milestones: {
      parentFinished,
      nestedChildFinished,
      gateRequested: response !== undefined,
      gateReleased: released,
      parentGateRequested: parentResponse !== undefined,
    },
  };
  console.error(String(error));
  process.exitCode = 1;
} finally {
  NodeFS.writeFileSync(NodePath.join(evidence, "verdict.json"), JSON.stringify(verdict, null, 2));
  response?.destroy();
  parentResponse?.destroy();
  gate.closeAllConnections();
  gate.close();
  await stopServer(server);
  await capture.close();
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
}

async function stopServer(server) {
  if (server.exitCode === null && server.signalCode === null) {
    const stopped = new Promise((done) => server.once("exit", () => done()));
    server.kill("SIGTERM");
    const deadline = setTimeout(() => server.kill("SIGKILL"), 10_000);
    await stopped;
    clearTimeout(deadline);
  }
  if (server.pid) {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
    }
  }
}
