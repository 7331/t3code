import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { SymbolView, type AppSymbolName } from "../components/ui/AppSymbol";
import { themeColorWithAlpha } from "../lib/mobileTheme";
import type { NativeMarkdownTextStyle } from "./SelectableMarkdownText.types";

/**
 * The native code block's border and top band, for a fence drawn in React once it closes. As in
 * Portal, the band holds only the block's actions, in its corner: no language label or divider.
 * The block slot already applies the code block's outer margins.
 */
export function CodeBlockFrame(props: {
  readonly textStyle: NativeMarkdownTextStyle;
  readonly actions: ReactNode;
  readonly children: ReactNode;
}) {
  const { textStyle } = props;
  return (
    <View
      style={[
        styles.block,
        {
          backgroundColor: textStyle.codeBlockBackgroundColor,
          borderColor: textStyle.dividerColor,
        },
      ]}
    >
      <View style={styles.band}>{props.actions}</View>
      {props.children}
    </View>
  );
}

/** A header icon, drawn like the native block's copy button. */
export function CodeBlockHeaderButton(props: {
  readonly icon: AppSymbolName;
  readonly label: string;
  readonly textStyle: NativeMarkdownTextStyle;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      hitSlop={10}
      onPress={props.onPress}
    >
      <SymbolView
        name={props.icon}
        size={14}
        tintColor={themeColorWithAlpha(props.textStyle.codeColor, 0.6)}
        type="monochrome"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  block: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  band: {
    minHeight: 32,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 14,
  },
});
