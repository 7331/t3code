import type { OrchestrationV2Run, OrchestrationV2StoredEvent } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
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
// How a run can end. `rolled_back` is left out (see below). Declared here rather than taken from
// ThreadManagementService, which imports back into EventSink.
const OUTCOMES: ReadonlySet<OrchestrationV2Run["status"]> = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

/**
 * Records each run once, when a committed event first shows it finished. A finished run's row is
 * updated again later (its checkpoint, a settlement), so the runs already counted are remembered.
 * A rollback is not how a run ended: it rewrites runs that already finished, stamping the rollback
 * time as their completion, so it would count them again with a duration that runs to the
 * rollback.
 */
export const makeRunOutcomeRecorder = () => {
  const counted = new Set<string>();
  // Untraced: it runs for every committed batch inside the EventSink publish step, whose
  // operation already owns the span.
  return Effect.fnUntraced(function* (events: ReadonlyArray<OrchestrationV2StoredEvent>) {
    for (const { event } of events) {
      if (event.type !== "run.updated") continue;
      const run = event.payload;
      if (!OUTCOMES.has(run.status) || counted.has(run.id)) continue;
      counted.add(run.id);
      if (counted.size > REMEMBERED_RUNS) {
        const oldest = counted.values().next();
        if (!oldest.done) counted.delete(oldest.value);
      }
      const attributes = metricAttributes({
        provider: run.providerInstanceId,
        modelFamily: normalizeModelMetricLabel(run.modelSelection.model),
        outcome: run.status,
        delegated: run.delegatedTaskId !== undefined,
      });
      yield* Metric.update(Metric.withAttributes(runsTotal, attributes), 1);
      if (run.startedAt === null) continue;
      yield* Metric.update(
        Metric.withAttributes(runQueueWait, attributes),
        Duration.millis(
          DateTime.toEpochMillis(run.startedAt) - DateTime.toEpochMillis(run.requestedAt),
        ),
      );
      if (run.completedAt !== null) {
        yield* Metric.update(
          Metric.withAttributes(runDuration, attributes),
          Duration.millis(
            DateTime.toEpochMillis(run.completedAt) - DateTime.toEpochMillis(run.startedAt),
          ),
        );
      }
    }
  });
};
