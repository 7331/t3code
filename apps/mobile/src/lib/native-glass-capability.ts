export function supportsNativeLiquidGlass(
  _platform: string,
  _nativeCapabilityAvailable: boolean,
): boolean {
  // The fork keeps liquid glass off: solid headers and plain buttons instead of
  // glass pills and hairline capsules.
  return false;
}
