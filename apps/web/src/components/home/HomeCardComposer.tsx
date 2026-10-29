import {
  resolveProviderSkillsForCwd,
  resolveProviderSlashCommandsForCwd,
} from "@t3tools/client-runtime/providerSkills";
import { resolveComposerDispatchMode } from "@t3tools/client-runtime/state/composer-dispatch";
import {
  type EnvironmentThreadShell,
  threadRuntimeIsActive,
} from "@t3tools/client-runtime/state/models";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  ProviderDriverKind,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { ArrowUpIcon } from "lucide-react";
import { useId, useRef, useState } from "react";

import {
  collapseExpandedComposerCursor,
  composerRequiresModifier,
  type ComposerTrigger,
  detectComposerTrigger,
  expandCollapsedComposerCursor,
  isPathSuggestionCurrent,
} from "../../composer-logic";
import { EMPTY_COMPOSER_CONTEXT_RECORDS } from "../composerContextPresentation";
import { useComposerDraftStore, useComposerThreadDraft } from "../../composerDraftStore";
import { useClientSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import { newMessageId } from "~/lib/utils";
import { useEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { ComposerCommandMenu, composerSuggestionOptionId } from "../chat/ComposerCommandMenu";
import { ComposerCommandMenuLayer } from "../chat/ComposerCommandMenuLayer";
import { ComposerSendButton } from "../chat/ComposerSendButton";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { useComposerMenuItems } from "../chat/useComposerMenuItems";
import { useComposerTriggerState } from "../chat/useComposerTriggerState";
import {
  ComposerPromptEditorTiptap as ComposerPromptEditor,
  type ComposerPromptEditorHandle,
} from "../ComposerPromptEditorTiptap";
import { toastManager } from "../ui/toast";
import {
  applyHomeCardMenuItem,
  homeCardSendModelSelection,
  isHomeCardMenuItem,
  stepHomeCardMenuHighlight,
  type HomeCardMenuItem,
} from "./homeCardComposer.logic";
import type { HomeCardModel } from "./useHomeCardModel";

const NO_LINKED_ENVIRONMENTS = new Map<never, never>();
const NO_SKILLS: ReadonlyArray<never> = [];
/** Only feeds the menu hook while the thread's provider is unknown; it then has no skills to list. */
const FALLBACK_DRIVER_KIND = ProviderDriverKind.make("codex");

/** One line at rest, growing to about six before it scrolls. */
const HOME_CARD_EDITOR_CLASS = "min-h-0 max-h-[8.5rem]";

/** Pull requests need draft context records the card does not keep, so their menu stays closed. */
function cardTrigger(candidate: ComposerTrigger | null): ComposerTrigger | null {
  return candidate?.kind === "pull-request" ? null : candidate;
}

/**
 * A card's reply field: the thread composer's editor, @ / $ / slash menus and model, writing into
 * the thread's own draft. Attachments and context stay in the thread's full composer.
 */
export function HomeCardComposer({
  thread,
  threadRef,
  cwd,
  hint,
  model,
}: {
  readonly thread: EnvironmentThreadShell;
  readonly threadRef: ScopedThreadRef;
  readonly cwd: string | null;
  readonly hint: string | null;
  readonly model: HomeCardModel;
}) {
  const sendShortcut = useClientSettings((clientSettings) => clientSettings.sendShortcut);
  const followUpBehavior = useClientSettings((clientSettings) => clientSettings.followUpBehavior);
  const { resolvedTheme } = useTheme();
  const draft = useComposerThreadDraft(threadRef);
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);
  const setModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const canOperate = useEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope);
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const prompt = draft.prompt;
  const [cursor, setCursor] = useState(() =>
    collapseExpandedComposerCursor(prompt, prompt.length, false),
  );
  const { trigger, setTrigger, dismissTrigger } = useComposerTriggerState(() => null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const editorRef = useRef<ComposerPromptEditorHandle>(null);
  const listId = `${useId()}-suggestions`;

  const { settings, entry, draftModel, slug: shownModel, modelOptions } = model;
  const instanceId = thread.modelSelection.instanceId;
  const skills = entry?.snapshot ? resolveProviderSkillsForCwd(entry.snapshot, cwd) : NO_SKILLS;
  const slashCommands = entry?.snapshot
    ? resolveProviderSlashCommandsForCwd(entry.snapshot, cwd)
    : NO_SKILLS;
  const menu = useComposerMenuItems({
    composerTrigger: trigger,
    environmentId: thread.environmentId,
    // A card is not the full composer: no linked environments, no question attachments.
    linkedEnvironments: NO_LINKED_ENVIRONMENTS,
    questionAttachmentTarget: null,
    gitCwd: cwd,
    activeThreadId: thread.id,
    pullRequestProjectId: null,
    pullRequestRepository: null,
    threadPullRequests: undefined,
    planModeUiEnabled: false,
    compactSlashCommandAvailable: false,
    selectedProvider: entry?.driverKind ?? FALLBACK_DRIVER_KIND,
    selectedProviderSkills: skills,
    selectedProviderSlashCommands: slashCommands,
    showSkillsInSlashMenu: settings.showSkillsInSlashMenu,
  });
  const items = menu.items.filter(isHomeCardMenuItem);
  const activeItem = items.find((item) => item.id === highlightedId) ?? items[0] ?? null;
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

  const selectItem = (item: HomeCardMenuItem) => {
    const snapshot = editorRef.current?.readSnapshot() ?? {
      value: prompt,
      expandedCursor: expandCollapsedComposerCursor(prompt, cursor, false),
    };
    const active = detectComposerTrigger(snapshot.value, snapshot.expandedCursor);
    if (active === null) return;
    if (
      item.type === "path" &&
      !isPathSuggestionCurrent(item.searchTarget, active, thread.environmentId, cwd)
    ) {
      return;
    }
    const next = applyHomeCardMenuItem(snapshot.value, active, item);
    const nextCursor = collapseExpandedComposerCursor(next.text, next.cursor, false);
    setPrompt(threadRef, next.text);
    setCursor(nextCursor);
    setTrigger(cardTrigger(detectComposerTrigger(next.text, next.cursor)));
    setHighlightedId(null);
    window.requestAnimationFrame(() => editorRef.current?.focusAt(nextCursor));
  };

  const send = async () => {
    const text = prompt.trim();
    if (!canSend) return;
    setSending(true);
    setPrompt(threadRef, "");
    setCursor(0);
    setTrigger(null);
    const modelSelection = homeCardSendModelSelection(thread.modelSelection, draftModel);
    // The same choices the thread's composer would send: the draft's modes and model, and the
    // user's follow-up setting for a running turn.
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
    if (trigger !== null && items.length > 0) {
      if (key === "ArrowDown" || key === "ArrowUp") {
        setHighlightedId(
          stepHomeCardMenuHighlight(items, activeItem?.id ?? null, key === "ArrowDown" ? 1 : -1),
        );
        return true;
      }
      if ((key === "Enter" || key === "Tab") && activeItem !== null) {
        selectItem(activeItem);
        return true;
      }
    }
    if (key === "Escape" && trigger !== null) {
      dismissTrigger(trigger);
      return true;
    }
    if (key !== "Enter" || event.shiftKey) return false;
    const modifier = event.metaKey || event.ctrlKey;
    if (composerRequiresModifier(sendShortcut, prompt) && !modifier) return false;
    void send();
    return true;
  };

  return (
    // The card's own reply surface: one row inset like the messages above, one border, no shadow.
    // The editor grows upward while the picker and send key stay on its last line. The menu layer
    // reads the drawer inset.
    <div className="px-4 pb-4">
      <div
        ref={setAnchor}
        className="flex items-end gap-1 rounded-3xl border border-input bg-background py-1.5 ps-4 pe-1.5 [--chat-composer-drawer-inset:0rem]"
      >
        <div className="min-w-0 flex-1 py-1">
          <ComposerPromptEditor
            draftKey={`home-card:${thread.environmentId}:${thread.id}`}
            ariaLabel={`Reply to ${thread.title}`}
            editorRef={editorRef}
            value={prompt}
            cursor={cursor}
            contextRecords={EMPTY_COMPOSER_CONTEXT_RECORDS}
            skills={skills}
            disabled={!canOperate}
            placeholder={
              canOperate ? `Reply to ${thread.title}` : "This connection can't send messages"
            }
            suggestionListId={listId}
            activeSuggestionId={
              trigger !== null && activeItem !== null
                ? composerSuggestionOptionId(listId, activeItem.id)
                : undefined
            }
            placeholderClassName="truncate"
            className={HOME_CARD_EDITOR_CLASS}
            onChange={(
              nextValue,
              nextCursor,
              expandedCursor,
              cursorAdjacentToMention,
              _contextIds,
            ) => {
              setPrompt(threadRef, nextValue);
              setCursor(nextCursor);
              setTrigger(
                cursorAdjacentToMention
                  ? null
                  : cardTrigger(detectComposerTrigger(nextValue, expandedCursor)),
              );
            }}
            onCommandKeyDown={onCommandKeyDown}
            onPaste={() => undefined}
          />
        </div>
        {entry !== null ? (
          <ProviderModelPicker
            environmentId={thread.environmentId}
            activeInstanceId={instanceId}
            model={shownModel}
            lockedProvider={entry.driverKind}
            instanceEntries={[entry]}
            modelOptionsByInstance={modelOptions}
            isComposerOwned
            disabled={!canOperate}
            onInstanceModelChange={(nextInstanceId, model) =>
              setModelSelection(threadRef, createModelSelection(nextInstanceId, model), {
                explicit: true,
              })
            }
          />
        ) : null}
        <ComposerSendButton aria-label="Send" disabled={!canSend} onClick={() => void send()}>
          <ArrowUpIcon className="size-4" />
        </ComposerSendButton>
      </div>
      {draftHasExtras ? (
        <p className="px-4 pt-2 text-xs text-muted-foreground">
          This draft has attachments; send it from the thread.
        </p>
      ) : null}
      {hint ? <p className="px-4 pt-2 text-xs text-muted-foreground">{hint}</p> : null}
      {trigger !== null ? (
        <ComposerCommandMenuLayer anchor={anchor}>
          <ComposerCommandMenu
            listId={listId}
            items={items}
            resolvedTheme={resolvedTheme}
            isLoading={menu.isLoading}
            triggerKind={trigger.kind}
            emptyStateText={menu.emptyState}
            activeItemId={activeItem?.id ?? null}
            onHighlightedItemChange={setHighlightedId}
            onSelect={(item) => {
              if (isHomeCardMenuItem(item)) selectItem(item);
            }}
          />
        </ComposerCommandMenuLayer>
      ) : null}
    </div>
  );
}
