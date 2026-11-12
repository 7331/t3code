import { Pressable, View } from "react-native";

import { cn } from "../../lib/cn";
import { AppText } from "./AppText";
import type { SegmentedControlProps } from "./SegmentedControl.types";

export type { SegmentedControlProps } from "./SegmentedControl.types";

/**
 * Portal's segmented control on touch screens: one outlined 44-point segment per option, a
 * 4-point gap between them, and the chosen one filled with the primary colour.
 */
export function SegmentedControl<Value extends string | number>(
  props: SegmentedControlProps<Value>,
) {
  return (
    <View className={cn("flex-row gap-1", props.className)}>
      {props.options.map((option) => {
        const selected = option.value === props.selected;
        return (
          <Pressable
            key={`${typeof option.value}:${option.value}`}
            accessibilityRole={props.role ?? "button"}
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            accessibilityState={{ selected }}
            onPress={() => props.onSelect(option.value)}
            className={cn(
              "min-h-11 flex-auto items-center justify-center rounded-[10px] border px-3 active:opacity-70",
              selected ? "border-primary bg-primary" : "border-input-border",
            )}
          >
            <AppText
              numberOfLines={1}
              className={cn(
                "font-t3-medium text-[13px]",
                selected ? "text-primary-foreground" : "text-foreground-tertiary",
              )}
            >
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}
