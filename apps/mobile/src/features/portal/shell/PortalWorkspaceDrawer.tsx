import { useNavigation, useNavigationState } from "@react-navigation/native";
import { useEffect, useState } from "react";
import {
  Animated,
  Easing,
  Keyboard,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CompactBrandTitle } from "../../../components/CompactBrandTitle";
import { SymbolView } from "../../../components/ui/AppSymbol";
import { AppText } from "../../../components/ui/AppText";
import { PaneContext } from "../../../components/ui/Pane";
import { HomeRouteScreen } from "../../home/HomeRouteScreen";
import {
  NAVIGATION_TAB_ICONS,
  WORKSPACE_TAB_LABELS,
  useEnabledNavigationTabs,
} from "../../layout/workspace/navigation-tabs";
import { useSelectWorkspaceTab } from "../../layout/workspace/useSelectWorkspaceTab";
import { useWorkspaceTabs } from "../../layout/workspace/WorkspaceTabsContext";
import { openSettings } from "../../settings/settings-navigation";
import { portalDrawer, usePortalDrawerOpen } from "./portalDrawerStore";
import { usePortalPhoneShell } from "./usePortalPhoneShell";

/** Routes that are the workspace root itself; anything pushed above them closes the drawer. */
const WORKSPACE_ROOT_ROUTES = new Set(["Home", "Settings"]);

export function PortalWorkspaceDrawer() {
  const shell = usePortalPhoneShell();
  const open = usePortalDrawerOpen();
  const workspace = useWorkspaceTabs();
  const selectTab = useSelectWorkspaceTab();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const enabled = useEnabledNavigationTabs();
  const { width: windowWidth } = useWindowDimensions();
  const [animation] = useState(() => new Animated.Value(0));
  const topRouteName = useNavigationState((state) => state.routes[state.index]?.name);

  // Session rows and destination rows navigate by pushing; the sidebar follows them closed.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the drawer store in step with the router's pushed routes
  useEffect(() => {
    if (
      topRouteName !== undefined &&
      !WORKSPACE_ROOT_ROUTES.has(topRouteName) &&
      portalDrawer.open()
    ) {
      portalDrawer.close();
    }
  }, [topRouteName]);

  // Keeps the Animated slide transform in step with the drawer's open flag.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives the native-driver animation from the store flag
  useEffect(() => {
    Animated.timing(animation, {
      toValue: open ? 1 : 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [animation, open]);

  if (!shell) return null;

  const panelWidth = Math.min(360, Math.max(300, windowWidth - 64));
  const panelTranslate = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [-panelWidth - 32, 0],
  });
  const scrimOpacity = animation.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const query = workspace?.state.tabs.threads.query ?? "";
  const destinations = [
    ...enabled.map((tab) => ({
      key: tab,
      icon: NAVIGATION_TAB_ICONS[tab],
      label: WORKSPACE_TAB_LABELS[tab],
      onPress: () => {
        portalDrawer.close();
        selectTab(tab);
      },
    })),
    {
      key: "settings",
      icon: "gearshape" as const,
      label: "Settings",
      onPress: () => {
        portalDrawer.close();
        selectTab("settings");
      },
    },
  ];

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View
        pointerEvents={open ? "auto" : "none"}
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: "rgba(0,0,0,0.45)", opacity: scrimOpacity },
        ]}
      >
        <Pressable
          accessibilityLabel="Close sidebar"
          accessibilityRole="button"
          onPress={() => {
            Keyboard.dismiss();
            portalDrawer.close();
          }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <Animated.View
        pointerEvents={open ? "auto" : "none"}
        className="border-border bg-drawer"
        style={{
          borderRightWidth: StyleSheet.hairlineWidth,
          bottom: 0,
          left: 0,
          paddingBottom: insets.bottom,
          paddingTop: insets.top,
          position: "absolute",
          top: 0,
          transform: [{ translateX: panelTranslate }],
          width: panelWidth,
        }}
      >
        <View className="flex-1 px-3 pt-1">
          <View className="gap-2 pb-2">
            <View className="flex-row items-center justify-between pr-1">
              <CompactBrandTitle fit />
              <Pressable
                accessibilityLabel="Environments"
                accessibilityRole="button"
                className="h-8 w-8 items-center justify-center active:opacity-70"
                onPress={() => {
                  portalDrawer.close();
                  openSettings(navigation, "SettingsEnvironments");
                }}
              >
                <SymbolView
                  name="chevron.down"
                  size={14}
                  tintColorClassName="accent-foreground-muted"
                />
              </Pressable>
            </View>
            <View className="h-9 flex-row items-center gap-2 rounded-[10px] bg-subtle px-3">
              <SymbolView
                name="magnifyingglass"
                size={14}
                tintColorClassName="accent-foreground-muted"
              />
              <TextInput
                accessibilityLabel="Search threads"
                autoCapitalize="none"
                autoCorrect={false}
                className="min-w-0 flex-1 font-sans text-sm text-foreground"
                onChangeText={(text) =>
                  workspace?.dispatch({ type: "query", query: text, tab: "threads" })
                }
                placeholder="Search"
                placeholderTextColorClassName="accent-placeholder"
                returnKeyType="search"
                selectionColorClassName="accent-focus/32"
                value={query}
              />
            </View>
          </View>
          <View className="min-h-0 flex-1">
            <PaneContext value="sidebar">
              <HomeRouteScreen />
            </PaneContext>
          </View>
        </View>
        <View className="gap-1 px-3 pb-2 pt-2">
          {destinations.map((destination) => (
            <Pressable
              key={destination.key}
              accessibilityRole="button"
              className="h-11 flex-row items-center gap-3 rounded-[10px] px-3 active:bg-subtle"
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
      </Animated.View>
    </View>
  );
}
