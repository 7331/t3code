import { resolveComposerDispatchMode } from "@t3tools/client-runtime/state/composer-dispatch";
import {
  type EnvironmentThreadShell,
  threadRuntimeIsActive,
} from "@t3tools/client-runtime/state/models";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import { ArrowUpIcon } from "lucide-react";
import { useRef, useState } from "react";

import { collapseExpandedComposerCursor, composerRequiresModifier } from "../../composer-logic";
import { EMPTY_COMPOSER_CONTEXT_RECORDS } from "../composerContextPresentation";
import { useComposerDraftStore, useComposerThreadDraft } from "../../composerDraftStore";
import { useClientSettings } from "../../hooks/useSettings";
import { newMessageId } from "~/lib/utils";
import { useEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import {
  ComposerPromptEditorTiptap as ComposerPromptEditor,
  type ComposerPromptEditorHandle,
} from "../ComposerPromptEditorTiptap";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";

const NO_SKILLS: ReadonlyArray<never> = [];

/** One line at rest, growing to about six before it scrolls. */
const HOME_CARD_EDITOR_CLASS = "min-h-0 max-h-[8.5rem]";

/**
 * A card's reply field: plain text into the thread's own draft. Menus, the model picker,
 * attachments and context stay in the thread's full composer.
 */
export function HomeCardComposer({
  thread,
  threadRef,
  hint,
}: {
  readonly thread: EnvironmentThreadShell;
  readonly threadRef: ScopedThreadRef;
  readonly hint: string | null;
}) {
  const sendShortcut = useClientSettings((clientSettings) => clientSettings.sendShortcut);
  const followUpBehavior = useClientSettings((clientSettings) => clientSettings.followUpBehavior);
  const draft = useComposerThreadDraft(threadRef);
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);
  const canOperate = useEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope);
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const prompt = draft.prompt;
  const [cursor, setCursor] = useState(() =>
    collapseExpandedComposerCursor(prompt, prompt.length, false),
  );
  const [sending, setSending] = useState(false);
  const editorRef = useRef<ComposerPromptEditorHandle>(null);

  // The card sends text only; a draft holding attachments or context goes out from the thread.
  const draftHasExtras =
    draft.images.length +
      draft.files.length +
      draft.persistedAttachments.length +
      draft.terminalContexts.length +
      draft.previewAnnotations.length +
      draft.reviewComments.length +
      draft.threadContexts.length >
    0;
  const canSend = canOperate && !sending && !draftHasExtras && prompt.trim().length > 0;

  const send = async () => {
    const text = prompt.trim();
    if (!canSend) return;
    setSending(true);
    setPrompt(threadRef, "");
    setCursor(0);
    // A model picked in the thread's composer wins; otherwise the server keeps the thread's.
    const modelSelection = draft.modelSelectionByProvider[thread.modelSelection.instanceId];
    const result = await startTurn({
      environmentId: thread.environmentId,
      input: {
        threadId: thread.id,
        message: { messageId: newMessageId(), role: "user", text, attachments: [] },
        ...(modelSelection ? { modelSelection } : {}),
        titleSeed: thread.title,
        runtimeMode: draft.runtimeMode ?? thread.runtimeMode,
        interactionMode: draft.interactionMode ?? thread.interactionMode,
        dispatchMode: resolveComposerDispatchMode({
          running: threadRuntimeIsActive(thread.runtime),
          alternateModifier: false,
          activeTurnDefault: followUpBehavior,
        }),
      },
    });
    setSending(false);
    if (result._tag === "Success") return;
    // Clearing a text-only draft removes it, so an absent draft counts as empty. Text typed
    // meanwhile wins over the restore.
    if ((useComposerDraftStore.getState().getComposerDraft(threadRef)?.prompt ?? "") === "") {
      setPrompt(threadRef, prompt);
    }
    if (!isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title: "Message not sent",
        description: `Couldn’t send to “${thread.title}”. Your text is back in the reply field.`,
      });
    }
  };

  const onCommandKeyDown = (key: string, event: KeyboardEvent): boolean => {
    if (key !== "Enter" || event.shiftKey) return false;
    const modifier = event.metaKey || event.ctrlKey;
    if (composerRequiresModifier(sendShortcut, prompt) && !modifier) return false;
    void send();
    return true;
  };

  return (
    // The card's own reply surface: one row inset like the messages above, one border, no shadow.
    // The editor grows upward while the send key stays on its last line.
    <div className="px-4 pb-4">
      <div className="flex items-end gap-1 rounded-3xl border border-input bg-background py-1.5 ps-4 pe-1.5">
        <div className="min-w-0 flex-1 py-1">
          <ComposerPromptEditor
            draftKey={`home-card:${thread.environmentId}:${thread.id}`}
            ariaLabel={`Reply to ${thread.title}`}
            editorRef={editorRef}
            value={prompt}
            cursor={cursor}
            contextRecords={EMPTY_COMPOSER_CONTEXT_RECORDS}
            skills={NO_SKILLS}
            disabled={!canOperate}
            placeholder={
              canOperate ? `Reply to ${thread.title}` : "This connection can't send messages"
            }
            placeholderClassName="truncate"
            className={HOME_CARD_EDITOR_CLASS}
            onChange={(nextValue, nextCursor) => {
              setPrompt(threadRef, nextValue);
              setCursor(nextCursor);
            }}
            onCommandKeyDown={onCommandKeyDown}
            onPaste={() => undefined}
          />
        </div>
        <Button size="icon-sm" aria-label="Send" disabled={!canSend} onClick={() => void send()}>
          <ArrowUpIcon />
        </Button>
      </div>
      {draftHasExtras ? (
        <p className="px-4 pt-2 text-xs text-muted-foreground">
          This draft has attachments; send it from the thread.
        </p>
      ) : null}
      {hint ? <p className="px-4 pt-2 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
