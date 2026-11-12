import { useEffect } from "react";
import { Animated, Easing, View, useAnimatedValue } from "react-native";

import { useReduceMotionEnabled } from "../../lib/appState";

// Portal's typing dots: three 5pt dots pulsing 1 → 0.35 → 1 over 1.2 s, each 0.16 s behind the last.
const PULSE_MS = 1200;
const DOT_PHASES = [0, 0.16 / 1.2, 0.32 / 1.2] as const;
const DIM_OPACITY = 0.35;

function dotOpacityAtPhaseStart(phase: number): number {
  const position = (1 - phase) % 1;
  return position < 0.5
    ? 1 - (1 - DIM_OPACITY) * position * 2
    : DIM_OPACITY + (1 - DIM_OPACITY) * (position - 0.5) * 2;
}

/** A live "the agent is working on it" mark, drawn the way Portal shows someone typing. */
export function PortalTypingDots() {
  const reduceMotion = useReduceMotionEnabled();
  // Native-driver Animated, not Reanimated: the feed must not commit per frame (see thread-work-log).
  const progress = useAnimatedValue(0, { useNativeDriver: true });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the native pulse loop while mounted and motion is allowed
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: PULSE_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress, reduceMotion]);

  return (
    <View accessible={false} className="h-2 flex-row items-center gap-0.75">
      {DOT_PHASES.map((phase) => (
        <Animated.View
          key={phase}
          className="size-1.25 rounded-full bg-foreground-secondary"
          style={{
            opacity: reduceMotion
              ? 0.7
              : progress.interpolate({
                  inputRange: [0, phase, phase + 0.5, 1],
                  outputRange: [
                    dotOpacityAtPhaseStart(phase),
                    1,
                    DIM_OPACITY,
                    dotOpacityAtPhaseStart(phase),
                  ],
                }),
          }}
        />
      ))}
    </View>
  );
}
