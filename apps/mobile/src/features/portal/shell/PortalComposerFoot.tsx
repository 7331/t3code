import { StyleSheet } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";

// Wider and deeper than any screen: the foot runs past the side gutters, the home indicator and,
// while the keyboard is up, the gap down to it.
const FOOT_BLEED = 64;
const FOOT_DEPTH = 1200;

/**
 * Portal's composer foot: a solid band with a hairline on top, from the working status row down to
 * the screen edge, so the transcript ends at the band instead of showing through and below it.
 */
export function PortalComposerFoot(props: { readonly statusRowHeight: SharedValue<number> }) {
  const { statusRowHeight } = props;
  const topStyle = useAnimatedStyle(() => ({ top: -statusRowHeight.value }));
  return (
    <Animated.View
      pointerEvents="none"
      className="border-separator bg-screen"
      style={[
        {
          position: "absolute",
          left: -FOOT_BLEED,
          right: -FOOT_BLEED,
          bottom: -FOOT_DEPTH,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        topStyle,
      ]}
    />
  );
}
