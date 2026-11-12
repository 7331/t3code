import { useRef } from "react";
import { type TextInputInstance, View } from "react-native";

import { SearchField } from "../../../components/ui/SearchField";
import { useWorkspaceTabs } from "../../layout/workspace/WorkspaceTabsContext";
import type { WorkspaceSearchTab } from "../../layout/workspace/workspace-tabs-state";

/**
 * Portal's list search for a workspace tab on the phone: a filled field at the top of the list,
 * in place of UIKit's glass search capsule. It drives the same search state as the native bar.
 */
export function PortalTabSearchField(props: {
  readonly tab: WorkspaceSearchTab;
  readonly placeholder: string;
}) {
  const workspace = useWorkspaceTabs();
  const inputRef = useRef<TextInputInstance>(null);
  if (!workspace) return null;
  const { query } = workspace.state.tabs[props.tab];
  return (
    <View className="pb-2">
      <SearchField
        inputRef={inputRef}
        autoFocus={false}
        accessibilityLabel={props.placeholder}
        clearAccessibilityLabel="Clear search"
        placeholder={props.placeholder}
        value={query}
        onChangeText={(next) => workspace.dispatch({ type: "query", tab: props.tab, query: next })}
        onFocus={() => workspace.dispatch({ type: "search", tab: props.tab })}
        onBlur={() =>
          workspace.dispatch({ type: query === "" ? "cancel" : "expand", tab: props.tab })
        }
      />
    </View>
  );
}
