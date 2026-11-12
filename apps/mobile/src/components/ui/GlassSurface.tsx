import type { ReactNode, Ref } from "react";
import {
  Platform,
  View,
  type ColorValue,
  type ViewInstance,
  type ViewProps,
  type ViewStyle,
} from "react-native";

import { MOBILE_SHAPE } from "../../lib/designTokens";
import { cn } from "../../lib/cn";
import { useAppearancePreferences } from "../../features/settings/appearance/AppearancePreferencesProvider";
import { GlassBackdrop } from "./GlassBackdrop";

interface GlassSurfaceProps extends ViewProps {
  readonly ref?: Ref<ViewInstance>;
  readonly children: ReactNode;
  readonly chrome?: "default" | "none";
  readonly fallbackColor?: ColorValue;
  readonly fallbackClassName?: string;
}

/** A floating surface in Portal's look: solid fill, hairline border, soft shadow. Portal draws no glass. */
export function GlassSurface({
  ref,
  children,
  chrome = "default",
  fallbackColor,
  fallbackClassName,
  className,
  style,
  ...props
}: GlassSurfaceProps) {
  const { themeAppearance } = useAppearancePreferences();
  const isDarkMode = themeAppearance === "dark";
  const hasShadow = chrome !== "none" && Platform.OS !== "android";
  const surfaceStyle: ViewStyle = {
    borderRadius: MOBILE_SHAPE.popup,
    overflow: "hidden",
    shadowColor: hasShadow ? "#000000" : "transparent",
    shadowOpacity: hasShadow ? (isDarkMode ? 0.22 : 0.08) : 0,
    shadowRadius: hasShadow ? 28 : 0,
    shadowOffset: { width: 0, height: hasShadow ? 14 : 0 },
    elevation: hasShadow ? 12 : 0,
  };

  return (
    <View
      {...props}
      ref={ref}
      className={cn(
        chrome === "none" ? "border-0 border-transparent" : "border border-border",
        fallbackClassName,
        className,
      )}
      style={[surfaceStyle, style]}
    >
      <GlassBackdrop fallbackColor={fallbackColor} />
      {children}
    </View>
  );
}
