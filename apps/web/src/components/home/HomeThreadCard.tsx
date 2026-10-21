import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import {
  deriveProviderSubagentStatus,
  formatProviderSubagentStatus,
} from "@t3tools/client-runtime/state/thread-execution";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowUpIcon,
  BotIcon,
  ChevronDownIcon,
  PinIcon,
  PinOffIcon,
  SquareArrowOutUpRightIcon,
} from "lucide-react";
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { useComposerDraftStore, useComposerThreadDraft } from "../../composerDraftStore";
import { observeResize } from "~/lib/observeResize";
import { cn, newMessageId } from "~/lib/utils";
import { useEnvironmentScope } from "../../state/session";
import { useProject, useThreadProjection, useThreadVisibleTurnItems } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { useUiStateStore } from "~/uiStateStore";
import { AnimatedHeight } from "../AnimatedHeight";
import ChatMarkdown from "../ChatMarkdown";
import { ProjectFavicon } from "../ProjectFavicon";
import { resolveThreadLastVisitedAt, resolveThreadStatusPill } from "../Sidebar.logic";
import { ThreadStatusLabel, ThreadWorktreeIndicator } from "../ThreadStatusIndicators";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { latestHomeCardMessages } from "./homeThreads.logic";

/** Within this many pixels of the bottom, the transcript keeps following new output. */
const FOLLOW_LATEST_SLACK_PX = 24;

/** One thread on Home: its header, its latest messages, and a quick reply into its shared draft. */
export function HomeThreadCard({
  thread,
  collapsed,
  onToggleCollapsed,
  pin,
  readOnly = false,
}: {
  readonly thread: EnvironmentThreadShell;
  readonly collapsed: boolean;
  readonly onToggleCollapsed: () => void;
  /** Absent when the thread's environment cannot pin. */
  readonly pin: { readonly pinned: boolean; readonly toggle: () => void } | null;
  /** A provider-native subagent: the server rejects messages, so the card shows status instead. */
  readonly readOnly?: boolean;
}) {
  const navigate = useNavigate();
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const project = useProject(scopeProjectRef(thread.environmentId, thread.projectId));
  const localLastVisitedAt = useUiStateStore(
    (state) => state.threadLastVisitedAtById[scopedThreadKey(threadRef)],
  );
  const status = resolveThreadStatusPill({
    thread: {
      ...thread,
      lastVisitedAt: resolveThreadLastVisitedAt(thread.lastVisitedAt, localLastVisitedAt),
    },
  });
  const routeParams = buildThreadRouteParams(threadRef);
  const subtitle = [project?.title, thread.branch].filter(Boolean).join(" · ");

  return (
    <section
      aria-label={thread.title}
      data-home-card=""
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card text-card-foreground shadow-xs"
    >
      <div className={cn("flex items-center gap-3 px-4 py-3", !collapsed && "border-b")}>
        {project ? <ProjectFavicon project={project} className="size-5 shrink-0" /> : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <Link
            to="/$environmentId/$threadId"
            params={routeParams}
            className="truncate text-sm font-medium outline-hidden hover:underline focus-visible:underline"
          >
            {thread.title}
          </Link>
          {subtitle ? (
            <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <span className="truncate">{subtitle}</span>
              <ThreadWorktreeIndicator thread={thread} />
            </span>
          ) : null}
        </div>
        {status ? <ThreadStatusLabel status={status} compact /> : null}
        <div className="flex shrink-0 items-center">
          {pin ? (
            <CardIconButton label={pin.pinned ? "Unpin" : "Pin to Home"} onClick={pin.toggle}>
              {pin.pinned ? <PinOffIcon /> : <PinIcon />}
            </CardIconButton>
          ) : null}
          <CardIconButton
            label="Open thread"
            onClick={() => void navigate({ to: "/$environmentId/$threadId", params: routeParams })}
          >
            <SquareArrowOutUpRightIcon />
          </CardIconButton>
          <CardIconButton
            label={collapsed ? "Expand" : "Collapse"}
            ariaExpanded={!collapsed}
            onClick={onToggleCollapsed}
          >
            <ChevronDownIcon className={cn("transition-transform", !collapsed && "rotate-180")} />
          </CardIconButton>
        </div>
      </div>
      <AnimatedHeight>
        {collapsed ? null : (
          <>
            <HomeCardTranscript
              threadRef={threadRef}
              cwd={thread.worktreePath ?? project?.workspaceRoot}
            />
            {readOnly ? (
              <HomeCardProviderSubagentFooter thread={thread} threadRef={threadRef} />
            ) : (
              <HomeCardComposer thread={thread} threadRef={threadRef} />
            )}
          </>
        )}
      </AnimatedHeight>
    </section>
  );
}

function CardIconButton({
  label,
  onClick,
  ariaExpanded,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly ariaExpanded?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-expanded={ariaExpanded}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

function HomeCardTranscript({
  threadRef,
  cwd,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly cwd: string | undefined;
}) {
  const projection = useThreadProjection(threadRef);
  const messages = latestHomeCardMessages(useThreadVisibleTurnItems(threadRef));
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);

  // Markdown and code highlighting settle after layout, so the bottom is tracked by size, not by message.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const content = contentRef.current;
    if (body === null || content === null) return;
    const stickToBottom = () => {
      if (followingRef.current) body.scrollTop = body.scrollHeight;
    };
    stickToBottom();
    return observeResize(content, stickToBottom);
  }, []);

  return (
    <div
      ref={bodyRef}
      onScroll={(event) => {
        const body = event.currentTarget;
        followingRef.current =
          body.scrollHeight - body.scrollTop - body.clientHeight < FOLLOW_LATEST_SLACK_PX;
      }}
      className="h-72 overflow-y-auto overscroll-contain px-4 py-3 scrollbar-gutter-both"
    >
      <div ref={contentRef} className="flex min-h-full flex-col justify-end gap-3">
        {messages.length === 0 ? (
          <p className="m-auto text-sm text-muted-foreground">
            {projection === null ? "Loading…" : "No messages yet"}
          </p>
        ) : (
          messages.map((message) =>
            message.role === "user" ? (
              <div
                key={message.id}
                className="ms-auto max-w-[85%] rounded-2xl bg-message px-3 py-2 text-sm whitespace-pre-wrap wrap-anywhere text-message-foreground"
              >
                {message.text}
              </div>
            ) : (
              <div key={message.id} className="min-w-0 text-sm">
                <ChatMarkdown
                  text={message.text}
                  cwd={cwd}
                  threadRef={threadRef}
                  isStreaming={message.streaming}
                />
              </div>
            ),
          )
        )}
      </div>
    </div>
  );
}

function HomeCardProviderSubagentFooter({
  thread,
  threadRef,
}: {
  readonly thread: EnvironmentThreadShell;
  readonly threadRef: ScopedThreadRef;
}) {
  const projection = useThreadProjection(threadRef)?.projection ?? null;
  const status = projection === null ? null : deriveProviderSubagentStatus(projection);
  // Without a start time the label stays static; a ticking timer per card is not worth the repaints.
  const statusLabel = formatProviderSubagentStatus(
    status === null ? null : { ...status, startedAt: null },
    0,
  );
  return (
    <div className="flex items-center gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
      <BotIcon className="size-3.5 shrink-0" />
      <span className="truncate">
        {statusLabel} · {thread.modelSelection.model}
      </span>
      <span className="ms-auto shrink-0">Run by the provider; reply in the parent</span>
    </div>
  );
}

function HomeCardComposer({
  thread,
  threadRef,
}: {
  readonly thread: EnvironmentThreadShell;
  readonly threadRef: ScopedThreadRef;
}) {
  // The thread's own draft: text typed here is waiting in the composer when the thread opens.
  const prompt = useComposerThreadDraft(threadRef).prompt;
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);
  const canOperate = useEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope);
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const [sending, setSending] = useState(false);

  const send = async () => {
    const text = prompt.trim();
    if (text.length === 0 || sending) return;
    setSending(true);
    setPrompt(threadRef, "");
    // "auto" dispatch steers or queues behind a running turn, as the thread's own composer does.
    const result = await startTurn({
      environmentId: thread.environmentId,
      input: {
        threadId: thread.id,
        message: { messageId: newMessageId(), role: "user", text, attachments: [] },
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
      },
    });
    setSending(false);
    if (result._tag === "Success") return;
    // Put the text back unless something new was typed meanwhile.
    if (useComposerDraftStore.getState().getComposerDraft(threadRef)?.prompt.length === 0) {
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

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send();
  };

  return (
    <div className="flex items-end gap-2 border-t px-3 py-3">
      <Textarea
        size="sm"
        rows={1}
        value={prompt}
        disabled={!canOperate}
        placeholder={
          canOperate ? `Reply to ${thread.title}` : "This connection can't send messages"
        }
        aria-label={`Reply to ${thread.title}`}
        onChange={(event) => setPrompt(threadRef, event.target.value)}
        onKeyDown={onKeyDown}
      />
      <Button
        size="icon"
        aria-label="Send"
        disabled={!canOperate || sending || prompt.trim().length === 0}
        onClick={() => void send()}
      >
        <ArrowUpIcon />
      </Button>
    </div>
  );
}
