import { NativeHeaderToolbar } from "../../native/NativeHeaderToolbar";
import type { ToolbarProps } from "./Toolbar.types";
import { View } from "react-native";

function ToolbarRoot(props: ToolbarProps) {
  if (props.placement) return <NativeHeaderToolbar {...props} />;
  // The fork keeps toolbars bare: no glass capsule around floating controls.
  return <View style={{ flexDirection: "row", alignItems: "center" }}>{props.children}</View>;
}

export const Toolbar = Object.assign(ToolbarRoot, {
  Button: NativeHeaderToolbar.Button,
  Custom: NativeHeaderToolbar.Custom,
  Label: NativeHeaderToolbar.Label,
  Menu: NativeHeaderToolbar.Menu,
  MenuAction: NativeHeaderToolbar.MenuAction,
  SearchBarSlot: NativeHeaderToolbar.SearchBarSlot,
  Spacer: NativeHeaderToolbar.Spacer,
});
