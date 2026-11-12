import { useState } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  withTiming,
} from "react-native-reanimated";

import { cn } from "../../lib/cn";
import { useControlTheme } from "./useControlTheme";
import type { ThemedSwitchProps } from "./ThemedSwitch.types";

export type { ThemedSwitchProps } from "./ThemedSwitch.types";

// Portal's switch: a 44 by 24 track, centred in a 44-point square target, and a 20-point thumb.
const THUMB_TRAVEL = 20;
const MOTION_MS = 200;

/** A switch drawn like Portal's, on both platforms. */
export function ThemedSwitch(props: ThemedSwitchProps) {
  const { colorScheme } = useControlTheme();
  const reduceMotion = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  const checked = props.value === true;
  const disabled = props.disabled === true;
  const duration = reduceMotion ? 0 : MOTION_MS;
  const easing = Easing.out(Easing.cubic);
  const offset = useDerivedValue(() =>
    withTiming(checked ? THUMB_TRAVEL : 0, { duration, easing }),
  );
  const scale = useDerivedValue(() => withTiming(pressed ? 0.9 : 1, { duration: duration / 2 }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }, { scale: scale.value }],
  }));
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityHint={props.accessibilityHint}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => props.onValueChange?.(!checked)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      testID={props.testID}
      style={props.style}
      className={cn("size-11", disabled && "opacity-50")}
    >
      <View
        className={cn(
          "absolute inset-x-0 top-2.5 h-6 rounded-full border",
          checked
            ? "border-switch-active-track bg-switch-active-track"
            : "border-border bg-switch-inactive-track",
        )}
      />
      <Animated.View
        style={thumbStyle}
        className={cn(
          "absolute left-0.5 top-3 size-5 rounded-full shadow-sm",
          checked
            ? "bg-switch-active-thumb"
            : colorScheme === "dark"
              ? "bg-foreground"
              : "border border-border bg-screen",
        )}
      />
    </Pressable>
  );
}
