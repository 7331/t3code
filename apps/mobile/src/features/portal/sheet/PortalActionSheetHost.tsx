import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import {
  GestureDetector,
  GestureHandlerRootView,
  usePanGesture,
} from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView, type AppSymbolName } from "../../../components/ui/AppSymbol";
import { AppText } from "../../../components/ui/AppText";
import { cn } from "../../../lib/cn";
import {
  portalActionSheet,
  usePresentedPortalActionSheet,
  type PortalActionSheetContent,
  type PortalSheetAction,
  type PortalSheetEntry,
  type PortalSheetGroup,
  type PortalSheetSubmenu,
  type PresentedPortalActionSheet,
} from "./portalActionSheet";

const ENTER_MS = 240;
const EXIT_MS = 180;
const DISMISS_DRAG_DISTANCE = 96;
const DISMISS_DRAG_VELOCITY = 900;

type PortalSheetRow = PortalSheetAction | PortalSheetSubmenu;

/** Consecutive loose rows share one card; a group entry is always its own card. */
function cardsOf(entries: ReadonlyArray<PortalSheetEntry>): PortalSheetGroup[] {
  const cards: PortalSheetGroup[] = [];
  let loose: PortalSheetRow[] = [];
  const flushLoose = () => {
    if (loose.length === 0) return;
    cards.push({ kind: "group", id: `loose-${cards.length}`, rows: loose });
    loose = [];
  };
  for (const entry of entries) {
    if (entry.kind === "group") {
      flushLoose();
      if (entry.rows.length > 0) cards.push(entry);
    } else {
      loose.push(entry);
    }
  }
  flushLoose();
  return cards;
}

function SheetRow(props: {
  readonly row: PortalSheetRow;
  readonly onPressAction: (action: PortalSheetAction) => void;
  readonly onOpenSubmenu: (submenu: PortalSheetSubmenu) => void;
}) {
  const { row } = props;
  const isAction = row.kind === "action";
  const isDestructive = isAction && row.isDestructive === true;
  const isDisabled = isAction && row.isDisabled === true;
  const isSelected = isAction && row.isSelected === true;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.title}
      accessibilityHint={row.subtitle}
      accessibilityState={{ disabled: isDisabled, selected: isSelected }}
      disabled={isDisabled}
      onPress={() => (row.kind === "action" ? props.onPressAction(row) : props.onOpenSubmenu(row))}
      className={cn(
        "min-h-12.5 flex-row items-center gap-3 px-3 py-2 active:bg-row-hover",
        isDisabled && "opacity-40",
      )}
    >
      {row.icon === undefined ? null : (
        <SymbolView
          // Menu rows carry UIMenu image names: SF Symbols or the fork's custom glyph names.
          name={row.icon as AppSymbolName}
          size={20}
          tintColor={isAction ? row.iconColor : undefined}
          tintColorClassName={
            isAction && row.iconColor !== undefined
              ? undefined
              : isDestructive
                ? "accent-danger-foreground"
                : "accent-icon"
          }
        />
      )}
      <View className="min-w-0 flex-1">
        <AppText
          className={cn(
            "font-t3-medium text-[15px] leading-5",
            isDestructive ? "text-danger-foreground" : "text-foreground",
          )}
          numberOfLines={2}
        >
          {row.title}
        </AppText>
        {row.subtitle === undefined ? null : (
          <AppText textRole="label" className="text-foreground-secondary" numberOfLines={2}>
            {row.subtitle}
          </AppText>
        )}
      </View>
      {isSelected ? (
        <SymbolView name="checkmark" size={16} tintColorClassName="accent-primary" />
      ) : null}
      {row.kind === "submenu" ? (
        <SymbolView name="chevron.right" size={14} tintColorClassName="accent-chevron" />
      ) : null}
    </Pressable>
  );
}

function SheetCards(props: {
  readonly entries: ReadonlyArray<PortalSheetEntry>;
  readonly onPressAction: (action: PortalSheetAction) => void;
  readonly onOpenSubmenu: (submenu: PortalSheetSubmenu) => void;
}) {
  return (
    <View className="gap-3">
      {cardsOf(props.entries).map((card) => (
        <View key={card.id} className="gap-1.5">
          {card.title === undefined ? null : (
            <AppText textRole="label" className="px-3 text-foreground-secondary">
              {card.title}
            </AppText>
          )}
          <View className="overflow-hidden rounded-2xl bg-grouped-card">
            {card.rows.map((row, index) => (
              <View key={row.id}>
                {index > 0 ? (
                  <View
                    className="ml-3 bg-separator"
                    style={{ height: StyleSheet.hairlineWidth }}
                  />
                ) : null}
                <SheetRow
                  row={row}
                  onPressAction={props.onPressAction}
                  onOpenSubmenu={props.onOpenSubmenu}
                />
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function SheetHeader(props: {
  readonly content: PortalActionSheetContent;
  readonly submenu: PortalSheetSubmenu | undefined;
  readonly onBack: () => void;
}) {
  if (props.submenu !== undefined) {
    return (
      <View className="flex-row items-center pb-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          onPress={props.onBack}
          className="size-11 items-center justify-center rounded-full active:bg-row-hover"
        >
          <SymbolView name="chevron.left" size={20} tintColorClassName="accent-icon" />
        </Pressable>
        <AppText
          className="flex-1 text-center font-t3-medium text-lg text-foreground"
          numberOfLines={1}
        >
          {props.submenu.title}
        </AppText>
        <View className="size-11" />
      </View>
    );
  }
  if (props.content.title === undefined || props.content.title.length === 0) return null;
  return (
    <View className="px-3 pb-3">
      <AppText className="font-t3-medium text-lg text-foreground" numberOfLines={2}>
        {props.content.title}
      </AppText>
      {props.content.subtitle === undefined ? null : (
        <AppText textRole="label" className="text-foreground-secondary" numberOfLines={2}>
          {props.content.subtitle}
        </AppText>
      )}
    </View>
  );
}

function PresentedSheet(props: {
  readonly presented: PresentedPortalActionSheet;
  readonly isClosing: boolean;
  readonly onClosed: () => void;
  readonly onPressAction: (action: PortalSheetAction) => void;
}) {
  const { content } = props.presented;
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const [path, setPath] = useState<ReadonlyArray<string>>([]);
  const [sheetHeight, setSheetHeight] = useState(windowHeight);
  const progress = useSharedValue(0);
  const drag = useSharedValue(0);
  const { onClosed } = props;

  let entries = content.entries;
  let submenu: PortalSheetSubmenu | undefined;
  for (const id of path) {
    const next = entries
      .flatMap((entry) => (entry.kind === "group" ? entry.rows : [entry]))
      .find((entry): entry is PortalSheetSubmenu => entry.kind === "submenu" && entry.id === id);
    if (next === undefined) break;
    submenu = next;
    entries = next.entries;
  }

  // Slides the sheet in on present and out once the store has closed it.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives the UI-thread enter and exit animation from the presented and closing flags
  useEffect(() => {
    const duration = reduceMotion ? 0 : props.isClosing ? EXIT_MS : ENTER_MS;
    progress.set(
      withTiming(
        props.isClosing ? 0 : 1,
        { duration, easing: props.isClosing ? Easing.in(Easing.cubic) : Easing.out(Easing.cubic) },
        (finished) => {
          if (finished && props.isClosing) runOnJS(onClosed)();
        },
      ),
    );
  }, [props.isClosing, reduceMotion, progress, onClosed]);

  const ownerId = props.presented.ownerId;
  const dismissDrag = usePanGesture({
    activeOffsetY: 8,
    failOffsetX: [-24, 24],
    onUpdate: (event) => {
      drag.set(Math.max(0, event.translationY));
    },
    onDeactivate: (event) => {
      if (event.translationY > DISMISS_DRAG_DISTANCE || event.velocityY > DISMISS_DRAG_VELOCITY) {
        runOnJS(portalActionSheet.dismiss)(ownerId);
      } else {
        drag.set(withTiming(0, { duration: 160 }));
      }
    },
  });

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * sheetHeight + drag.value }],
  }));

  const maxSheetHeight = windowHeight - insets.top - 24;
  return (
    <GestureHandlerRootView className="flex-1">
      <Animated.View style={scrimStyle} className="absolute inset-0 bg-backdrop">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close menu"
          className="flex-1"
          onPress={() => portalActionSheet.dismiss(props.presented.ownerId)}
        />
      </Animated.View>
      <View pointerEvents="box-none" className="flex-1 justify-end">
        <GestureDetector gesture={dismissDrag}>
          <Animated.View
            accessibilityViewIsModal
            onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}
            style={[sheetStyle, { maxHeight: maxSheetHeight, paddingBottom: insets.bottom + 12 }]}
            className="rounded-t-2xl bg-sheet-solid px-3 pt-5 shadow-lg"
          >
            <View pointerEvents="none" className="absolute inset-x-0 top-1.5 items-center">
              <View className="h-1 w-9 rounded-full bg-chevron" />
            </View>
            <SheetHeader
              content={content}
              submenu={submenu}
              onBack={() => setPath((current) => current.slice(0, -1))}
            />
            <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
              <SheetCards
                entries={entries}
                onPressAction={props.onPressAction}
                onOpenSubmenu={(next) => {
                  void Haptics.selectionAsync();
                  setPath((current) => [...current, next.id]);
                }}
              />
            </ScrollView>
          </Animated.View>
        </GestureDetector>
      </View>
    </GestureHandlerRootView>
  );
}

/**
 * Hosts the one Portal action sheet. It is a transparent RN Modal so it also covers native form
 * sheets. A pressed action runs after the modal is gone, so pickers and pushes it starts present
 * from a free view controller.
 */
export function PortalActionSheetHost() {
  const presented = usePresentedPortalActionSheet();
  const [shown, setShown] = useState<PresentedPortalActionSheet | null>(null);
  const pendingAction = useRef<(() => void) | null>(null);

  // The last sheet stays on screen while it animates out after the store cleared it.
  if (presented !== null && presented !== shown) setShown(presented);

  const runPendingAction = () => {
    const action = pendingAction.current;
    pendingAction.current = null;
    action?.();
  };

  const isClosing = presented === null;
  const visible = shown !== null;
  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      statusBarTranslucent
      supportedOrientations={["portrait", "landscape"]}
      onRequestClose={() => portalActionSheet.dismiss()}
      onDismiss={runPendingAction}
    >
      {shown === null ? null : (
        <PresentedSheet
          key={shown.ownerId}
          presented={presented ?? shown}
          isClosing={isClosing}
          onClosed={() => {
            setShown(null);
          }}
          onPressAction={(action) => {
            void Haptics.selectionAsync();
            if (action.keepsSheetOpen) {
              action.onPress();
              return;
            }
            pendingAction.current = action.onPress;
            portalActionSheet.dismiss(shown.ownerId);
          }}
        />
      )}
    </Modal>
  );
}
