import { portalActionSheet } from "../../features/portal/sheet/portalActionSheet";
import { sheetEntriesFromAppBarMenuItems } from "../../features/portal/sheet/portalSheetEntries";
import { Toolbar } from "./Toolbar";

import type { AppBarMenu } from "./AppBar.types";

/** A header menu is a bare glyph that raises a Portal action sheet, not a UIKit popover. */
export function createNativeHeaderMenu(menu: AppBarMenu) {
  return (
    <Toolbar.Button
      key={menu.title}
      accessibilityLabel={menu.accessibilityLabel ?? menu.title}
      icon={typeof menu.icon === "string" ? menu.icon : menu.icon.ios}
      separateBackground={menu.separateBackground ?? true}
      onPress={() =>
        portalActionSheet.present({
          title: menu.title,
          ...(menu.status === undefined ? {} : { subtitle: menu.status }),
          entries: sheetEntriesFromAppBarMenuItems(menu.items),
        })
      }
    />
  );
}
