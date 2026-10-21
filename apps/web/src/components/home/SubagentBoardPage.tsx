import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { deriveThreadRelationshipGraph } from "@t3tools/client-runtime/state/thread-relationships";
import { isProviderNativeSubagentThread, type ScopedThreadRef } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import {
  useThreadProjection,
  useThreadRelationshipShells,
  useThreadShells,
} from "../../state/entities";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { WorkspaceBreadcrumbItem, WorkspaceBreadcrumbSeparator } from "../WorkspaceBreadcrumb";
import {
  HomeCardGrid,
  HomePageShell,
  HomeSectionHeading,
  useCollapsedHomeCards,
} from "./HomeLayout";
import { HomeThreadCard } from "./HomeThreadCard";
import { selectSubagentBoardChildren, subagentCardTitle } from "./subagentBoard.logic";
import { useHomeCardActions } from "./useHomeCardActions";

/** One thread and its subagents as cards, so a fan-out can be watched and steered in one place. */
export function SubagentBoardPage({ parentRef }: { readonly parentRef: ScopedThreadRef }) {
  const projection = useThreadProjection(parentRef)?.projection ?? null;
  const relationshipShells = useThreadRelationshipShells(parentRef);
  const threads = useThreadShells();
  const collapsed = useCollapsedHomeCards();
  const cardActions = useHomeCardActions();

  const shellsById = new Map(
    threads
      .filter((thread) => thread.environmentId === parentRef.environmentId)
      .map((thread) => [thread.id, thread]),
  );
  const parent = shellsById.get(parentRef.threadId) ?? null;
  const graph = deriveThreadRelationshipGraph({ threads: relationshipShells, projection });
  const board = selectSubagentBoardChildren(graph, parentRef.threadId);
  const children = board.children.flatMap((child) => {
    const thread = shellsById.get(child.threadId);
    return thread === undefined ? [] : [{ ...child, thread }];
  });
  const activeCount = children.filter((child) => child.active).length;
  const parentReadOnly = projection !== null && isProviderNativeSubagentThread(projection.thread);

  // Follow-ups add subagent records for the same child; its first titled record names it.
  const subagentTitles = new Map<string, string>();
  for (const subagent of projection?.subagents ?? []) {
    if (subagent.childThreadId === null || !subagent.title) continue;
    if (!subagentTitles.has(subagent.childThreadId)) {
      subagentTitles.set(subagent.childThreadId, subagent.title);
    }
  }

  const cardFor = (
    thread: NonNullable<typeof parent>,
    role: "parent" | "repliable" | "read-only",
    subagentStatus?: string | null,
  ): { readonly key: string; readonly card: ReactNode } => {
    const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    return {
      key,
      card: (
        <HomeThreadCard
          thread={thread}
          title={
            role === "parent"
              ? thread.title
              : subagentCardTitle(thread.title, subagentTitles.get(thread.id))
          }
          collapsed={collapsed.isCollapsed(key)}
          onToggleCollapsed={() => collapsed.toggle(key)}
          {...cardActions(thread)}
          readOnly={role === "read-only" || (role === "parent" && parentReadOnly)}
          {...(subagentStatus === undefined ? {} : { subagentStatus })}
          replyHint={
            role === "repliable" ? "Replies go to this subagent; its parent sees the result." : null
          }
        />
      ),
    };
  };

  return (
    <HomePageShell
      breadcrumbLabel="Subagents board"
      breadcrumb={
        <>
          <WorkspaceBreadcrumbItem>
            <Link to="/home" className="hover:text-foreground">
              Home
            </Link>
          </WorkspaceBreadcrumbItem>
          <WorkspaceBreadcrumbSeparator />
          {parent ? (
            <>
              <WorkspaceBreadcrumbItem className="min-w-0 shrink">
                <Link
                  to="/$environmentId/$threadId"
                  params={buildThreadRouteParams(parentRef)}
                  className="truncate hover:text-foreground"
                >
                  {parent.title}
                </Link>
              </WorkspaceBreadcrumbItem>
              <WorkspaceBreadcrumbSeparator />
            </>
          ) : null}
          <WorkspaceBreadcrumbItem current>
            <h1 className="truncate">Subagents</h1>
          </WorkspaceBreadcrumbItem>
        </>
      }
    >
      {parent === null ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Thread not found</EmptyTitle>
            <EmptyDescription>It may have been archived or deleted.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <HomeSectionHeading
            title={
              children.length === 0
                ? "No subagents yet"
                : `${children.length + board.hiddenCount} subagents · ${activeCount} active`
            }
            description={
              board.hiddenCount > 0
                ? `Showing active and most recent first. ${board.hiddenCount} more are in the thread’s Lineage panel.`
                : children.some((child) => child.readOnly)
                  ? "Provider-run subagents are read-only; their questions are asked on this thread."
                  : null
            }
          />
          <HomeCardGrid
            cards={[
              cardFor(parent, "parent"),
              ...children.map((child) =>
                cardFor(child.thread, child.readOnly ? "read-only" : "repliable", child.status),
              ),
            ]}
          />
        </>
      )}
    </HomePageShell>
  );
}
