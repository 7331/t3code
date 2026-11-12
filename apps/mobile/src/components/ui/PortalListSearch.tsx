import { useRef } from "react";
import { type TextInputInstance, View } from "react-native";

import { usePortalPhoneShell } from "../../features/portal/shell/usePortalPhoneShell";
import type { AppBarSearch } from "./AppBar.types";
import { SearchField } from "./SearchField";

/**
 * Portal's list search on the phone: a filled field at the top of the list, which the page puts
 * first in its list. Elsewhere the AppBar keeps its native search, so this renders nothing.
 */
export function PortalListSearch(props: {
  /** The page's search; a page without one renders nothing. */
  readonly search: AppBarSearch | undefined;
  readonly className?: string;
}) {
  const portalPhoneShell = usePortalPhoneShell();
  const inputRef = useRef<TextInputInstance>(null);
  const { search } = props;
  if (!portalPhoneShell || !search) return null;
  return (
    <View className={props.className ?? "pb-2"}>
      <SearchField
        inputRef={inputRef}
        autoFocus={false}
        accessibilityLabel={search.accessibilityLabel ?? search.placeholder}
        clearAccessibilityLabel={search.clearAccessibilityLabel ?? "Clear search"}
        placeholder={search.placeholder}
        value={search.value}
        onChangeText={search.onChangeText}
      />
    </View>
  );
}
