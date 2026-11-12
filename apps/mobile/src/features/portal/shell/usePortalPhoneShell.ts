import { Platform } from "react-native";

import { isDuoDevice } from "../../../lib/device-type";
import { useDeviceType } from "../../../native/native-layout-metrics";
import { useAdaptiveWorkspaceLayout } from "../../layout/adaptive-workspace-context";

/**
 * The Portal phone shell: iPhone widths that never split into columns. It replaces
 * the compact glass tab footer with the slide-in sidebar and the sky dashboard.
 */
export function usePortalPhoneShell(): boolean {
  const { layout } = useAdaptiveWorkspaceLayout();
  const deviceType = useDeviceType();
  return (
    Platform.OS === "ios" &&
    deviceType !== "pad" &&
    !layout.usesSplitView &&
    !isDuoDevice(deviceType)
  );
}
