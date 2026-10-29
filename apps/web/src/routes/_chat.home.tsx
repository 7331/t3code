import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { HomePage } from "../components/home/HomePage";
import { SubagentBoardPage } from "../components/home/SubagentBoardPage";

export interface HomeSearch {
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

/** A usable id, or null for a missing or blank one, which `make` would reject by throwing. */
function searchId(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
}

export const Route = createFileRoute("/_chat/home")({
  // A malformed board link falls back to Home instead of the router's error screen.
  validateSearch: (raw: Record<string, unknown>): HomeSearch => {
    const environmentId = searchId(raw.parentEnvironmentId);
    const threadId = searchId(raw.parentThreadId);
    return environmentId === null || threadId === null
      ? {}
      : {
          parentEnvironmentId: EnvironmentId.make(environmentId),
          parentThreadId: ThreadId.make(threadId),
        };
  },
  component: HomeRouteView,
});
