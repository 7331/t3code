/**
 * Portal's typefaces, Fluxer Sans and Fluxer Mono, embedded by the expo-font plugin
 * (app.config.ts). iOS resolves each by its PostScript name; Android registers the same names.
 */
export const FONT_FAMILIES = {
  regular: "FluxerSans",
  medium: "FluxerSans-Medm",
  bold: "FluxerSans-Bold",
} as const;

export type FontFamilies = Readonly<Record<keyof typeof FONT_FAMILIES, string>>;

/** Portal's code typeface. */
export const MONO_FONT_FAMILY = "FluxerMono";
