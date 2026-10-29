import { resolveComposerDispatchMode } from "@t3tools/client-runtime/state/composer-dispatch";
import {
  type EnvironmentThreadShell,
  threadRuntimeIsActive,
} from "@t3tools/client-runtime/state/models";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import {
  type ApprovalResponder,
  declinePendingApprovals,
  derivePendingThreadRequests,
  pendingApprovalReplyPlaceholder,
  sendApprovalFeedback,
} from "@t3tools/client-runtime/state/thread-requests";
import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import { ArrowUpIcon } from "lucide-react";
import { useRef, useState } from "react";

import { collapseExpandedComposerCursor, composerRequiresModifier } from "../../composer-logic";
import { EMPTY_COMPOSER_CONTEXT_RECORDS } from "../composerContextPresentation";
import { useComposerDraftStore, useComposerThreadDraft } from "../../composerDraftStore";
import { useClientSettings } from "../../hooks/useSettings";
import { newMessageId } from "~/lib/utils";
import { useQuietThreadProjection } from "../../state/entities";
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
 * attachments and context stay in the thread's full composer. As in the thread, a reply to an
 * agent waiting on approval declines the request; a question is answered in the thread.
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
  const respondToThreadApproval = useOrchestrationCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });
  const projection = useQuietThreadProjection(threadRef)?.projection ?? null;
  const pendingRequests = projection === null ? null : derivePendingThreadRequests(projection);
  const pendingApprovals = pendingRequests?.approvals ?? [];
  const pendingApproval = pendingApprovals[0] ?? null;
  const waitingOnQuestion = (pendingRequests?.userInputs.length ?? 0) > 0;
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
  const canSend =
    canOperate && !sending && !draftHasExtras && !waitingOnQuestion && prompt.trim().length > 0;

  const respondToApproval: ApprovalResponder = (requestId, decision, feedback) =>
    respondToThreadApproval({
      environmentId: thread.environmentId,
      input: {
        threadId: thread.id,
        requestId,
        decision,
        ...(feedback === undefined ? {} : { feedback }),
      },
    });

  /** Puts the text back after a failed send, and says why unless the send was interrupted. */
  const restoreUnsentPrompt = (failureDescription: string | null) => {
    // Clearing a text-only draft removes it, so an absent draft counts as empty. Text typed
    // meanwhile wins over the restore.
    if ((useComposerDraftStore.getState().getComposerDraft(threadRef)?.prompt ?? "") === "") {
      setPrompt(threadRef, prompt);
    }
    if (failureDescription === null) return;
    toastManager.add({
      type: "error",
      title: "Message not sent",
      description: `${failureDescription} Your text is back in the reply field.`,
    });
  };

  const send = async () => {
    const text = prompt.trim();
    if (!canSend) return;
    setSending(true);
    setPrompt(threadRef, "");
    setCursor(0);
    if (pendingApproval?.supportsFeedback) {
      const sent = await sendApprovalFeedback(pendingApproval, text, respondToApproval).catch(
        () => false,
      );
      setSending(false);
      if (!sent) restoreUnsentPrompt(`Couldn’t send feedback to “${thread.title}”.`);
      return;
    }
    // Any approval left pending would hold the reply behind it.
    if (!(await declinePendingApprovals(pendingApprovals, respondToApproval).catch(() => false))) {
      setSending(false);
      restoreUnsentPrompt(`Couldn’t decline the request in “${thread.title}”.`);
      return;
    }
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
          // A declined request redirects the waiting turn instead of queueing behind it.
          activeTurnDefault: pendingApproval === null ? followUpBehavior : "steer",
        }),
      },
    });
    setSending(false);
    if (result._tag === "Success") return;
    restoreUnsentPrompt(
      isAtomCommandInterrupted(result) ? null : `Couldn’t send to “${thread.title}”.`,
    );
  };

  const placeholder = !canOperate
    ? "This connection can't send messages"
    : waitingOnQuestion
      ? "Answer its question in the thread"
      : pendingApproval
        ? pendingApprovalReplyPlaceholder(pendingApproval)
        : "Reply";

  const onCommandKeyDown = (key: string, event: KeyboardEvent): boolean => {
    if (key !== "Enter" || event.shiftKey) return false;
    const modifier = event.metaKey || event.ctrlKey;
    if (composerRequiresModifier(sendShortcut, prompt) && !modifier) return false;
    void send();
    return true;
  };

  return (
    // An inset of the page's own tone, set apart from the card without a border.
    // The editor grows upward while the send key stays on its last line.
    <div className="px-3 pb-3">
      <div className="flex items-end gap-1 rounded-2xl bg-background py-1.5 ps-4 pe-1.5">
        <div className="min-w-0 flex-1 py-1">
          <ComposerPromptEditor
            draftKey={`home-card:${thread.environmentId}:${thread.id}`}
            ariaLabel={`Reply to ${thread.title}`}
            editorRef={editorRef}
            value={prompt}
            cursor={cursor}
            contextRecords={EMPTY_COMPOSER_CONTEXT_RECORDS}
            skills={NO_SKILLS}
            disabled={!canOperate || waitingOnQuestion}
            placeholder={placeholder}
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
