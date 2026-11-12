export const FONT_FAMILIES = {
  regular: "DMSans-Regular",
  medium: "DMSans-Medium",
  bold: "DMSans-Bold",
} as const;

export type FontFamilies = Readonly<Record<keyof typeof FONT_FAMILIES, string>>;
