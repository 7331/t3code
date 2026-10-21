import type { OrchestrationV2Run, OrchestrationV2StoredEvent, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";

import { normalizeModelMetricLabel } from "../observability/Attributes.ts";
import {
  metricAttributes,
  runDuration,
  runQueueWait,
  runsTotal,
} from "../observability/Metrics.ts";

const REMEMBERED_RUNS = 4096;
// A rollback rewrites runs that already finished, stamping the rollback time as their completion,
// so it is not counted as an outcome. Declared here because ThreadManagementService imports
// EventSink.
const OUTCOMES: ReadonlySet<OrchestrationV2Run["status"]> = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

/**
 * Records each run once, when a committed event first shows it finished. A finished run's row is
 * updated again later (its checkpoint, a settlement), so recently counted runs are remembered.
 *
 * A run carries `delegatedTaskId` only when a follow-up is associated with a task, so a subagent
 * thread's first run is recognized by its thread's lineage instead. A failed lookup only costs the
 * label: the events are already committed and must still publish.
 */
export const makeRunOutcomeRecorder = <E>(
  isSubagentThread: (threadId: ThreadId) => Effect.Effect<boolean, E>,
) => {
  const counted = new Set<string>();
  // Untraced: it runs for every committed batch inside the EventSink operation's span.
  // Uninterruptible so a run is never marked counted with only part of its measurements.
  return Effect.fnUntraced(function* (events: ReadonlyArray<OrchestrationV2StoredEvent>) {
    for (const { event } of events) {
      if (event.type !== "run.updated") continue;
      const run = event.payload;
      if (!OUTCOMES.has(run.status) || counted.has(run.id)) continue;
      counted.add(run.id);
      if (counted.size > REMEMBERED_RUNS) counted.delete(counted.values().next().value!);
      const delegated =
        run.delegatedTaskId !== undefined ||
        (yield* isSubagentThread(run.threadId).pipe(Effect.orElseSucceed(() => false)));
      const attributes = metricAttributes({
        provider: run.providerInstanceId,
        modelFamily: normalizeModelMetricLabel(run.modelSelection.model),
        outcome: run.status,
        delegated,
      });
      yield* Metric.update(Metric.withAttributes(runsTotal, attributes), 1);
      if (run.startedAt === null) continue;
      yield* Metric.update(
        Metric.withAttributes(runQueueWait, attributes),
        DateTime.distance(run.requestedAt, run.startedAt),
      );
      if (run.completedAt !== null) {
        yield* Metric.update(
          Metric.withAttributes(runDuration, attributes),
          DateTime.distance(run.startedAt, run.completedAt),
        );
      }
    }
  }, Effect.uninterruptible);
};
