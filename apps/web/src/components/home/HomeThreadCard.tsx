import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  deriveProviderSubagentStatus,
  formatProviderSubagentStatus,
} from "@t3tools/client-runtime/state/thread-execution";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  BotIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  CircleDotIcon,
  PinIcon,
  PinOffIcon,
  SquareArrowOutUpRightIcon,
} from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import { useProject, useThreadProjection, useThreadVisibleTurnItems } from "../../state/entities";
import { buildThreadRouteParams } from "../../threadRoutes";
import { useUiStateStore } from "~/uiStateStore";
import { AnimatedHeight } from "../AnimatedHeight";
import ChatMarkdown from "../ChatMarkdown";
import { ProjectFavicon } from "../ProjectFavicon";
import { resolveThreadLastVisitedAt, resolveThreadStatusPill } from "../Sidebar.logic";
import { ThreadStatusLabel, ThreadWorktreeIndicator } from "../ThreadStatusIndicators";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { HomeCardComposer } from "./HomeCardComposer";
import { threadRelationshipStatusLabel } from "../chat/ThreadRelationshipIcon";
import { latestHomeCardMessages } from "./homeThreads.logic";
import { subagentStatusTone } from "./subagentBoard.logic";

interface CardToggle {
  readonly active: boolean;
  readonly toggle: () => void;
}

/** One thread on Home: its header, its latest messages, and a quick reply into its shared draft. */
export function HomeThreadCard({
  thread,
  title: titleOverride,
  collapsed,
  onToggleCollapsed,
  pin,
  settle,
  readOnly = false,
  replyHint = null,
  subagentStatus,
}: {
  readonly thread: EnvironmentThreadShell;
  /** Overrides the thread title, e.g. with a subagent's display name. */
  readonly title?: string;
  readonly collapsed: boolean;
  readonly onToggleCollapsed: () => void;
  /** Absent when the thread's environment cannot pin. */
  readonly pin: CardToggle | null;
  /** Absent when the thread's environment cannot settle threads. */
  readonly settle: CardToggle | null;
  /** A provider-native subagent: the server rejects messages, so the card shows status instead. */
  readonly readOnly?: boolean;
  /** A line under the reply field saying where the reply goes. */
  readonly replyHint?: string | null;
  /** A subagent's own status, shown instead of the thread's sidebar status. */
  readonly subagentStatus?: string | null;
}) {
  const title = titleOverride ?? thread.title;
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
  const subtitle = [project?.title, thread.branch, thread.modelSelection.model]
    .filter(Boolean)
    .join(" · ");
  const cwd = thread.worktreePath ?? project?.workspaceRoot ?? null;

  return (
    <section
      aria-label={title}
      data-home-card=""
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card text-card-foreground shadow-xs"
    >
      <div className={cn("flex items-center gap-3 px-4 py-3", !collapsed && "border-b")}>
        {project ? <ProjectFavicon project={project} className="size-5 shrink-0" /> : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              to="/$environmentId/$threadId"
              params={routeParams}
              className="truncate text-sm font-medium outline-hidden hover:underline focus-visible:underline"
            >
              {title}
            </Link>
            {subagentStatus !== undefined ? (
              <SubagentStatusLabel status={subagentStatus} />
            ) : status ? (
              // Several cards can be working at once; a still dot keeps Home from repainting.
              <ThreadStatusLabel status={{ ...status, pulse: false }} />
            ) : null}
          </div>
          {/* Always one line tall, so cards keep their height when a subtitle part is missing. */}
          <span className="flex h-4 min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <span className="truncate">{subtitle}</span>
            <ThreadWorktreeIndicator thread={thread} />
          </span>
        </div>
        <div className="flex shrink-0 items-center">
          {settle ? (
            <CardIconButton label={settle.active ? "Unsettle" : "Settle"} onClick={settle.toggle}>
              {settle.active ? <CircleDotIcon /> : <CircleCheckIcon />}
            </CardIconButton>
          ) : null}
          {pin ? (
            <CardIconButton label={pin.active ? "Unpin" : "Pin to Home"} onClick={pin.toggle}>
              {pin.active ? <PinOffIcon /> : <PinIcon />}
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
            <HomeCardTranscript threadRef={threadRef} cwd={cwd ?? undefined} />
            {readOnly ? (
              <HomeCardProviderSubagentFooter thread={thread} threadRef={threadRef} />
            ) : (
              <HomeCardComposer thread={thread} threadRef={threadRef} cwd={cwd} hint={replyHint} />
            )}
          </>
        )}
      </AnimatedHeight>
    </section>
  );
}

const SUBAGENT_TONE_CLASSES = {
  active: { text: "text-sky-600 dark:text-sky-300/80", dot: "bg-sky-500 dark:bg-sky-300/80" },
  done: {
    text: "text-emerald-600 dark:text-emerald-300/90",
    dot: "bg-emerald-500 dark:bg-emerald-300/90",
  },
  failed: { text: "text-red-600 dark:text-red-300/90", dot: "bg-red-500 dark:bg-red-300/90" },
  muted: { text: "text-muted-foreground", dot: "bg-muted-foreground" },
} as const;

/** The Lineage panel's word for a subagent's status, with a still dot in the sidebar's colours. */
function SubagentStatusLabel({ status }: { readonly status: string | null }) {
  const tone = SUBAGENT_TONE_CLASSES[subagentStatusTone(status)];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 text-3xs", tone.text)}>
      <span className={cn("size-1.5 rounded-full", tone.dot)} />
      {threadRelationshipStatusLabel(status)}
    </span>
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

/**
 * The latest messages, newest against the reply field. The body never scrolls, so the wheel always
 * moves the page; older messages fade out at the top and the thread is one click away.
 */
function HomeCardTranscript({
  threadRef,
  cwd,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly cwd: string | undefined;
}) {
  const projection = useThreadProjection(threadRef);
  const messages = latestHomeCardMessages(useThreadVisibleTurnItems(threadRef));
  if (messages.length === 0) {
    return (
      <p className="px-4 py-3 text-sm text-muted-foreground">
        {projection === null ? "Loading…" : "No messages yet"}
      </p>
    );
  }
  return <HomeCardMessages threadRef={threadRef} cwd={cwd} messages={messages} />;
}

function HomeCardMessages({
  threadRef,
  cwd,
  messages,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly cwd: string | undefined;
  readonly messages: ReturnType<typeof latestHomeCardMessages>;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    const content = contentRef.current;
    if (body === null || content === null) return;
    const measure = () => setClipped(content.offsetHeight > body.clientHeight);
    measure();
    return observeResize([body, content], measure);
  }, []);

  return (
    <div
      ref={bodyRef}
      className={cn(
        "flex max-h-72 flex-col justify-end overflow-hidden px-4 py-3",
        clipped && "[mask-image:linear-gradient(to_bottom,transparent,black_4rem)]",
      )}
    >
      <div ref={contentRef} className="flex shrink-0 flex-col gap-3">
        {messages.map((message) =>
          message.role === "user" ? (
            <div
              key={message.id}
              className="ms-auto max-w-[85%] rounded-2xl bg-message px-3 py-2 text-sm wrap-anywhere text-message-foreground"
            >
              {/* File links and mentions read as chips, as they do in the thread. */}
              <ChatMarkdown text={message.text} cwd={cwd} threadRef={threadRef} lineBreaks />
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
