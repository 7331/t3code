import { useNavigation } from "@react-navigation/native";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { cn } from "../../../lib/cn";
import { scopedProjectKey, scopedThreadKey } from "../../../lib/scopedEntities";
import { useMobileProjectGroupingSettings } from "../../../state/project-grouping";
import { buildHomeProjectScopes } from "../../home/homeThreadList";
import { SymbolView } from "../../../components/ui/AppSymbol";
import { AppText } from "../../../components/ui/AppText";
import { Button } from "../../../components/ui/Button";
import { useContentTopInset } from "../../../components/ui/useBarInset";
import { openSettings } from "../../settings/settings-navigation";
import { HomeRouteScreen } from "../../home/HomeRouteScreen";
import {
  NAVIGATION_TAB_ICONS,
  WORKSPACE_TAB_LABELS,
  useEnabledNavigationTabs,
} from "../../layout/workspace/navigation-tabs";
import { useSelectWorkspaceDetail } from "../../layout/workspace/useSelectWorkspaceDetail";
import { useSelectWorkspaceTab } from "../../layout/workspace/useSelectWorkspaceTab";
import { useAdaptiveWorkspaceLayout } from "../../layout/adaptive-workspace-context";
import { useWorkspaceTabs } from "../../layout/workspace/WorkspaceTabsContext";
import { resolveThreadListV2Status, type ThreadListV2Status } from "../../threads/threadListV2";
import { useProjects } from "../../../state/entities";
import { steadyNavigationThreadShellsAtom } from "../../../state/threads";
import { useLaunchingThreads } from "../../../state/use-pending-new-tasks";
import { useWorkspaceState } from "../../../state/workspace";
import { useAtomValueWhileVisible, useHomeRouteVisible } from "../../home/home-route-visibility";
import { AmbientSkyBackdrop, AmbientSkyClear } from "../sky/AmbientSky";

/** Statuses that mean the agent is waiting on work or on the user. */
const ACTIVE_STATUSES = new Set(["working", "approval", "input", "request"]);

const STATUS_SUMMARY: Partial<Record<ThreadListV2Status, { label: string; dotClassName: string }>> =
  {
    working: { label: "Working", dotClassName: "bg-primary" },
    approval: { label: "Needs approval", dotClassName: "bg-warning" },
    input: { label: "Needs input", dotClassName: "bg-warning" },
    request: { label: "Wants you", dotClassName: "bg-warning" },
  } as const;

export function PortalHomeDashboard() {
  const workspace = useWorkspaceTabs();
  const query = workspace?.state.tabs.threads.query ?? "";
  // The header search takes over the pane: the real list renders with the results.
  if (query.trim().length > 0) return <HomeRouteScreen />;
  return <PortalDashboardContent />;
}

function PortalDashboardContent() {
  const navigation = useNavigation();
  const workspace = useWorkspaceTabs();
  const { startNewTask } = useAdaptiveWorkspaceLayout();
  const selectTab = useSelectWorkspaceTab();
  const selectDetail = useSelectWorkspaceDetail();
  const insets = useSafeAreaInsets();
  const contentTopInset = useContentTopInset();
  const visible = useHomeRouteVisible();
  const threads = useLaunchingThreads(
    useAtomValueWhileVisible(steadyNavigationThreadShellsAtom, visible),
  );
  const projects = useProjects();
  const { state: catalogState } = useWorkspaceState();
  const enabled = useEnabledNavigationTabs();

  const { sidebarProjectGroupingMode } = useMobileProjectGroupingSettings();
  // Projects group like the sidebar: a repository's worktrees and folders under one title.
  const projectGroupByKey = new Map(
    buildHomeProjectScopes({
      projects,
      environmentId: null,
      projectGroupingMode: sidebarProjectGroupingMode,
    }).flatMap((scope) =>
      scope.projectRefs.map(
        (ref) => [scopedProjectKey(ref.environmentId, ref.projectId), scope] as const,
      ),
    ),
  );
  const projectGroupOf = (thread: EnvironmentThreadShell) =>
    projectGroupByKey.get(scopedProjectKey(thread.environmentId, thread.projectId));
  const projectTitleOf = (thread: EnvironmentThreadShell) => projectGroupOf(thread)?.title;
  const isActive = (thread: EnvironmentThreadShell) =>
    ACTIVE_STATUSES.has(resolveThreadListV2Status(thread));
  const working = threads
    .filter((thread) => thread.archivedAt === null && isActive(thread))
    .slice(0, 4);
  // Recent threads group under their project, the most recently touched project first.
  const recentByProject = new Map<string, EnvironmentThreadShell[]>();
  for (const thread of threads
    .filter((candidate) => candidate.archivedAt === null && !isActive(candidate))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 6)) {
    const key =
      projectGroupOf(thread)?.key ?? scopedProjectKey(thread.environmentId, thread.projectId);
    const group = recentByProject.get(key);
    if (group === undefined) recentByProject.set(key, [thread]);
    else group.push(thread);
  }
  const recentGroups = [...recentByProject.entries()].slice(0, 3);
  const openThread = (thread: EnvironmentThreadShell) =>
    selectDetail({
      name: "Thread",
      params: { environmentId: String(thread.environmentId), threadId: String(thread.id) },
    });
  const destinations = enabled
    .filter((tab) => tab !== "threads")
    .map((tab) => ({
      key: tab,
      icon: NAVIGATION_TAB_ICONS[tab],
      label: WORKSPACE_TAB_LABELS[tab],
      onPress: () => selectTab(tab),
    }));

  return (
    <AmbientSkyBackdrop>
      <ScrollView
        contentContainerStyle={{
          paddingBottom: (workspace?.bottomClearance ?? Math.max(insets.bottom, 24)) + 24,
          paddingHorizontal: 24,
          paddingTop: contentTopInset + 32,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="mx-auto w-full max-w-[430px]">
          <AmbientSkyClear>
            <View className="gap-7">
              {catalogState.hasConnections ? (
                <Button
                  fullWidth
                  icon="plus"
                  label="New task"
                  tone="primary"
                  onPress={startNewTask}
                />
              ) : (
                <View className="gap-3">
                  <AppText textRole="footnote" className="text-foreground-secondary">
                    Connect an environment to start coding sessions.
                  </AppText>
                  <Button
                    fullWidth
                    icon="plus"
                    label="Add environment"
                    tone="primary"
                    onPress={() => openSettings(navigation, "SettingsEnvironmentNew")}
                  />
                </View>
              )}
              {working.length > 0 ? (
                <DashboardSection title="Working now">
                  {working.map((thread, index) => {
                    const status = resolveThreadListV2Status(thread);
                    return (
                      <ThreadRow
                        key={scopedThreadKey(thread.environmentId, thread.id)}
                        isFirst={index === 0}
                        thread={thread}
                        projectTitle={projectTitleOf(thread)}
                        dotClassName={STATUS_SUMMARY[status]?.dotClassName ?? "bg-primary"}
                        statusLabel={STATUS_SUMMARY[status]?.label}
                        onPress={() => openThread(thread)}
                      />
                    );
                  })}
                </DashboardSection>
              ) : null}
              {recentGroups.map(([projectKey, group]) => (
                <DashboardSection
                  key={projectKey}
                  title={projectTitleOf(group[0]!) ?? "No project"}
                >
                  {group.map((thread, index) => (
                    <ThreadRow
                      key={scopedThreadKey(thread.environmentId, thread.id)}
                      isFirst={index === 0}
                      thread={thread}
                      onPress={() => openThread(thread)}
                    />
                  ))}
                </DashboardSection>
              ))}
              {destinations.length > 0 ? (
                <DashboardSection title="Browse">
                  {destinations.map((destination, index) => (
                    <Pressable
                      key={destination.key}
                      accessibilityRole="button"
                      accessibilityLabel={destination.label}
                      className="min-h-12.5 flex-row items-center gap-3 px-4 active:bg-row-hover"
                      onPress={destination.onPress}
                    >
                      {index > 0 ? <RowSeparator /> : null}
                      <SymbolView
                        name={destination.icon}
                        size={20}
                        tintColorClassName="accent-icon"
                      />
                      <AppText className="min-w-0 flex-1 font-t3-medium text-[15px] text-foreground">
                        {destination.label}
                      </AppText>
                      <SymbolView
                        name="chevron.right"
                        size={13}
                        tintColorClassName="accent-chevron"
                      />
                    </Pressable>
                  ))}
                </DashboardSection>
              ) : null}
            </View>
          </AmbientSkyClear>
        </View>
      </ScrollView>
    </AmbientSkyBackdrop>
  );
}

function DashboardSection(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <View className="gap-1.5">
      <AppText textRole="label" className="px-4 text-foreground-secondary">
        {props.title}
      </AppText>
      <View className="overflow-hidden rounded-2xl bg-grouped-card">{props.children}</View>
    </View>
  );
}

function RowSeparator() {
  return (
    <View
      pointerEvents="none"
      className="absolute left-4 right-0 top-0 bg-separator"
      style={{ height: StyleSheet.hairlineWidth }}
    />
  );
}

function ThreadRow(props: {
  readonly thread: EnvironmentThreadShell;
  readonly isFirst: boolean;
  /** Left out where the section already names the project. */
  readonly projectTitle?: string | undefined;
  readonly dotClassName?: string;
  readonly statusLabel?: string;
  readonly onPress: () => void;
}) {
  const title = props.thread.title || "Untitled task";
  const detail = [props.statusLabel, props.projectTitle].filter(Boolean).join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, detail].filter(Boolean).join(", ")}
      className="min-h-12.5 flex-row items-center gap-3 px-4 py-2 active:bg-row-hover"
      onPress={props.onPress}
    >
      {props.isFirst ? null : <RowSeparator />}
      {props.dotClassName ? (
        <View className={cn("h-2 w-2 rounded-full", props.dotClassName)} />
      ) : null}
      <View className="min-w-0 flex-1">
        <AppText className="font-t3-medium text-[15px] text-foreground" numberOfLines={1}>
          {title}
        </AppText>
        {detail ? (
          <AppText textRole="label" className="text-foreground-secondary" numberOfLines={1}>
            {detail}
          </AppText>
        ) : null}
      </View>
      <SymbolView name="chevron.right" size={13} tintColorClassName="accent-chevron" />
    </Pressable>
  );
}
