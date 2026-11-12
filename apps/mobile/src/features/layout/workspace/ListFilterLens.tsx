import { Pressable, View } from "react-native";

import { SymbolView } from "../../../components/ui/AppSymbol";
import { AppText as Text } from "../../../components/ui/AppText";
import { Menu } from "../../../components/ui/Menu";
import type { MenuProps } from "../../../components/ui/Menu.types";
import { usePaneRole } from "../../../components/ui/Pane";
import { cn } from "../../../lib/cn";

/**
 * A list's filters, drawn like Portal's chat-list lens: a bare filter glyph naming the current
 * scope that opens every filter in one sheet, accent while it narrows the list, with a clear
 * button beside it.
 */
export function ListFilterLens(props: {
  /** The sheet's title and the trigger's spoken name. */
  readonly title: string;
  /** Draws in drawer colours; defaults to whether the list sits in a sidebar pane. */
  readonly sidebar?: boolean;
  readonly label: string;
  readonly active: boolean;
  readonly actions: MenuProps["actions"];
  readonly onSelect: (id: string) => void;
  readonly onClear: () => void;
  readonly clearAccessibilityLabel: string;
}) {
  const paneRole = usePaneRole();
  const sidebarPane = props.sidebar ?? paneRole === "sidebar";
  return (
    <View className={cn("flex-row items-center gap-1 pb-1", sidebarPane ? "px-3" : "px-5")}>
      <Menu
        title={props.title}
        accessibilityLabel={`${props.title}: ${props.label}`}
        actions={props.actions}
        onPressAction={({ nativeEvent }) => props.onSelect(nativeEvent.event)}
        className="min-w-0 shrink"
      >
        <View className="h-8 flex-row items-center gap-1.5">
          <SymbolView
            name="line.3.horizontal.decrease"
            size={14}
            tintColorClassName={
              props.active
                ? "accent-primary"
                : sidebarPane
                  ? "accent-drawer-foreground-muted"
                  : "accent-foreground-muted"
            }
          />
          <Text
            numberOfLines={1}
            className={cn(
              "shrink text-[13px] font-t3-medium",
              props.active
                ? "text-primary"
                : sidebarPane
                  ? "text-drawer-foreground-muted"
                  : "text-foreground-tertiary",
            )}
          >
            {props.label}
          </Text>
        </View>
      </Menu>
      {props.active ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.clearAccessibilityLabel}
          hitSlop={8}
          className="h-8 w-7 items-center justify-center"
          onPress={props.onClear}
        >
          <SymbolView name="xmark.circle.fill" size={15} tintColorClassName="accent-primary" />
        </Pressable>
      ) : null}
    </View>
  );
}
