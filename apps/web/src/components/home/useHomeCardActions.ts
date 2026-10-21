import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";

import { useThreadActions } from "../../hooks/useThreadActions";
import { useServerConfigs } from "../../state/entities";
import { toastManager } from "../ui/toast";
import { homeCardThreadActions } from "./homeThreads.logic";

interface CardToggle {
  readonly active: boolean;
  readonly toggle: () => void;
}

/** Pin and settle for a card, through the sidebar's own paths and their undo notices. */
export function useHomeCardActions() {
  const serverConfigs = useServerConfigs();
  const { pinThread, confirmAndUnpinThread, settleThread, unsettleThread } = useThreadActions();

  const report = (failed: boolean, title: string) => {
    if (failed) toastManager.add({ type: "error", title });
  };

  const togglePin = async (thread: EnvironmentThreadShell) => {
    const ref = scopeThreadRef(thread.environmentId, thread.id);
    const pinned = thread.pinnedAt !== null;
    const result = pinned ? await confirmAndUnpinThread(ref) : await pinThread(ref);
    report(
      result._tag === "Failure" && !isAtomCommandInterrupted(result),
      pinned ? "Couldn’t unpin thread" : "Couldn’t pin thread",
    );
  };

  const toggleSettled = async (thread: EnvironmentThreadShell) => {
    const ref = scopeThreadRef(thread.environmentId, thread.id);
    const settled = thread.settledOverride === "settled";
    const result = settled ? await unsettleThread(ref) : await settleThread(ref);
    report(
      result._tag === "Failure" && !isAtomCommandInterrupted(result),
      settled ? "Couldn’t unsettle thread" : "Couldn’t settle thread",
    );
  };

  return (
    thread: EnvironmentThreadShell,
  ): { readonly pin: CardToggle | null; readonly settle: CardToggle | null } => {
    const capabilities = serverConfigs.get(thread.environmentId)?.environment.capabilities;
    const allowed = homeCardThreadActions({
      thread,
      supportsPinning: capabilities?.threadPinning === true,
      supportsSettlement: capabilities?.threadSettlement === true,
    });
    return {
      pin: allowed.pin
        ? { active: thread.pinnedAt !== null, toggle: () => void togglePin(thread) }
        : null,
      settle: allowed.settle
        ? {
            active: thread.settledOverride === "settled",
            toggle: () => void toggleSettled(thread),
          }
        : null,
    };
  };
}
