import { composerDraftHasUserContent, useComposerDraftStore } from "~/composerDraftStore";
import type { ComposerThreadTarget } from "~/composerDraftStore";

import { AmbientSky } from "./AmbientSky";

/** Holds the sky still once the draft has content, so nothing drifts while the user writes. */
export function DraftHeroSky({ draftTarget }: { readonly draftTarget: ComposerThreadTarget }) {
  const hasContent = useComposerDraftStore((store) =>
    composerDraftHasUserContent(store.getComposerDraft(draftTarget)),
  );
  return <AmbientSky motion={hasContent ? "still" : "live"} />;
}
