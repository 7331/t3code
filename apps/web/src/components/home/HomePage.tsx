import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";

import { isElectron } from "../../env";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useClientSettings } from "../../hooks/useSettings";
import { useThreadActions } from "../../hooks/useThreadActions";
import { cn } from "~/lib/utils";
import {
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useServerConfigs,
  useThreadShells,
} from "../../state/entities";
import { NoProjectsHero } from "../NoProjectsHero";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { HomeThreadCard } from "./HomeThreadCard";
import { selectHomeThreads } from "./homeThreads.logic";

const COLLAPSED_CARDS_STORAGE_KEY = "t3code:home:collapsed-threads";
const CollapsedCardKeys = Schema.Array(Schema.String);
const NO_COLLAPSED_CARDS: ReadonlyArray<string> = [];

/** Several threads across projects at once, each readable and repliable without switching to it. */
export function HomePage() {
  const threads = useThreadShells();
  const projects = useProjects();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const sortOrder = useClientSettings((settings) => settings.sidebarThreadSortOrder);
  const serverConfigs = useServerConfigs();
  const { pinThread, unpinThread } = useThreadActions();
  const [collapsedKeys, setCollapsedKeys] = useLocalStorage(
    COLLAPSED_CARDS_STORAGE_KEY,
    NO_COLLAPSED_CARDS,
    CollapsedCardKeys,
  );

  if (bootstrapped && projects.length === 0) return <NoProjectsHero />;

  const selection = selectHomeThreads(threads, sortOrder);

  const togglePin = async (thread: EnvironmentThreadShell) => {
    const ref = scopeThreadRef(thread.environmentId, thread.id);
    // Unpinning raises the sidebar's undo notice, so a card never leaves Home without a way back.
    const result = thread.pinnedAt === null ? await pinThread(ref) : await unpinThread(ref);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title: thread.pinnedAt === null ? "Couldn’t pin thread" : "Couldn’t unpin thread",
      });
    }
  };

  const toggleCollapsed = (key: string) =>
    setCollapsedKeys((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <WorkspaceBreadcrumb ariaLabel="Home">
            <WorkspaceBreadcrumbItem current>
              <h1 className="truncate">Home</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
        </WorkspacePageHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
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
                <div className="mb-4 flex flex-col gap-0.5">
                  <h2 className="text-sm font-medium">
                    {selection.source === "pinned" ? "Pinned threads" : "Recent threads"}
                  </h2>
                  {selection.source === "recent" ? (
                    <p className="text-xs text-muted-foreground">
                      Nothing is pinned, so this shows each project’s latest thread. Pin threads to
                      choose what stays here.
                    </p>
                  ) : null}
                </div>
                <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
                  {selection.threads.map((thread, index) => {
                    const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
                    const canPin =
                      serverConfigs.get(thread.environmentId)?.environment.capabilities
                        .threadPinning === true;
                    return (
                      <div key={key} className={cn("min-w-0", index === 0 && "lg:col-span-2")}>
                        <HomeThreadCard
                          thread={thread}
                          collapsed={collapsedKeys.includes(key)}
                          onToggleCollapsed={() => toggleCollapsed(key)}
                          pin={
                            canPin
                              ? {
                                  pinned: thread.pinnedAt !== null,
                                  toggle: () => void togglePin(thread),
                                }
                              : null
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}
