import * as Haptics from "expo-haptics";
import { cloneElement, isValidElement, useEffect, useId, useState, type ReactElement } from "react";
import { Pressable, View, type PressableProps } from "react-native";

import {
  portalActionSheet,
  type PortalActionSheetContent,
} from "../../features/portal/sheet/portalActionSheet";
import { sheetEntriesFromMenuActions } from "../../features/portal/sheet/portalSheetEntries";
import type { MenuProps } from "./Menu.types";

/**
 * The fork's menus are Portal action sheets: a tap (or a long press on a row) raises a bottom
 * sheet of grouped rows instead of UIKit's glass popover.
 */
export function Menu(props: MenuProps) {
  const ownerId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const { onPressAction, onCloseMenu } = props;

  const content: PortalActionSheetContent = {
    ...(props.title === undefined ? {} : { title: props.title }),
    entries: sheetEntriesFromMenuActions(props.actions, {
      onSelect: (actionId) => onPressAction?.({ nativeEvent: { event: actionId } }),
    }),
    onDismiss: () => {
      setIsOpen(false);
      onCloseMenu?.();
    },
  };

  // An open menu refreshes its rows when the owner re-renders, such as a toggled checkmark.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes this menu's current rows into the shared sheet host while it is open
  useEffect(() => {
    if (isOpen) portalActionSheet.update(ownerId, content);
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- closes this menu's sheet when its trigger unmounts
  useEffect(() => () => portalActionSheet.dismiss(ownerId), [ownerId]);

  const open = () => {
    props.onMenuInteractionStart?.();
    setIsOpen(true);
    portalActionSheet.present(content, { ownerId });
    props.onOpenMenu?.();
  };

  if (props.shouldOpenOnLongPress && isValidElement(props.children)) {
    const child = props.children as ReactElement<Pick<PressableProps, "onLongPress">>;
    return (
      <View style={props.style} className={props.className} testID={props.testID}>
        {cloneElement(child, {
          onLongPress: () => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            open();
          },
        })}
      </View>
    );
  }
  return (
    <Pressable
      accessible={props.accessible}
      accessibilityLabel={props.accessibilityLabel ?? props.title}
      accessibilityRole={props.accessibilityRole ?? "button"}
      hitSlop={props.hitSlop}
      onPress={open}
      style={props.style}
      className={props.className}
      testID={props.testID}
    >
      <View pointerEvents="none" style={{ flexGrow: 1 }}>
        {props.children}
      </View>
    </Pressable>
  );
}
