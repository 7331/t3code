import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";

import { useClientSettings } from "../../hooks/useSettings";
import {
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useQuietThreadShells,
} from "../../state/entities";
import { NoProjectsHero } from "../NoProjectsHero";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import {
  HomeCardGrid,
  HomePageShell,
  HomeSectionHeading,
  useCollapsedHomeCards,
} from "./HomeLayout";
import { HomeThreadCard } from "./HomeThreadCard";
import { selectHomeThreads } from "./homeThreads.logic";
import { useHomeCardActions } from "./useHomeCardActions";

/** Several threads across projects at once, each readable and repliable without switching to it. */
export function HomePage() {
  // Quiet shells hold still through streaming ticks; cards read live output from their own atoms.
  const threads = useQuietThreadShells();
  const projects = useProjects();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const sortOrder = useClientSettings((settings) => settings.sidebarThreadSortOrder);
  const cardActions = useHomeCardActions();
  const collapsed = useCollapsedHomeCards();

  if (bootstrapped && projects.length === 0) return <NoProjectsHero />;

  const selection = selectHomeThreads(threads, sortOrder);

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
                ? "Nothing is pinned, so this shows the latest thread with messages in each project. Pin threads to choose what stays here."
                : null
            }
          />
          <HomeCardGrid
            cards={selection.threads.map((thread) => {
              const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
              const actions = cardActions(thread);
              return {
                key,
                card: (
                  <HomeThreadCard
                    thread={thread}
                    collapsed={collapsed.isCollapsed(key)}
                    onToggleCollapsed={() => collapsed.toggle(key)}
                    pin={actions.pin}
                    settle={actions.settle}
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
