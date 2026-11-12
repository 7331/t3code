import * as Haptics from "expo-haptics";
import { useState } from "react";
import { View } from "react-native";
import {
  GestureDetector,
  usePanGesture,
  useTapGesture,
  useExclusiveGestures,
} from "react-native-gesture-handler";

import { AppText } from "./AppText";
import { SymbolView } from "./AppSymbol";
import type { SliderRowProps } from "./SliderRow.types";

export type { SliderRowProps } from "./SliderRow.types";

// Portal's slider on touch screens: a 4-point track tinted with the primary colour, filled up to
// a 24-point thumb ringed in the primary colour.
const THUMB = 24;
const TRACK = 4;
const HEIGHT = 44;

/** A labelled setting slider, drawn like Portal's on both platforms. */
export function SliderRow(props: SliderRowProps) {
  const [width, setWidth] = useState(0);
  const span = Math.max(0, width - THUMB);
  const range = props.max - props.min;
  const fraction = range > 0 ? Math.min(1, Math.max(0, (props.value - props.min) / range)) : 0;

  const select = (value: number) => {
    if (props.disabled) return;
    const next = Math.min(
      props.max,
      Math.max(props.min, props.min + Math.round((value - props.min) / props.step) * props.step),
    );
    if (next === props.value) return;
    void Haptics.selectionAsync().catch(() => undefined);
    props.onChange(next);
  };
  const selectAt = (x: number) => {
    if (span <= 0) return;
    select(props.min + (Math.min(span, Math.max(0, x - THUMB / 2)) / span) * range);
  };

  const drag = usePanGesture({
    runOnJS: true,
    enabled: !props.disabled,
    activeOffsetX: [-4, 4],
    failOffsetY: [-10, 10],
    onActivate: (event) => selectAt(event.x),
    onUpdate: (event) => selectAt(event.x),
  });
  const tap = useTapGesture({
    runOnJS: true,
    enabled: !props.disabled,
    onDeactivate: (event) => {
      if (!event.canceled) selectAt(event.x);
    },
  });
  const gesture = useExclusiveGestures(drag, tap);

  return (
    <View className={props.disabled ? "gap-1 p-4 opacity-[0.45]" : "gap-1 p-4"}>
      <View className="flex-row items-center gap-4">
        <SymbolView name={props.icon} size={22} tintColorClassName="accent-icon" />
        <AppText className="flex-1 text-lg text-foreground">{props.label}</AppText>
        <AppText className="text-base font-t3-medium text-foreground-muted">
          {props.valueLabel}
        </AppText>
      </View>
      <View className="flex-row items-center gap-3">
        {props.minimumIcon ? (
          <SymbolView name={props.minimumIcon} size={15} tintColorClassName="accent-icon-muted" />
        ) : null}
        <GestureDetector gesture={gesture}>
          <View
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={props.label}
            accessibilityValue={{ text: props.valueLabel }}
            accessibilityState={{ disabled: Boolean(props.disabled) }}
            accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
            onAccessibilityAction={({ nativeEvent }) =>
              select(props.value + (nativeEvent.actionName === "increment" ? 1 : -1) * props.step)
            }
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            className="flex-1"
            style={{ height: HEIGHT }}
          >
            <View
              className="absolute rounded-full bg-primary/20"
              style={{
                left: THUMB / 2,
                right: THUMB / 2,
                top: (HEIGHT - TRACK) / 2,
                height: TRACK,
              }}
            />
            <View
              className="absolute rounded-full bg-primary"
              style={{
                left: THUMB / 2,
                width: fraction * span,
                top: (HEIGHT - TRACK) / 2,
                height: TRACK,
              }}
            />
            {width > 0 ? (
              <View
                className="absolute rounded-full border-2 border-primary bg-screen shadow-sm"
                style={{
                  left: fraction * span,
                  top: (HEIGHT - THUMB) / 2,
                  width: THUMB,
                  height: THUMB,
                }}
              />
            ) : null}
          </View>
        </GestureDetector>
        {props.maximumIcon ? (
          <SymbolView name={props.maximumIcon} size={22} tintColorClassName="accent-icon-muted" />
        ) : null}
      </View>
    </View>
  );
}
