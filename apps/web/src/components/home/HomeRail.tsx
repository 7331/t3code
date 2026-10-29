import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { SidebarThreadSortOrder } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import {
  hasUnseenCompletion,
  resolveSidebarRowStatus,
  resolveSidebarThreadStatus,
  resolveThreadLastVisitedAt,
} from "../Sidebar.logic";
import { buildThreadRouteParams } from "../../threadRoutes";
import { SidebarRowStatusIconView } from "../sidebar/SidebarRowStatusIcon";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { selectHomeRailThreads } from "./homeThreads.logic";

function railThreadTitle(thread: EnvironmentThreadShell): string {
  return thread.title.length > 0 ? thread.title : "Untitled";
}

function HomeRailRow({ thread }: { readonly thread: EnvironmentThreadShell }) {
  const status = resolveSidebarRowStatus({
    status: resolveSidebarThreadStatus(thread),
    goalActive: thread.goal?.status === "active",
    // Snooze wake-ups ("Woke") stay a sidebar affordance, as on Home's cards.
    isWoke: false,
    isUnread: hasUnseenCompletion({
      ...thread,
      lastVisitedAt: resolveThreadLastVisitedAt(thread.lastVisitedAt, undefined),
    }),
  });
  const title = railThreadTitle(thread);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            to="/$environmentId/$threadId"
            params={buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id))}
            className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-xs outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring hover:bg-accent/50"
          />
        }
      >
        {status ? (
          <SidebarRowStatusIconView
            icon={status.icon}
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        ) : null}
        <span className="truncate">{title}</span>
      </TooltipTrigger>
      <TooltipPopup side="right">{title}</TooltipPopup>
    </Tooltip>
  );
}

function HomeRailSection({
  label,
  threads,
}: {
  readonly label: string;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
}) {
  return (
    <section aria-label={label} className="flex min-h-0 flex-col gap-0.5">
      <h2 className="px-1.5 pb-1 text-3xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </h2>
      {threads.map((thread) => (
        <HomeRailRow key={`${thread.environmentId}:${thread.id}`} thread={thread} />
      ))}
    </section>
  );
}

/**
 * The narrow list beside Home's cards: pinned threads in pin order, then one
 * fresh thread per project. The main sidebar stays the full thread index; the
 * rail only echoes what Home already selects.
 */
export function HomeRail({
  threads,
  sortOrder,
  delegatedUnderParent,
  className,
}: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly sortOrder: SidebarThreadSortOrder;
  readonly delegatedUnderParent: ReadonlySet<string>;
  readonly className?: string | undefined;
}) {
  const { handleNewThread } = useHandleNewThread();
  const navigate = useNavigate();
  const selection = selectHomeRailThreads(threads, sortOrder, delegatedUnderParent);
  // Home has no active thread, so a new thread lands in the project the rail
  // is already pointing at: the freshest one with messages, else the newest pin.
  const newThreadProjectThread = selection.recent[0] ?? selection.pinned[0] ?? null;
  return (
    <nav
      aria-label="Home quick access"
      className={cn("flex w-44 shrink-0 flex-col gap-3 pr-4", className)}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label="New thread"
              size="sm"
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                if (newThreadProjectThread) {
                  void handleNewThread(
                    scopeProjectRef(
                      newThreadProjectThread.environmentId,
                      newThreadProjectThread.projectId,
                    ),
                  );
                  return;
                }
                void navigate({ to: "/" });
              }}
            />
          }
        >
          <PlusIcon className="size-3.5" aria-hidden="true" />
          New thread
        </TooltipTrigger>
        <TooltipPopup side="right">
          {newThreadProjectThread
            ? `New thread in ${railThreadTitle(newThreadProjectThread)}'s project`
            : "New thread"}
        </TooltipPopup>
      </Tooltip>
      {selection.pinned.length > 0 ? (
        <HomeRailSection label="Pinned" threads={selection.pinned} />
      ) : null}
      {selection.recent.length > 0 ? (
        <HomeRailSection label="Recent" threads={selection.recent} />
      ) : null}
      {selection.pinned.length === 0 && selection.recent.length === 0 ? (
        <p className="px-1.5 text-xs text-muted-foreground">
          Pin or open threads to fill the rail.
        </p>
      ) : null}
    </nav>
  );
}
