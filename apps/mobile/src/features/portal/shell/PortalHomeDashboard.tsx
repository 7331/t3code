import { useNavigation } from "@react-navigation/native";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { cn } from "../../../lib/cn";
import { scopedThreadKey } from "../../../lib/scopedEntities";
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
import { useSavedRemoteConnections } from "../../../state/use-remote-environment-registry";
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
  const { savedConnectionsById } = useSavedRemoteConnections();
  const enabled = useEnabledNavigationTabs();

  const connections = Object.values(savedConnectionsById);
  const projectTitleById = new Map(projects.map((project) => [project.id, project.title]));
  const isActive = (thread: EnvironmentThreadShell) =>
    ACTIVE_STATUSES.has(resolveThreadListV2Status(thread));
  const working = threads
    .filter((thread) => thread.archivedAt === null && isActive(thread))
    .slice(0, 4);
  const recent = threads
    .filter((thread) => thread.archivedAt === null && !isActive(thread))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 3);
  const openThread = (thread: EnvironmentThreadShell) =>
    selectDetail({
      name: "Thread",
      params: { environmentId: String(thread.environmentId), threadId: String(thread.id) },
    });
  const subtitle =
    connections.length === 0
      ? "Connect an environment to start coding sessions."
      : connections.length === 1
        ? connections[0]?.environmentLabel
        : `${connections.length} environments`;
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
              <View className="gap-1.5">
                <AppText className="text-3xl font-semibold">T3 Code</AppText>
                <AppText className="text-sm text-foreground-muted">{subtitle}</AppText>
              </View>
              {catalogState.hasConnections ? (
                <Button
                  fullWidth
                  icon="plus"
                  label="New task"
                  tone="primary"
                  onPress={startNewTask}
                />
              ) : (
                <Button
                  fullWidth
                  icon="plus"
                  label="Add environment"
                  tone="primary"
                  onPress={() => openSettings(navigation, "SettingsEnvironmentNew")}
                />
              )}
              {working.length > 0 ? (
                <View className="gap-2">
                  <AppText className="text-2xs font-semibold uppercase tracking-wide text-foreground-muted">
                    Working now
                  </AppText>
                  {working.map((thread) => {
                    const status = resolveThreadListV2Status(thread);
                    return (
                      <ThreadCard
                        key={scopedThreadKey(thread.environmentId, thread.id)}
                        thread={thread}
                        projectTitle={projectTitleById.get(thread.projectId)}
                        dotClassName={STATUS_SUMMARY[status]?.dotClassName ?? "bg-primary"}
                        statusLabel={STATUS_SUMMARY[status]?.label}
                        onPress={() => openThread(thread)}
                      />
                    );
                  })}
                </View>
              ) : null}
              {recent.length > 0 ? (
                <View className="gap-2">
                  <AppText className="text-2xs font-semibold uppercase tracking-wide text-foreground-muted">
                    Recent sessions
                  </AppText>
                  {recent.map((thread) => (
                    <ThreadCard
                      key={scopedThreadKey(thread.environmentId, thread.id)}
                      thread={thread}
                      projectTitle={projectTitleById.get(thread.projectId)}
                      onPress={() => openThread(thread)}
                    />
                  ))}
                </View>
              ) : null}
              {destinations.length > 0 ? (
                <View className="gap-2">
                  <AppText className="text-2xs font-semibold uppercase tracking-wide text-foreground-muted">
                    Browse
                  </AppText>
                  <View className="overflow-hidden rounded-[14px] bg-subtle">
                    {destinations.map((destination, index) => (
                      <Pressable
                        key={destination.key}
                        accessibilityRole="button"
                        className={cn(
                          "h-12 flex-row items-center gap-3 px-4 active:opacity-70",
                          index > 0 && "border-border",
                        )}
                        style={index > 0 ? { borderTopWidth: StyleSheet.hairlineWidth } : undefined}
                        onPress={destination.onPress}
                      >
                        <SymbolView
                          name={destination.icon}
                          size={17}
                          tintColorClassName="accent-foreground-muted"
                        />
                        <AppText className="min-w-0 flex-1 text-[15px] text-foreground">
                          {destination.label}
                        </AppText>
                        <SymbolView
                          name="chevron.right"
                          size={12}
                          tintColorClassName="accent-foreground-muted"
                        />
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}
            </View>
          </AmbientSkyClear>
        </View>
      </ScrollView>
    </AmbientSkyBackdrop>
  );
}

function ThreadCard(props: {
  readonly thread: EnvironmentThreadShell;
  readonly projectTitle: string | undefined;
  readonly dotClassName?: string;
  readonly statusLabel?: string;
  readonly onPress: () => void;
}) {
  const detail = [props.statusLabel, props.projectTitle].filter(Boolean).join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      className="flex-row items-center gap-3 rounded-[14px] bg-subtle px-4 py-3 active:opacity-70"
      onPress={props.onPress}
    >
      {props.dotClassName ? (
        <View className={cn("h-2 w-2 rounded-full", props.dotClassName)} />
      ) : null}
      <View className="min-w-0 flex-1 gap-0.5">
        <AppText className="text-[15px] font-semibold text-foreground" numberOfLines={1}>
          {props.thread.title || "Untitled task"}
        </AppText>
        {detail ? (
          <AppText className="text-xs text-foreground-muted" numberOfLines={1}>
            {detail}
          </AppText>
        ) : null}
      </View>
      <SymbolView name="chevron.right" size={12} tintColorClassName="accent-foreground-muted" />
    </Pressable>
  );
}
