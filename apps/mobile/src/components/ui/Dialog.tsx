import { useState, useSyncExternalStore } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
  type Alert,
  type AlertButton,
} from "react-native";

import { cn } from "../../lib/cn";
import { AppText } from "./AppText";
import { useControlTheme } from "./useControlTheme";
import type { ConfirmDialogRequest, TextInputDialogRequest } from "./Dialog.types";

export type { ConfirmDialogRequest, TextInputDialogRequest } from "./Dialog.types";

// Portal's `--danger-solid`, the fill of a destructive dialog button.
const DANGER_SOLID = { dark: "#ba2b30", light: "#b21f22" } as const;

type AlertRequest = {
  readonly title: Parameters<typeof Alert.alert>[0];
  readonly message: Parameters<typeof Alert.alert>[1];
  readonly buttons: ReadonlyArray<AlertButton>;
  readonly options: Parameters<typeof Alert.alert>[3];
};

type DialogRequest =
  | { readonly kind: "alert"; readonly request: AlertRequest }
  | { readonly kind: "confirm"; readonly request: ConfirmDialogRequest }
  | { readonly kind: "text-input"; readonly request: TextInputDialogRequest };

type PresentedDialog = DialogRequest & { readonly id: number };

// App services raise dialogs before the root mounts, so the request lives in the module and the
// Host renders whatever is current. One dialog shows at a time: a new request replaces it.
let presented: PresentedDialog | null = null;
let nextPresentationId = 0;
const listeners = new Set<() => void>();

function setPresented(next: PresentedDialog | null) {
  presented = next;
  for (const listener of listeners) listener();
}

function submitRequest(dialog: DialogRequest) {
  setPresented({ ...dialog, id: ++nextPresentationId });
}

/** Closes the dialog only if it is still the one the action came from. */
function dismiss(id: number) {
  if (presented?.id === id) setPresented(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getPresented() {
  return presented;
}

export function alert(...[title, message, buttons, options]: Parameters<typeof Alert.alert>): void {
  const actions = buttons?.length ? buttons.slice(0, 3) : [{ text: "OK" }];
  submitRequest({
    kind: "alert",
    request: {
      title,
      message,
      buttons: actions.map((action) => ({ ...action, text: action.text || "OK" })),
      options,
    },
  });
}

export function confirm(request: ConfirmDialogRequest): void {
  submitRequest({ kind: "confirm", request });
}

export function prompt(request: TextInputDialogRequest): void {
  submitRequest({ kind: "text-input", request });
}

type DialogButtonTone = "primary" | "secondary" | "danger" | "cancel";

function DialogButton(props: {
  readonly title: string;
  readonly tone: DialogButtonTone;
  readonly onPress: () => void;
}) {
  const { colorScheme } = useControlTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.title}
      onPress={props.onPress}
      className={cn(
        "min-h-11 items-center justify-center rounded-[10px] px-4 active:opacity-80",
        props.tone === "primary" && "bg-primary",
        props.tone === "secondary" && "bg-secondary",
      )}
      style={props.tone === "danger" ? { backgroundColor: DANGER_SOLID[colorScheme] } : undefined}
    >
      <AppText
        className={cn(
          "font-t3-medium text-[15px]",
          props.tone === "primary" && "text-primary-foreground",
          props.tone === "secondary" && "text-secondary-foreground",
          props.tone === "danger" && "text-white",
          props.tone === "cancel" && "text-foreground",
        )}
      >
        {props.title}
      </AppText>
    </Pressable>
  );
}

function alertButtonTone(button: AlertButton, isLastDefault: boolean): DialogButtonTone {
  if (button.style === "cancel") return "cancel";
  if (button.style === "destructive") return "danger";
  return isLastDefault ? "primary" : "secondary";
}

/** Portal's alert dialog: a centred card, its actions in an inset band along the bottom. */
function DialogCard(props: {
  readonly title: string;
  readonly message: string | undefined;
  readonly input?: {
    readonly initialValue: string;
    readonly placeholder: string | undefined;
    readonly onChange: (value: string) => void;
    readonly onSubmit: () => void;
  };
  readonly children: React.ReactNode;
}) {
  return (
    <View
      accessibilityViewIsModal
      className="w-full max-w-md overflow-hidden rounded-[10px] bg-sheet-solid shadow-lg"
    >
      <ScrollView bounces={false} contentContainerClassName="gap-5 p-5">
        <View className="gap-1">
          <AppText accessibilityRole="header" className="font-t3-bold text-xl text-foreground">
            {props.title}
          </AppText>
          {props.message ? (
            <AppText className="text-[13px] leading-[18px] text-foreground-secondary">
              {props.message}
            </AppText>
          ) : null}
        </View>
        {props.input ? (
          <TextInput
            autoFocus
            defaultValue={props.input.initialValue}
            placeholder={props.input.placeholder}
            onChangeText={props.input.onChange}
            onSubmitEditing={props.input.onSubmit}
            returnKeyType="done"
            className="min-h-11 rounded-[10px] border border-input-border bg-input px-3 text-[15px] text-foreground"
            placeholderTextColorClassName="accent-foreground-muted"
          />
        ) : null}
      </ScrollView>
      <View className="flex-row flex-wrap-reverse justify-end gap-2 bg-input/60 px-5 py-4">
        {props.children}
      </View>
    </View>
  );
}

/** Hosts the one app dialog, drawn like Portal's alert dialog on both platforms. */
export function Host() {
  const current = useSyncExternalStore(subscribe, getPresented, getPresented);
  const [value, setValue] = useState<{ readonly id: number; readonly text: string } | null>(null);

  const cancel = () => {
    if (!current) return;
    dismiss(current.id);
    if (current.kind === "alert") current.request.options?.onDismiss?.();
    else current.request.onCancel?.();
  };

  let card: React.ReactNode = null;
  if (current?.kind === "alert") {
    const { buttons } = current.request;
    const lastDefault = buttons.findLastIndex(
      (button) => button.style !== "cancel" && button.style !== "destructive",
    );
    card = (
      <DialogCard
        title={current.request.title ?? ""}
        message={current.request.message ?? undefined}
      >
        {buttons.map((button, index) => (
          <DialogButton
            key={button.text ?? "OK"}
            title={button.text ?? "OK"}
            tone={alertButtonTone(button, index === lastDefault)}
            onPress={() => {
              dismiss(current.id);
              button.onPress?.();
            }}
          />
        ))}
      </DialogCard>
    );
  } else if (current) {
    const { request } = current;
    const text =
      current.kind === "text-input"
        ? value?.id === current.id
          ? value.text
          : current.request.initialValue
        : "";
    const submit = () => {
      dismiss(current.id);
      if (current.kind === "confirm") current.request.onConfirm();
      else current.request.onConfirm(text);
    };
    card = (
      <DialogCard
        title={request.title}
        message={request.message}
        input={
          current.kind === "text-input"
            ? {
                initialValue: current.request.initialValue,
                placeholder: current.request.placeholder,
                onChange: (next) => setValue({ id: current.id, text: next }),
                onSubmit: submit,
              }
            : undefined
        }
      >
        <DialogButton title={request.cancelText ?? "Cancel"} tone="cancel" onPress={cancel} />
        <DialogButton
          title={request.confirmText}
          tone={current.kind === "confirm" && current.request.destructive ? "danger" : "primary"}
          onPress={submit}
        />
      </DialogCard>
    );
  }

  const dismissable = current?.kind !== "alert" || current.request.options?.cancelable === true;
  return (
    <Modal
      transparent
      visible={current !== null}
      animationType="fade"
      statusBarTranslucent
      supportedOrientations={["portrait", "landscape"]}
      onRequestClose={dismissable ? cancel : undefined}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 items-center justify-center bg-backdrop px-4"
      >
        {card}
      </KeyboardAvoidingView>
    </Modal>
  );
}
