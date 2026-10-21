import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ScopedThreadRef } from "@t3tools/contracts";

import { useComposerDraftModelState } from "../../composerDraftStore";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
} from "../../providerInstances";
import { useEnvironmentProviders } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { resolveProviderModelPickerTrigger } from "../chat/ProviderModelPicker";
import { homeCardModelSlug } from "./homeCardComposer.logic";

/**
 * The model a card shows and sends with, named the way its picker names it, so the subtitle and
 * the picker always agree.
 */
export function useHomeCardModel(thread: EnvironmentThreadShell, threadRef: ScopedThreadRef) {
  const settings = useEnvironmentSettings(thread.environmentId);
  const providers = useEnvironmentProviders().get(thread.environmentId) ?? EMPTY_SERVER_PROVIDERS;
  const instanceId = thread.modelSelection.instanceId;
  const draftModel = useComposerDraftModelState(threadRef).modelSelectionByProvider[instanceId];
  const entry =
    applyProviderInstanceSettings(
      deriveProviderInstanceEntries(providers),
      settings,
      thread.projectId,
    ).find((candidate) => candidate.instanceId === instanceId) ?? null;
  const slug = homeCardModelSlug(thread.modelSelection, draftModel);
  const modelOptions = getCustomModelOptionsByInstance(settings, providers, instanceId, slug);
  const { title } = resolveProviderModelPickerTrigger({
    driverKind: entry?.driverKind,
    model: slug,
    options: modelOptions.get(instanceId) ?? [],
  });
  return { settings, entry, draftModel, slug, label: entry ? title : slug, modelOptions };
}

export type HomeCardModel = ReturnType<typeof useHomeCardModel>;
