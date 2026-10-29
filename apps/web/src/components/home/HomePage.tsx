import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";

import {
  useAllEnvironmentShellsBootstrapped,
  useDelegatedUnderParent,
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
  useHomeProviderEntriesByEnvironment,
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
  const delegatedUnderParent = useDelegatedUnderParent();
  const cardActions = useHomeCardActions();
  const collapsed = useCollapsedHomeCards();
  const providerEntriesByEnvironment = useHomeProviderEntriesByEnvironment();

  if (bootstrapped && projects.length === 0) return <NoProjectsHero />;

  const pinnedThreads = selectHomeThreads(threads, delegatedUnderParent);

  return (
    <HomePageShell
      breadcrumbLabel="Home"
      breadcrumb={
        <WorkspaceBreadcrumbItem current>
          <h1 className="truncate">Home</h1>
        </WorkspaceBreadcrumbItem>
      }
    >
      {pinnedThreads.length === 0 ? (
        bootstrapped ? (
          <Empty size="compact">
            <EmptyHeader>
              <EmptyTitle>No pinned threads</EmptyTitle>
              <EmptyDescription>
                Right-click a thread in the sidebar and choose Pin thread.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null
      ) : (
        <>
          <HomeSectionHeading title={`Pinned · ${pinnedThreads.length}`} />
          <HomeCardGrid
            cards={pinnedThreads.map((thread) => {
              const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
              const actions = cardActions(thread);
              return {
                key,
                card: (
                  <HomeThreadCard
                    thread={thread}
                    providerEntry={
                      providerEntriesByEnvironment
                        .get(thread.environmentId)
                        ?.get(thread.modelSelection.instanceId) ?? null
                    }
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
