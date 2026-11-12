import type { MenuAction } from "@react-native-menu/menu";

import type { AppBarMenuItem } from "../../../components/ui/AppBar.types";
import type {
  PortalSheetAction,
  PortalSheetEntry,
  PortalSheetGroup,
  PortalSheetSubmenu,
} from "./portalActionSheet";

type PortalSheetRow = PortalSheetAction | PortalSheetSubmenu;

function rowsOf(entries: ReadonlyArray<PortalSheetEntry>): PortalSheetRow[] {
  return entries.flatMap((entry) => (entry.kind === "group" ? entry.rows : [entry]));
}

/** UIMenu's action tree as sheet entries; inline sections become groups, the rest drill in. */
export function sheetEntriesFromMenuActions(
  actions: ReadonlyArray<MenuAction>,
  options: { readonly onSelect: (actionId: string) => void },
): PortalSheetEntry[] {
  return actions.flatMap((action, index): PortalSheetEntry[] => {
    if (action.attributes?.hidden) return [];
    const id = action.id ?? `${action.title}-${index}`;
    if (action.subactions !== undefined && action.subactions.length > 0) {
      const entries = sheetEntriesFromMenuActions(action.subactions, options);
      if (action.displayInline) {
        const group: PortalSheetGroup = {
          kind: "group",
          id,
          ...(action.title.length > 0 ? { title: action.title } : {}),
          rows: rowsOf(entries),
        };
        return group.rows.length > 0 ? [group] : [];
      }
      return [
        {
          kind: "submenu",
          id,
          title: action.title,
          ...(action.subtitle === undefined ? {} : { subtitle: action.subtitle }),
          ...(action.image === undefined ? {} : { icon: action.image }),
          entries,
        },
      ];
    }
    return [
      {
        kind: "action",
        id,
        title: action.title,
        ...(action.subtitle === undefined ? {} : { subtitle: action.subtitle }),
        ...(action.image === undefined ? {} : { icon: action.image }),
        ...(action.imageColor === undefined || typeof action.imageColor === "number"
          ? {}
          : { iconColor: action.imageColor }),
        isSelected: action.state === "on",
        isDestructive: Boolean(action.attributes?.destructive),
        isDisabled: Boolean(action.attributes?.disabled),
        keepsSheetOpen: Boolean(action.attributes?.keepsMenuPresented),
        onPress: () => options.onSelect(id),
      },
    ];
  });
}

/** A header bar menu's items as sheet entries. */
export function sheetEntriesFromAppBarMenuItems(
  items: ReadonlyArray<AppBarMenuItem>,
): PortalSheetEntry[] {
  return items.map((item): PortalSheetEntry => {
    if ("items" in item) {
      const entries = sheetEntriesFromAppBarMenuItems(item.items);
      if (item.inline || item.title === undefined) {
        return {
          kind: "group",
          id: item.id,
          ...(item.title === undefined ? {} : { title: item.title }),
          rows: rowsOf(entries),
        };
      }
      return {
        kind: "submenu",
        id: item.id,
        title: item.title,
        ...(item.icon === undefined ? {} : { icon: item.icon }),
        entries,
      };
    }
    return {
      kind: "action",
      id: item.id,
      title: item.title,
      ...(item.subtitle === undefined ? {} : { subtitle: item.subtitle }),
      ...(item.icon === undefined ? {} : { icon: item.icon }),
      ...(item.iconColor === undefined ? {} : { iconColor: item.iconColor }),
      isSelected: Boolean(item.selected),
      isDestructive: Boolean(item.destructive),
      isDisabled: Boolean(item.disabled),
      onPress: item.onPress,
    };
  });
}
