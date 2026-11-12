import { useEffect } from "react";
import { StyleSheet, View, type ActivityIndicatorProps } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { useResolveClassNames, withUniwind } from "uniwind";

// Portal's spinner: lucide's Loader2 arc turning once a second, still when motion is reduced.
const LOADER_ARC = "M21 12a9 9 0 1 1-6.219-8.56";
const TURN_MS = 1000;

function PortalSpinner({
  animating = true,
  color,
  colorClassName: _colorClassName,
  className: _className,
  hidesWhenStopped = true,
  size = "small",
  style,
  ...viewProps
}: ActivityIndicatorProps) {
  const { color: mutedColor } = useResolveClassNames("text-foreground-muted");
  const reduceMotion = useReducedMotion();
  const rotation = useSharedValue(0);
  const diameter = typeof size === "number" ? size : size === "large" ? 32 : 16;
  const spinning = animating && !reduceMotion;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the UI-thread turn while the spinner is animating and motion is allowed
  useEffect(() => {
    if (!spinning) return;
    rotation.set(0);
    rotation.set(withRepeat(withTiming(360, { duration: TURN_MS, easing: Easing.linear }), -1));
    return () => cancelAnimation(rotation);
  }, [spinning, rotation]);

  const turnStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <View
      accessible={animating}
      accessibilityRole="progressbar"
      accessibilityState={{ busy: animating }}
      {...viewProps}
      style={[styles.container, style]}
    >
      {animating || !hidesWhenStopped ? (
        <Animated.View
          pointerEvents="none"
          style={[{ width: diameter, height: diameter }, turnStyle]}
        >
          <Svg width={diameter} height={diameter} viewBox="0 0 24 24" fill="none">
            <Path
              d={LOADER_ARC}
              stroke={color ?? mutedColor}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Animated.View>
      ) : (
        <View style={{ width: diameter, height: diameter }} />
      )}
    </View>
  );
}

/** Portal's loading spinner, with ActivityIndicator's props, on both platforms. */
export const AppActivityIndicator = withUniwind(PortalSpinner);

const styles = StyleSheet.create({
  container: { alignItems: "center", justifyContent: "center" },
});
