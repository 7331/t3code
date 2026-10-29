import { HTML_RENDER_DEFAULT_FONTS, htmlRenderTheme } from "@t3tools/shared/htmlRender";
import { useSyncExternalStore } from "react";

import { appearanceFontStack } from "../appearanceFonts";
import {
  getStandardThemeColors,
  getThemeColorsForMode,
  getThemeDefinition,
  getThemePreview,
  resolveThemeHalf,
  subscribeToCustomThemes,
  subscribeToThemePreview,
  themeColorToHex,
  type ThemeAppearance,
  type ThemeHalves,
  type ThemePreference,
} from "../themePalette";
import { useClientSettings } from "./useSettings";
import { useRenderedAppearance, useTheme } from "./useTheme";

function resolveActiveThemeColors(
  theme: ThemePreference,
  halves: ThemeHalves | null,
  appearance: ThemeAppearance,
) {
  const definition = getThemeDefinition(resolveThemeHalf(theme, halves, appearance));
  return definition === null
    ? getStandardThemeColors(appearance)
    : (getThemeColorsForMode(definition, appearance) ?? definition.colors);
}

export function useHtmlRenderTheme() {
  const { theme, themeHalves } = useTheme();
  const appearance = useRenderedAppearance();
  const preview = useSyncExternalStore(subscribeToThemePreview, getThemePreview, () => null);
  // Custom and published palettes can be edited in place, under an unchanged preference.
  const storedColors = useSyncExternalStore(
    subscribeToCustomThemes,
    () => resolveActiveThemeColors(theme, themeHalves, appearance),
    () => getStandardThemeColors(appearance),
  );
  const colors = preview?.colors ?? storedColors;
  const sans = useClientSettings((settings) => settings.fontFamilySans);
  const mono = useClientSettings((settings) => settings.fontFamilyCode);
  return htmlRenderTheme(
    Object.fromEntries(
      Object.entries(colors).map(([role, color]) => [role, themeColorToHex(color) ?? color]),
    ) as typeof colors,
    appearance,
    {
      sans: appearanceFontStack(sans, HTML_RENDER_DEFAULT_FONTS.sans),
      mono: appearanceFontStack(mono, HTML_RENDER_DEFAULT_FONTS.mono),
    },
  );
}
