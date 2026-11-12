import { View } from "react-native";
import type { ReactNode } from "react";

import { AppText as Text } from "./AppText";
import { Button } from "./Button";

/** Portal's empty state: a centred title, a quieter hint under it, and the action below. */
export function EmptyState(props: {
  readonly title: string;
  readonly detail: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly action?: ReactNode;
}) {
  return (
    <View className="items-center gap-4 px-6 py-12">
      <View className="max-w-[320px] items-center gap-1">
        <Text className="text-center font-t3-bold text-base text-foreground">{props.title}</Text>
        <Text className="text-center text-[13px] leading-[18px] text-foreground-tertiary">
          {props.detail}
        </Text>
      </View>
      {props.action ? (
        props.action
      ) : props.actionLabel && props.onAction ? (
        <Button tone="primary" label={props.actionLabel} onPress={props.onAction} />
      ) : null}
    </View>
  );
}
