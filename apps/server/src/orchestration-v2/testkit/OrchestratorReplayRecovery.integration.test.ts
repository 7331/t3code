import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as CodexReplay from "effect-codex-app-server/replay";
import {
  type OrchestrationV2ThreadProjection,
  ProviderDriverKind,
  type ThreadId,
} from "@t3tools/contracts";

import {
  ClaudeOrchestratorReplayHarness,
  makeClaudeRestartReplayHarness,
} from "../Adapters/ClaudeAdapterV2.testkit.ts";
import { CodexOrchestratorReplayHarness } from "../Adapters/CodexAdapterV2.testkit.ts";
import * as CodexAdapterV2Testkit from "../Adapters/CodexAdapterV2.testkit.ts";
import {
  type CursorAgentSdkReplayTranscript,
  CursorOrchestratorReplayHarness,
  makeCursorAgentSdkReplayRunner,
} from "../Adapters/CursorAdapterV2.testkit.ts";
import * as CursorAdapterV2Testkit from "../Adapters/CursorAdapterV2.testkit.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as EffectWorker from "../EffectWorker.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import { provideDeterministicTestRuntime } from "./DeterministicRuntime.ts";
import {
  CLAUDE_MODEL_SELECTION,
  CODEX_MODEL_SELECTION,
  CURSOR_MODEL_SELECTION,
  materializeFixtureInput,
  type MaterializedOrchestratorFixtureInput,
  PROVIDER_THREAD_RESUME_FIRST_PROMPT,
  PROVIDER_THREAD_RESUME_SECOND_PROMPT,
  SUBAGENT_CONTINUE_CHILD_PROMPT,
  SUBAGENT_CONTINUE_PARENT_PROMPT,
  SUBAGENT_CONTINUE_PROMPT,
} from "./fixtures/shared.ts";
import {
  assertAssistantTextIncludes,
  assertBaseProjection,
  assertConversationMessageRoles,
  assertRunOrdinals,
  assertSemanticProjectionIntegrity,
  assertTurnItemTypes,
  assertUserMessagesInclude,
  projectionFor,
} from "./fixtures/shared.ts";
import {
  runOrchestratorV2Scenario,
  type OrchestratorV2ScenarioResult,
} from "./OrchestratorScenario.ts";
import {
  layerProviderReplay,
  runOrchestratorV2ProviderReplayScenario,
} from "./ProviderReplayHarness.ts";
import { checkpointWorkspace } from "@t3tools/provider-testing/replayWorkspace";
import { materializeReplayTranscriptRuntimeInstructions } from "./ReplayRuntimeInstructions.ts";
import {
  materializeReplayTranscriptWorkspace,
  readProviderReplayTranscript,
} from "@t3tools/provider-testing/replayTranscript";

const FIRST_FINAL = "provider thread resume fixture first turn complete";
const SECOND_FINAL = "provider thread resume fixture second turn complete";

const decodeCodexTranscript = Schema.decodeUnknownEffect(
  CodexReplay.CodexAppServerReplayTranscript,
);
const readRawTranscript = Effect.fn("readRecoveryTranscript")(function* (file: URL) {
  return yield* readProviderReplayTranscript(file);
});
const readCodexTranscript = Effect.fn("readCodexRecoveryTranscript")(function* (workspace: string) {
  const transcript = yield* readRawTranscript(
    new URL("./fixtures/provider_thread_resume/codex_transcript.ndjson", import.meta.url),
  );
  return yield* decodeCodexTranscript(materializeReplayTranscriptWorkspace(transcript, workspace));
});
// gpt-5.6-luna still runs multi-agent v1 (collabAgentToolCall), as recorded.
const CODEX_SUBAGENT_CONTINUE_MODEL_SELECTION = { ...CODEX_MODEL_SELECTION, model: "gpt-5.6-luna" };
/**
 * The recorded subagent_continue session with a server restart between its two
 * root turns: the second runtime resumes the parent, whose turn then messages
 * the child the first runtime spawned.
 */
const readCodexSubagentContinueAfterRestartTranscript = Effect.fn(
  "readCodexSubagentContinueAfterRestartTranscript",
)(function* (workspace: string, childTurnOrder: "after_parent" | "before_parent") {
  const recorded = yield* readRawTranscript(
    new URL("./fixtures/subagent_continue/codex_transcript.ndjson", import.meta.url),
  );
  const entries = recorded.entries;
  const secondTurnStart = entries.findLastIndex(
    (entry) => entry.type === "expect_outbound" && entry.label === "turn/start",
  );
  const threadStart = entries.find(
    (entry) => entry.type === "emit_inbound" && entry.label === "thread/start",
  );
  const threadStartResult =
    threadStart?.type === "emit_inbound" ? Reflect.get(Object(threadStart.frame), "result") : null;
  const nativeThreadId: unknown = Reflect.get(Object(Object(threadStartResult).thread), "id");
  if (secondTurnStart < 0 || typeof nativeThreadId !== "string") {
    throw new Error("subagent_continue must record a thread/start and two root turns.");
  }
  const renumber = (entry: (typeof entries)[number], id: number) =>
    entry.type === "expect_outbound" || entry.type === "emit_inbound"
      ? { ...entry, frame: { ...Object(entry.frame), id } }
      : entry;
  const [initialize, initializeResult, initialized] = entries.slice(0, 3);
  if (initialize === undefined || initializeResult === undefined || initialized === undefined) {
    throw new Error("subagent_continue must open with the initialize handshake.");
  }
  const continuation = entries.slice(secondTurnStart + 2);
  const earlyChildStartIndex =
    childTurnOrder === "before_parent"
      ? continuation.findIndex(
          (entry) =>
            entry.type === "emit_inbound" &&
            Object(entry.frame).method === "turn/started" &&
            Object(Object(entry.frame).params).threadId !== nativeThreadId,
        )
      : -1;
  return yield* decodeCodexTranscript(
    materializeReplayTranscriptWorkspace(
      {
        ...recorded,
        scenario: "subagent_continue_after_restart",
        entries: [
          ...entries.slice(0, secondTurnStart),
          { type: "runtime_exit", status: "success" },
          initialize,
          initializeResult,
          initialized,
          {
            type: "expect_outbound",
            label: "thread/resume",
            frame: {
              id: 2,
              method: "thread/resume",
              params: {
                config: { "tools.update_plan.enabled": true, mcp_optional_startup_grace_ms: 10000 },
                cwd: "<workspace>",
                excludeTurns: true,
                model: CODEX_SUBAGENT_CONTINUE_MODEL_SELECTION.model,
                threadId: nativeThreadId,
              },
            },
          },
          {
            type: "emit_inbound",
            label: "thread/resume",
            frame: { id: 2, result: threadStartResult },
          },
          renumber(entries[secondTurnStart]!, 3),
          ...continuation.filter((_, index) => index === earlyChildStartIndex),
          renumber(entries[secondTurnStart + 1]!, 3),
          ...continuation.filter((_, index) => index !== earlyChildStartIndex),
        ],
      },
      workspace,
    ),
  );
});
const decodePromptPair = Schema.decodeUnknownEffect(Schema.Tuple([Schema.String, Schema.String]));
const readClaudeSubagentResumeTranscript = Effect.fn("readClaudeSubagentResumeTranscript")(
  function* () {
    return yield* ClaudeOrchestratorReplayHarness.decodeTranscript(
      yield* readRawTranscript(
        new URL(
          "./fixtures/claude_subagent_resume_after_restart/claude_transcript.ndjson",
          import.meta.url,
        ),
      ),
    );
  },
);
/**
 * The same session with the math.ts subagent's first run removed: the root
 * turn settles while the subagent still works, and the server restarts
 * before it reports, so recovery cancels it. The resumed turn then carries
 * the restart note, as T3 sends it.
 */
const readClaudeCancelledSubagentResumeTranscript = Effect.fn(
  "readClaudeCancelledSubagentResumeTranscript",
)(function* () {
  const recorded = yield* readRawTranscript(
    new URL(
      "./fixtures/claude_subagent_resume_after_restart/claude_transcript.ndjson",
      import.meta.url,
    ),
  );
  const frameField = (index: number, key: string): unknown => {
    const entry = recorded.entries[index];
    return entry?.type === "emit_inbound" && typeof entry.frame === "object" && entry.frame !== null
      ? Reflect.get(entry.frame, key)
      : undefined;
  };
  const indices = recorded.entries.map((_, index) => index);
  const firstSubagentFrame = indices.find(
    (index) => typeof frameField(index, "parent_tool_use_id") === "string",
  );
  const firstOutcome = indices.find(
    (index) => frameField(index, "subtype") === "task_notification",
  );
  const firstExit = recorded.entries.findIndex((entry) => entry.type === "runtime_exit");
  if (firstSubagentFrame === undefined || firstOutcome === undefined || firstExit < 0) {
    throw new Error("Expected the recorded subagent's first run.");
  }
  const entries = recorded.entries
    // A CLI exit settles the task; hold at query.open:2 until the crash snapshot instead.
    .filter(
      (_, index) => (index < firstSubagentFrame || index > firstOutcome) && index !== firstExit,
    )
    .map((entry) => {
      if (entry.type !== "expect_outbound" || entry.label !== "prompt.offer:2") return entry;
      const frame = entry.frame as {
        readonly message: { readonly message: { readonly content: string } };
      };
      return {
        ...entry,
        frame: {
          ...frame,
          message: {
            ...frame.message,
            message: {
              ...frame.message.message,
              content: [
                "Note: the T3 server restarted, and this background work was cancelled before it finished. It will not report back on its own, so resume or restart what you still need and wait for its result:",
                "- subagent: Audit src/math.ts (id a44c0ed810da9e4f3)",
                "",
                "User message:",
                frame.message.message.content,
              ].join("\n"),
            },
          },
        },
      };
    });
  return yield* ClaudeOrchestratorReplayHarness.decodeTranscript({ ...recorded, entries });
});
const readCursorTranscript = Effect.fn("readCursorRecoveryTranscript")(function* () {
  const transcript = yield* readRawTranscript(
    new URL("./fixtures/provider_thread_resume/cursor_transcript.ndjson", import.meta.url),
  );
  return yield* CursorOrchestratorReplayHarness.decodeTranscript(
    materializeReplayTranscriptRuntimeInstructions(transcript, {
      driver: ProviderDriverKind.make("cursor"),
      model: CURSOR_MODEL_SELECTION.model,
    }),
  );
});

function splitAfterFirstIdle(materialized: MaterializedOrchestratorFixtureInput) {
  const splitIndex = materialized.steps.findIndex((step) => step.type === "await_thread_idle");
  if (splitIndex < 0) {
    throw new Error("Expected fixture to contain await_thread_idle after the first turn.");
  }

  const phase1Steps = materialized.steps.slice(0, splitIndex + 1);
  const phase2Steps = materialized.steps.slice(splitIndex + 1);
  return {
    phase1Steps,
    phase2Steps,
    phase1Commands: phase1Steps.flatMap((step) => (step.type === "dispatch" ? [step.command] : [])),
    phase2Commands: phase2Steps.flatMap((step) => (step.type === "dispatch" ? [step.command] : [])),
  };
}

const runCursorRecovery = Effect.fn("runCursorRecovery")(function* (input: {
  readonly transcript: CursorAgentSdkReplayTranscript;
  readonly runner: ReturnType<typeof makeCursorAgentSdkReplayRunner>;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const tempDir = yield* Effect.acquireRelease(
    fs.makeTempDirectory({
      prefix: "t3-orchestration-v2-cursor-recovery-",
    }),
    (directory) => fs.remove(directory, { recursive: true, force: true }).pipe(Effect.orDie),
  );
  yield* fs.makeDirectory(tempDir, { recursive: true });
  const dbPath = path.join(tempDir, "state.sqlite");
  const materialized = yield* materializeFixtureInput({
    scenario: "provider_thread_resume",
    fixtureInput: {
      steps: [
        { type: "message", text: PROVIDER_THREAD_RESUME_FIRST_PROMPT },
        { type: "message", text: PROVIDER_THREAD_RESUME_SECOND_PROMPT },
      ],
    },
    driver: ProviderDriverKind.make("cursor"),
    modelSelection: CURSOR_MODEL_SELECTION,
  });
  const { phase1Commands, phase1Steps, phase2Commands, phase2Steps } =
    splitAfterFirstIdle(materialized);
  const options = {
    databaseLayer: SqlitePersistence.layerFromPath(dbPath).pipe(Layer.provide(NodeServices.layer)),
  };
  const harness = {
    ...CursorOrchestratorReplayHarness,
    makeProviderAdapterRegistryLayer: () =>
      CursorAdapterV2Testkit.layer(input.transcript, {
        runner: input.runner,
        assertCompleteOnFinalize: false,
      }),
  };

  yield* Effect.scoped(
    runOrchestratorV2ProviderReplayScenario(
      {
        name: "provider_thread_resume/cursor:first-runtime",
        transcript: input.transcript,
        commands: phase1Commands,
        steps: phase1Steps,
        projectionThreadIds: materialized.projectionThreadIds,
        runtimePolicyOverride: { cwd: tempDir },
      },
      harness,
      options,
    ),
  );

  const result = yield* Effect.scoped(
    runOrchestratorV2ProviderReplayScenario(
      {
        name: "provider_thread_resume/cursor:second-runtime",
        transcript: input.transcript,
        commands: phase2Commands,
        steps: phase2Steps,
        projectionThreadIds: materialized.projectionThreadIds,
        runtimePolicyOverride: { cwd: tempDir },
      },
      harness,
      options,
    ),
  );

  assertBaseProjection({
    result,
    transcript: input.transcript,
    runCount: 2,
    runStatuses: ["completed", "completed"],
  });
  const projection = projectionFor(result, input.transcript.scenario);
  assertSemanticProjectionIntegrity(projection);
  assertRunOrdinals(projection, [1, 2]);
  assertConversationMessageRoles(projection, ["user", "assistant", "user", "assistant"]);
  assertTurnItemTypes(projection, ["user_message", "assistant_message"]);
  assertUserMessagesInclude(projection, [
    PROVIDER_THREAD_RESUME_FIRST_PROMPT,
    PROVIDER_THREAD_RESUME_SECOND_PROMPT,
  ]);
  assertAssistantTextIncludes(projection, FIRST_FINAL);
  assertAssistantTextIncludes(projection, SECOND_FINAL);
  assert.lengthOf(projection.providerThreads, 1);
});

describe("orchestrator replay recovery", () => {
  it.effect(
    "resumes a provider-native Codex thread after recreating the orchestrator runtime",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          // Checkpoint against a throwaway git workspace: with no override the
          // scope cwd falls back to process.cwd(), and a cold full-repo
          // baseline capture on CI outlives the scenario wait budget.
          const workspace = yield* checkpointWorkspace("provider_thread_resume");
          const transcript = yield* readCodexTranscript(workspace);
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempDir = yield* Effect.acquireRelease(
            fs.makeTempDirectory({
              prefix: "t3-orchestration-v2-recovery-",
            }),
            (directory) =>
              fs.remove(directory, { recursive: true, force: true }).pipe(Effect.orDie),
          );
          yield* fs.makeDirectory(tempDir, { recursive: true });
          const dbPath = path.join(tempDir, "state.sqlite");
          const driver = yield* CodexReplay.makeReplayDriver(transcript);
          const materialized = yield* materializeFixtureInput({
            scenario: "provider_thread_resume",
            fixtureInput: {
              steps: [
                { type: "message", text: PROVIDER_THREAD_RESUME_FIRST_PROMPT },
                { type: "message", text: PROVIDER_THREAD_RESUME_SECOND_PROMPT },
              ],
            },
            driver: ProviderDriverKind.make("codex"),
            modelSelection: CODEX_MODEL_SELECTION,
          });
          const { phase1Commands, phase1Steps, phase2Commands, phase2Steps } =
            splitAfterFirstIdle(materialized);

          const harness = {
            ...CodexOrchestratorReplayHarness,
            makeProviderAdapterRegistryLayer: () =>
              CodexAdapterV2Testkit.layer({ transcript, driver }),
          };
          const options = {
            databaseLayer: SqlitePersistence.layerFromPath(dbPath).pipe(
              Layer.provide(NodeServices.layer),
            ),
          };

          yield* runOrchestratorV2ProviderReplayScenario(
            {
              name: "provider_thread_resume/codex:first-runtime",
              transcript,
              commands: phase1Commands,
              steps: phase1Steps,
              projectionThreadIds: materialized.projectionThreadIds,
              runtimePolicyOverride: { cwd: workspace },
            },
            harness,
            options,
          );

          const result = yield* runOrchestratorV2ProviderReplayScenario(
            {
              name: "provider_thread_resume/codex:second-runtime",
              transcript,
              commands: phase2Commands,
              steps: phase2Steps,
              projectionThreadIds: materialized.projectionThreadIds,
              runtimePolicyOverride: { cwd: workspace },
            },
            harness,
            options,
          );

          assertBaseProjection({
            result,
            transcript,
            runCount: 2,
            runStatuses: ["completed", "completed"],
          });
          const projection = projectionFor(result, transcript.scenario);
          assertSemanticProjectionIntegrity(projection);
          assertRunOrdinals(projection, [1, 2]);
          assertConversationMessageRoles(projection, ["user", "assistant", "user", "assistant"]);
          assertTurnItemTypes(projection, ["user_message", "assistant_message"]);
          assertUserMessagesInclude(projection, [
            PROVIDER_THREAD_RESUME_FIRST_PROMPT,
            PROVIDER_THREAD_RESUME_SECOND_PROMPT,
          ]);
          assertAssistantTextIncludes(projection, FIRST_FINAL);
          assertAssistantTextIncludes(projection, SECOND_FINAL);
          assert.lengthOf(projection.providerThreads, 1);
        }).pipe(
          provideDeterministicTestRuntime,
          Effect.provide(Layer.merge(IdAllocator.layer, NodeServices.layer)),
        ),
      ),
  );

  // regression: #15567 a restart dropped the Codex child registry, so a resumed
  // parent's messages to an existing child never reached the child's thread.
  it.effect.each(["after_parent", "before_parent"] as const)(
    "keeps a Codex subagent the parent messages after a server restart in its thread (%s)",
    (childTurnOrder) =>
      Effect.scoped(
        Effect.gen(function* () {
          const workspace = yield* checkpointWorkspace("subagent_continue");
          const transcript = yield* readCodexSubagentContinueAfterRestartTranscript(
            workspace,
            childTurnOrder,
          );
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const tempDir = yield* Effect.acquireRelease(
            fs.makeTempDirectory({ prefix: "t3-orchestration-v2-codex-subagent-recovery-" }),
            (directory) =>
              fs.remove(directory, { recursive: true, force: true }).pipe(Effect.orDie),
          );
          const driver = yield* CodexReplay.makeReplayDriver(transcript);
          const materialized = yield* materializeFixtureInput({
            scenario: transcript.scenario,
            fixtureInput: {
              steps: [
                { type: "message", text: SUBAGENT_CONTINUE_PROMPT },
                { type: "message", text: SUBAGENT_CONTINUE_PARENT_PROMPT },
              ],
            },
            driver: ProviderDriverKind.make("codex"),
            modelSelection: CODEX_SUBAGENT_CONTINUE_MODEL_SELECTION,
          });
          const { phase1Commands, phase1Steps, phase2Commands, phase2Steps } =
            splitAfterFirstIdle(materialized);
          const harness = {
            ...CodexOrchestratorReplayHarness,
            makeProviderAdapterRegistryLayer: () =>
              CodexAdapterV2Testkit.layer({ transcript, driver }),
          };
          const options = {
            databaseLayer: SqlitePersistence.layerFromPath(path.join(tempDir, "state.sqlite")).pipe(
              Layer.provide(NodeServices.layer),
            ),
          };
          const scenario = (
            name: string,
            steps: typeof phase1Steps,
            commands: typeof phase1Commands,
          ) => ({
            name: `${transcript.scenario}:${name}`,
            transcript,
            commands,
            steps,
            projectionThreadIds: materialized.projectionThreadIds,
            runtimePolicyOverride: { cwd: workspace },
          });

          const before = yield* runOrchestratorV2ProviderReplayScenario(
            scenario("first-runtime", phase1Steps, phase1Commands),
            harness,
            options,
          );
          const spawned = projectionFor(before, transcript.scenario).subagents[0];
          assert.equal(spawned?.result, "initial subagent response");

          const result = yield* runOrchestratorV2ProviderReplayScenario(
            scenario("second-runtime", phase2Steps, phase2Commands),
            harness,
            options,
          );

          const projection = projectionFor(result, transcript.scenario);
          assertSemanticProjectionIntegrity(projection);
          assert.lengthOf(projection.subagents, 1);
          const subagent = projection.subagents[0];
          assert.equal(subagent?.id, spawned?.id);
          assert.equal(subagent?.childThreadId, spawned?.childThreadId);
          assert.equal(subagent?.status, "completed");
          assert.equal(subagent?.result, "continued subagent response");
          const childThreads = [...result.projections.values()].filter(
            (candidate) => candidate.thread.lineage.parentThreadId === projection.thread.id,
          );
          assert.lengthOf(childThreads, 1);
          const child = childThreads[0];
          assert.equal(child?.thread.id, spawned?.childThreadId);
          assert.lengthOf(child?.providerTurns ?? [], 2);
          assertUserMessagesInclude(child!, [SUBAGENT_CONTINUE_CHILD_PROMPT]);
          assertAssistantTextIncludes(child!, "continued subagent response");
          // The parent independently repeats the same text in this recording.
          const childReplies = new Set(
            child!.turnItems.flatMap((item) =>
              item.type === "assistant_message" && item.text === "continued subagent response"
                ? [item.id]
                : [],
            ),
          );
          assert.equal(childReplies.size, 1);
          assertAssistantTextIncludes(projection, "continued subagent response");
          assert.isFalse(
            projection.turnItems.some((item) => childReplies.has(item.id)),
            "the child's reply leaked into the parent thread",
          );
        }).pipe(
          provideDeterministicTestRuntime,
          Effect.provide(Layer.merge(IdAllocator.layer, NodeServices.layer)),
        ),
      ),
  );

  it.effect(
    "resumes a provider-native Cursor thread after recreating the orchestrator runtime",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const transcript = yield* readCursorTranscript();
          const runner = makeCursorAgentSdkReplayRunner(transcript);
          yield* runCursorRecovery({ transcript, runner });
          yield* runner.assertComplete;
        }).pipe(
          provideDeterministicTestRuntime,
          Effect.provide(Layer.merge(IdAllocator.layer, NodeServices.layer)),
        ),
      ),
  );
  it.effect("keeps a Claude subagent resumed after a server restart in its own thread", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const transcript = yield* readClaudeSubagentResumeTranscript();
        const [launchPrompt, resumePrompt] = yield* decodePromptPair(transcript.metadata?.prompts);
        const workspace = yield* checkpointWorkspace(transcript.scenario);
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* Effect.acquireRelease(
          fs.makeTempDirectory({ prefix: "t3-orchestration-v2-claude-recovery-" }),
          (directory) => fs.remove(directory, { recursive: true, force: true }).pipe(Effect.orDie),
        );
        const materialized = yield* materializeFixtureInput({
          scenario: transcript.scenario,
          fixtureInput: {
            steps: [
              { type: "message", text: launchPrompt },
              { type: "message", text: resumePrompt },
            ],
          },
          driver: ProviderDriverKind.make("claudeAgent"),
          modelSelection: CLAUDE_MODEL_SELECTION,
        });
        const { phase1Commands, phase1Steps, phase2Commands, phase2Steps } =
          splitAfterFirstIdle(materialized);
        const { harness, assertComplete } = makeClaudeRestartReplayHarness(transcript);
        const options = {
          databaseLayer: SqlitePersistence.layerFromPath(path.join(tempDir, "state.sqlite")).pipe(
            Layer.provide(NodeServices.layer),
          ),
        };

        yield* Effect.scoped(
          runOrchestratorV2ProviderReplayScenario(
            {
              name: `${transcript.scenario}:first-runtime`,
              transcript,
              commands: phase1Commands,
              steps: phase1Steps,
              projectionThreadIds: materialized.projectionThreadIds,
              runtimePolicyOverride: { cwd: workspace },
            },
            harness,
            options,
          ),
        );
        const result = yield* Effect.scoped(
          runOrchestratorV2ProviderReplayScenario(
            {
              name: `${transcript.scenario}:second-runtime`,
              transcript,
              commands: phase2Commands,
              steps: phase2Steps,
              projectionThreadIds: materialized.projectionThreadIds,
              runtimePolicyOverride: { cwd: workspace },
            },
            harness,
            options,
          ),
        );
        yield* assertComplete;

        const projection = projectionFor(result, transcript.scenario);
        assertSemanticProjectionIntegrity(projection);
        assert.lengthOf(projection.subagents, 1);
        const subagent = projection.subagents[0];
        assert.equal(subagent?.status, "completed");
        const childThreads = [...result.projections.values()].filter(
          (candidate) => candidate.thread.lineage.parentThreadId === projection.thread.id,
        );
        assert.lengthOf(childThreads, 1);
        const child = childThreads[0];
        assert.equal(child?.thread.id, subagent?.childThreadId);
        assert.deepEqual(child?.thread.modelSelection, {
          instanceId: CLAUDE_MODEL_SELECTION.instanceId,
          model: "claude-sonnet-5",
          options: [{ id: "effort", value: "high" }],
        });

        const conversation = (child?.turnItems ?? [])
          .toSorted((left, right) => left.ordinal - right.ordinal)
          .flatMap((item) =>
            item.type === "user_message" || item.type === "assistant_message"
              ? [`${item.type === "user_message" ? "user" : "assistant"}:${item.text}`]
              : [],
          );
        const launchTask = conversation[0];
        assert.deepEqual(
          conversation.map((entry) => entry.slice(0, entry.indexOf(":"))),
          ["user", "assistant", "user", "assistant"],
        );
        assert.include(launchTask, "Your job is just the file");
        assert.include(conversation[1], "is 1 line long");
        assert.include(conversation[2], "Look again at");
        assert.include(conversation[3], "Bug/edge case found and fixed");
        const childCommands = (child?.turnItems ?? []).filter(
          (item) => item.type === "command_execution",
        );
        assert.lengthOf(childCommands, 3);
        assert.isFalse(
          projection.turnItems.some(
            (item) =>
              item.type === "assistant_message" && item.text.includes("Bug/edge case found"),
          ),
          "the resumed subagent's reply leaked into the parent thread",
        );
      }).pipe(
        provideDeterministicTestRuntime,
        Effect.provide(Layer.merge(IdAllocator.layer, NodeServices.layer)),
      ),
    ),
  );
  it.effect("reopens the thread of a Claude subagent the restart cancelled when resumed", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const transcript = yield* readClaudeCancelledSubagentResumeTranscript();
        const [launchPrompt, resumePrompt] = yield* decodePromptPair(transcript.metadata?.prompts);
        const workspace = yield* checkpointWorkspace(transcript.scenario);
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempDir = yield* Effect.acquireRelease(
          fs.makeTempDirectory({ prefix: "t3-orchestration-v2-claude-recovery-" }),
          (directory) => fs.remove(directory, { recursive: true, force: true }).pipe(Effect.orDie),
        );
        const materialized = yield* materializeFixtureInput({
          scenario: transcript.scenario,
          fixtureInput: {
            steps: [
              { type: "message", text: launchPrompt },
              { type: "message", text: resumePrompt },
            ],
          },
          driver: ProviderDriverKind.make("claudeAgent"),
          modelSelection: CLAUDE_MODEL_SELECTION,
        });
        const { phase1Commands, phase1Steps, phase2Commands, phase2Steps } =
          splitAfterFirstIdle(materialized);
        const { harness, assertComplete } = makeClaudeRestartReplayHarness(transcript);
        const options = {
          databaseLayer: SqlitePersistence.layerFromPath(path.join(tempDir, "state.sqlite")).pipe(
            Layer.provide(NodeServices.layer),
          ),
        };
        const childThreadOf = (result: OrchestratorV2ScenarioResult, parentThreadId: ThreadId) =>
          [...result.projections.values()].find(
            (candidate) => candidate.thread.lineage.parentThreadId === parentThreadId,
          );
        const childRootStatus = (child: OrchestrationV2ThreadProjection | undefined) =>
          child?.nodes.find((node) => node.kind === "root_turn" && node.runId === null)?.status;

        const snapshotPath = path.join(tempDir, "restart-state.sqlite");
        const beforeScenario = {
          name: `${transcript.scenario}:cancelled-first-runtime`,
          transcript,
          commands: phase1Commands,
          steps: phase1Steps,
          projectionThreadIds: materialized.projectionThreadIds,
          runtimePolicyOverride: { cwd: workspace },
        };
        const before = yield* Effect.scoped(
          Effect.gen(function* () {
            const result = yield* runOrchestratorV2Scenario(beforeScenario);
            const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
            yield* worker.drain();
            // Preserve the orphan before scoped teardown settles its provider work.
            const sql = yield* SqlClient.SqlClient;
            yield* sql`VACUUM INTO ${snapshotPath}`;
            return result;
          }).pipe(
            Effect.provide(
              Layer.merge(
                layerProviderReplay(beforeScenario, harness, options),
                options.databaseLayer,
              ),
            ),
          ),
        );
        const settled = projectionFor(before, transcript.scenario);
        assert.equal(settled.subagents[0]?.status, "running");
        assert.equal(childRootStatus(childThreadOf(before, settled.thread.id)), "running");

        // The server restarts with the subagent still working. No automatic
        // continuation: the user's next message resumes it.
        const result = yield* Effect.scoped(
          runOrchestratorV2ProviderReplayScenario(
            {
              name: `${transcript.scenario}:cancelled-second-runtime`,
              transcript,
              commands: phase2Commands,
              steps: phase2Steps,
              projectionThreadIds: materialized.projectionThreadIds,
              runtimePolicyOverride: { cwd: workspace },
            },
            harness,
            {
              databaseLayer: SqlitePersistence.layerFromPath(snapshotPath).pipe(
                Layer.provide(NodeServices.layer),
              ),
              recoverOnStartup: true,
              continueThreadsAfterServerUpdate: false,
            },
          ),
        );
        yield* assertComplete;

        const projection = projectionFor(result, transcript.scenario);
        assertSemanticProjectionIntegrity(projection);
        assert.equal(projection.subagents[0]?.status, "completed");
        const child = childThreadOf(result, projection.thread.id);
        assert.equal(child?.thread.id, projection.subagents[0]?.childThreadId);
        // Recovery cancelled the child's work; the resume reopened and ended it.
        assert.equal(childRootStatus(child), "completed");
        const conversation = (child?.turnItems ?? [])
          .toSorted((left, right) => left.ordinal - right.ordinal)
          .flatMap((item) =>
            item.type === "user_message" || item.type === "assistant_message"
              ? [`${item.type === "user_message" ? "user" : "assistant"}:${item.text}`]
              : [],
          );
        assert.deepEqual(
          conversation.map((entry) => entry.slice(0, entry.indexOf(":"))),
          ["user", "user", "assistant"],
        );
        assert.include(conversation[0], "Your job is just the file");
        assert.include(conversation[1], "Look again at");
        assert.include(conversation[2], "Bug/edge case found and fixed");
        assert.lengthOf(
          (child?.turnItems ?? []).filter((item) => item.type === "command_execution"),
          2,
        );
      }).pipe(
        provideDeterministicTestRuntime,
        Effect.provide(Layer.merge(IdAllocator.layer, NodeServices.layer)),
      ),
    ),
  );
});
