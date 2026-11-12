type NativeGlassHeaderItem = {
  readonly type: "button" | "menu";
  readonly glassEffect?: boolean;
  readonly hidesSharedBackground?: boolean;
  readonly sharesBackground?: boolean;
  readonly variant?: "plain" | "done" | "prominent";
  readonly axisBehavior?: "automatic" | "horizontalOnly" | "verticalPreferred";
  readonly width?: number;
};

/** Normal glassEffect items become custom UIButtons in react-native-screens, creating a second skinny capsule. */
export function withNativeGlassHeaderItem<T extends NativeGlassHeaderItem>(
  item: T,
  options: {
    readonly hidesSharedBackground?: boolean;
    readonly sharesBackground?: boolean;
    readonly width?: number;
  } = {},
): T {
  // The fork's bar buttons are bare glyphs: no shared capsule background unless
  // a filled variant (done, prominent) explicitly asks for one.
  const sharesBackground = options.sharesBackground ?? item.sharesBackground ?? false;
  const variant = item.variant ?? "plain";
  return {
    ...item,
    glassEffect: item.glassEffect ?? false,
    hidesSharedBackground:
      options.hidesSharedBackground ?? item.hidesSharedBackground ?? variant === "plain",
    sharesBackground,
    variant,
    width: options.width ?? item.width,
  } as T;
}
