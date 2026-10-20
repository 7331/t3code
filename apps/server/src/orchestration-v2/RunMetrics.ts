import type { OrchestrationV2StoredEvent } from "@t3tools/contracts";
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
import { isTerminalRunStatus } from "./ThreadManagementService.ts";

const REMEMBERED_RUNS = 4096;

/**
 * Records each run once, when a committed event first shows it finished. A finished run's row is
 * updated again later (its checkpoint, a settlement), so the runs already counted are remembered.
 */
export const makeRunOutcomeRecorder = () => {
  const counted = new Set<string>();
  return Effect.fnUntraced(function* (events: ReadonlyArray<OrchestrationV2StoredEvent>) {
    for (const { event } of events) {
      if (event.type !== "run.updated") continue;
      const run = event.payload;
      if (!isTerminalRunStatus(run.status) || counted.has(run.id)) continue;
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
