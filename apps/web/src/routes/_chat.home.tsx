import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { HomePage } from "../components/home/HomePage";
import { SubagentBoardPage } from "../components/home/SubagentBoardPage";

interface HomeSearch {
  /** Both set: show that thread's subagents board instead of Home's pinned threads. */
  readonly parentEnvironmentId?: EnvironmentId;
  readonly parentThreadId?: ThreadId;
}

function HomeRouteView() {
  const { parentEnvironmentId, parentThreadId } = Route.useSearch();
  if (parentEnvironmentId === undefined || parentThreadId === undefined) return <HomePage />;
  const parentRef = scopeThreadRef(parentEnvironmentId, parentThreadId);
  // Keyed so card scroll positions don't carry from one board to the next.
  return (
    <SubagentBoardPage key={`${parentEnvironmentId}:${parentThreadId}`} parentRef={parentRef} />
  );
}

export const Route = createFileRoute("/_chat/home")({
  validateSearch: (raw: Record<string, unknown>): HomeSearch =>
    typeof raw.parentEnvironmentId === "string" &&
    raw.parentEnvironmentId &&
    typeof raw.parentThreadId === "string" &&
    raw.parentThreadId
      ? {
          parentEnvironmentId: EnvironmentId.make(raw.parentEnvironmentId),
          parentThreadId: ThreadId.make(raw.parentThreadId),
        }
      : {},
  component: HomeRouteView,
});
