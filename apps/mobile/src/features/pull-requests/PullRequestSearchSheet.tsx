import { useNavigation } from "@react-navigation/native";
import type { ReactNode } from "react";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBar } from "../../components/ui/AppBar";
import type { AppBarSearch } from "../../components/ui/AppBar.types";
import { useSearchToolbarInset } from "../../components/ui/useBarInset";

/** A searchable picker over a pull request list or a pull request. */
export function PullRequestSearchSheet(props: {
  readonly title: string;
  readonly placeholder: string;
  readonly closeAccessibilityLabel: string;
  readonly clearAccessibilityLabel: string;
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  /** Renders the list, given the bottom padding that keeps its end clear of the search bar. */
  readonly children: (list: { readonly paddingBottom: number }) => ReactNode;
}) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const search: AppBarSearch = {
    mode: "inline",
    compactToolbar: true,
    value: props.query,
    onChangeText: props.onQueryChange,
    placeholder: props.placeholder,
    clearAccessibilityLabel: props.clearAccessibilityLabel,
  };
  // The compact search toolbar, where it is used, floats over the end of the list.
  const searchToolbarInset = useSearchToolbarInset(search);
  return (
    <View className="flex-1 bg-sheet" collapsable={false}>
      <AppBar
        title={props.title}
        onClose={() => navigation.goBack()}
        closeAccessibilityLabel={props.closeAccessibilityLabel}
        hideBottomBorder
        search={search}
      />
      {props.children({
        // Android's bottom inset also covers the floating workspace tabs while Settings is open.
        paddingBottom: Platform.OS === "android" ? insets.bottom + 16 : searchToolbarInset + 16,
      })}
    </View>
  );
}
