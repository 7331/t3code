import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";

import { useClientSettings } from "../../hooks/useSettings";
import { useThreadActions } from "../../hooks/useThreadActions";
import {
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useServerConfigs,
  useThreadShells,
} from "../../state/entities";
import { NoProjectsHero } from "../NoProjectsHero";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { toastManager } from "../ui/toast";
import { WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import {
  HomeCardGrid,
  HomePageShell,
  HomeSectionHeading,
  useCollapsedHomeCards,
} from "./HomeLayout";
import { HomeThreadCard } from "./HomeThreadCard";
import { selectHomeThreads } from "./homeThreads.logic";

/** Several threads across projects at once, each readable and repliable without switching to it. */
export function HomePage() {
  const threads = useThreadShells();
  const projects = useProjects();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const sortOrder = useClientSettings((settings) => settings.sidebarThreadSortOrder);
  const serverConfigs = useServerConfigs();
  const { pinThread, confirmAndUnpinThread, settleThread, unsettleThread } = useThreadActions();
  const collapsed = useCollapsedHomeCards();

  if (bootstrapped && projects.length === 0) return <NoProjectsHero />;

  const selection = selectHomeThreads(threads, sortOrder);

  const togglePin = async (thread: EnvironmentThreadShell) => {
    const ref = scopeThreadRef(thread.environmentId, thread.id);
    // Unpinning raises the sidebar's undo notice, so a card never leaves Home without a way back.
    const result =
      thread.pinnedAt === null ? await pinThread(ref) : await confirmAndUnpinThread(ref);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title: thread.pinnedAt === null ? "Couldn’t pin thread" : "Couldn’t unpin thread",
      });
    }
  };

  const toggleSettled = async (thread: EnvironmentThreadShell) => {
    const ref = scopeThreadRef(thread.environmentId, thread.id);
    const settled = thread.settledOverride === "settled";
    // Both raise the sidebar's undo notice, as settling from the sidebar does.
    const result = settled ? await unsettleThread(ref) : await settleThread(ref);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title: settled ? "Couldn’t unsettle thread" : "Couldn’t settle thread",
      });
    }
  };

  return (
    <HomePageShell
      breadcrumbLabel="Home"
      breadcrumb={
        <WorkspaceBreadcrumbItem current>
          <h1 className="truncate">Home</h1>
        </WorkspaceBreadcrumbItem>
      }
    >
      {selection.threads.length === 0 ? (
        bootstrapped ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No threads yet</EmptyTitle>
              <EmptyDescription>
                Start a thread in any project and it shows up here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null
      ) : (
        <>
          <HomeSectionHeading
            title={selection.source === "pinned" ? "Pinned threads" : "Recent threads"}
            description={
              selection.source === "recent"
                ? "Nothing is pinned, so this shows each project’s latest thread. Pin threads to choose what stays here."
                : null
            }
          />
          <HomeCardGrid
            cards={selection.threads.map((thread) => {
              const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
              const capabilities = serverConfigs.get(thread.environmentId)?.environment
                .capabilities;
              return {
                key,
                card: (
                  <HomeThreadCard
                    thread={thread}
                    collapsed={collapsed.isCollapsed(key)}
                    onToggleCollapsed={() => collapsed.toggle(key)}
                    pin={
                      capabilities?.threadPinning === true
                        ? { active: thread.pinnedAt !== null, toggle: () => void togglePin(thread) }
                        : null
                    }
                    settle={
                      capabilities?.threadSettlement === true
                        ? {
                            active: thread.settledOverride === "settled",
                            toggle: () => void toggleSettled(thread),
                          }
                        : null
                    }
                  />
                ),
              };
            })}
          />
        </>
      )}
    </HomePageShell>
  );
}
