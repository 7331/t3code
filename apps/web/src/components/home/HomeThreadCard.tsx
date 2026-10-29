import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import {
  type EnvironmentThreadShell,
  threadRuntimeIsActive,
} from "@t3tools/client-runtime/state/models";
import {
  deriveProviderSubagentStatus,
  formatProviderSubagentStatus,
} from "@t3tools/client-runtime/state/thread-execution";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  BrainIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  CircleDotIcon,
  EllipsisIcon,
  PinIcon,
  PinOffIcon,
  SquareArrowOutUpRightIcon,
  WrenchIcon,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import type { ProviderInstanceEntry } from "../../providerInstances";
import {
  useProject,
  useQuietThreadProjection,
  useThreadVisibleTurnItems,
} from "../../state/entities";
import { buildThreadRouteParams } from "../../threadRoutes";
import { useUiStateStore } from "~/uiStateStore";
import { AnimatedHeight } from "../AnimatedHeight";
import ChatMarkdown from "../ChatMarkdown";
import { ProjectFavicon } from "../ProjectFavicon";
import {
  hasUnseenCompletion,
  resolveSidebarRowStatus,
  resolveSidebarThreadStatus,
  resolveThreadLastVisitedAt,
} from "../Sidebar.logic";
import { TopStatusIcon } from "../sidebar/SidebarThreadRow";
import { ThreadWorktreeIndicator } from "../ThreadStatusIndicators";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { HomeCardComposer } from "./HomeCardComposer";
import { threadRelationshipStatusLabel } from "../chat/ThreadRelationshipIcon";
import {
  type HomeCardRow,
  homeCardActivityLabel,
  homeCardSubtitle,
  latestHomeCardRows,
} from "./homeThreads.logic";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { subagentStatusTone } from "./subagentBoard.logic";

interface CardToggle {
  readonly active: boolean;
  readonly toggle: () => void;
}

/** One thread on Home: its header, its latest messages, and a quick reply into its shared draft. */
export function HomeThreadCard({
  thread,
  providerEntry,
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
  readonly providerEntry: ProviderInstanceEntry | null;
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
  // The sidebar row's own wording; snooze wake-ups ("Woke") stay a sidebar affordance.
  const status = resolveSidebarRowStatus({
    status: resolveSidebarThreadStatus(thread),
    goalActive: thread.goal?.status === "active",
    isWoke: false,
    isUnread: hasUnseenCompletion({
      ...thread,
      lastVisitedAt: resolveThreadLastVisitedAt(thread.lastVisitedAt, localLastVisitedAt),
    }),
  });
  const routeParams = buildThreadRouteParams(threadRef);
  const subtitle = homeCardSubtitle({ projectTitle: project?.title, branch: thread.branch });
  const cwd = thread.worktreePath ?? project?.workspaceRoot ?? null;

  return (
    // Set apart from the page by tone alone; no border or shadow.
    <section
      aria-label={title}
      data-home-card=""
      className="flex min-w-0 flex-col overflow-hidden rounded-2xl bg-card text-card-foreground"
    >
      <div className="flex items-center gap-3 px-5 py-4">
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
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 text-xs font-medium",
                  status.className,
                )}
              >
                <TopStatusIcon icon={status.icon} className="size-3.5" />
                {status.label}
              </span>
            ) : null}
          </div>
          {/* Always one line tall, so cards keep their height when a subtitle part is missing. */}
          <span className="flex h-4 min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <HomeCardAgentEmblem providerEntry={providerEntry} />
            <span className="truncate">{subtitle}</span>
            <ThreadWorktreeIndicator thread={thread} />
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Menu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <MenuTrigger
                    render={
                      <Button variant="ghost-muted" size="icon-sm" aria-label="More actions" />
                    }
                  />
                }
              >
                <EllipsisIcon />
              </TooltipTrigger>
              <TooltipPopup side="top">More actions</TooltipPopup>
            </Tooltip>
            <MenuPopup align="end">
              <MenuItem
                onClick={() =>
                  void navigate({ to: "/$environmentId/$threadId", params: routeParams })
                }
              >
                <SquareArrowOutUpRightIcon />
                Open thread
              </MenuItem>
              {settle ? (
                <MenuItem onClick={settle.toggle}>
                  {settle.active ? <CircleDotIcon /> : <CircleCheckIcon />}
                  {settle.active ? "Unsettle" : "Settle"}
                </MenuItem>
              ) : null}
              {pin ? (
                <MenuItem onClick={pin.toggle}>
                  {pin.active ? <PinOffIcon /> : <PinIcon />}
                  {pin.active ? "Unpin" : "Pin to Home"}
                </MenuItem>
              ) : null}
            </MenuPopup>
          </Menu>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost-muted"
                  size="icon-sm"
                  aria-label={collapsed ? "Expand" : "Collapse"}
                  aria-expanded={!collapsed}
                  onClick={onToggleCollapsed}
                />
              }
            >
              <ChevronDownIcon className={cn("transition-transform", !collapsed && "rotate-180")} />
            </TooltipTrigger>
            <TooltipPopup side="top">{collapsed ? "Expand" : "Collapse"}</TooltipPopup>
          </Tooltip>
        </div>
      </div>
      <AnimatedHeight>
        {collapsed ? null : (
          <>
            <HomeCardTranscript
              threadRef={threadRef}
              cwd={cwd ?? undefined}
              running={threadRuntimeIsActive(thread.runtime)}
            />
            {readOnly ? (
              <HomeCardProviderSubagentFooter threadRef={threadRef} providerEntry={providerEntry} />
            ) : (
              <HomeCardComposer thread={thread} threadRef={threadRef} hint={replyHint} />
            )}
          </>
        )}
      </AnimatedHeight>
    </section>
  );
}

const SUBAGENT_TONES = {
  active: { icon: "working", className: "text-info-foreground" },
  done: { icon: "done", className: "text-success-foreground" },
  failed: { icon: "failed", className: "text-error-foreground" },
  muted: { icon: "waiting", className: "text-muted-foreground" },
} as const;

/** The Lineage panel's word for a subagent's status, drawn like a sidebar row's status. */
function SubagentStatusLabel({ status }: { readonly status: string | null }) {
  const tone = SUBAGENT_TONES[subagentStatusTone(status)];
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1 text-xs font-medium", tone.className)}
    >
      <TopStatusIcon icon={tone.icon} className="size-3.5" />
      {threadRelationshipStatusLabel(status)}
    </span>
  );
}

/** The agent's logo, as sidebar rows show it. */
function HomeCardAgentEmblem({
  providerEntry,
}: {
  readonly providerEntry: ProviderInstanceEntry | null;
}) {
  if (providerEntry === null) return null;
  const label = providerEntry.displayName;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span role="img" aria-label={label} className="inline-flex shrink-0" />}
      >
        <ProviderInstanceIcon
          driverKind={providerEntry.driverKind}
          displayName={providerEntry.displayName}
          accentColor={providerEntry.accentColor}
          acpRegistryAgentId={providerEntry.acpRegistryAgentId}
          acpRegistryIconUrl={providerEntry.acpRegistryIconUrl}
          size="compact"
        />
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * The latest messages and the agent's work between them, newest against the reply field. The body never scrolls, so the wheel always
 * moves the page; older messages fade out at the top and the thread is one click away.
 */
function HomeCardTranscript({
  threadRef,
  cwd,
  running,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly cwd: string | undefined;
  readonly running: boolean;
}) {
  const projection = useQuietThreadProjection(threadRef);
  const rows = latestHomeCardRows(useThreadVisibleTurnItems(threadRef));
  if (rows.length === 0) {
    return (
      <p className="flex min-h-20 items-center justify-center px-5 pb-4 text-sm text-muted-foreground">
        {projection === null ? "Loading…" : "No messages yet. Send the first one below."}
      </p>
    );
  }
  return <HomeCardMessages threadRef={threadRef} cwd={cwd} rows={rows} running={running} />;
}

function HomeCardMessages({
  threadRef,
  cwd,
  rows,
  running,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly cwd: string | undefined;
  readonly rows: ReadonlyArray<HomeCardRow>;
  readonly running: boolean;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);

  // Keeps the clipped flag in step with the card's own scroll body while mounted.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a ResizeObserver on the card body and content is the measurement's only source
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
        "flex max-h-56 flex-col justify-end overflow-hidden px-5 pb-4",
        clipped && "[mask-image:linear-gradient(to_bottom,transparent,black_4rem)]",
      )}
    >
      <div ref={contentRef} className="flex shrink-0 flex-col gap-3">
        {rows.map((row, index) =>
          row.kind === "activity" ? (
            <HomeCardActivity
              key={row.id}
              row={row}
              live={running && index === rows.length - 1}
              cwd={cwd}
            />
          ) : row.role === "user" ? (
            <div
              key={row.id}
              className="ms-auto max-w-[85%] rounded-2xl bg-message px-3 py-2 text-sm wrap-anywhere text-message-foreground"
            >
              {/* File links and mentions read as chips, as they do in the thread. */}
              <ChatMarkdown text={row.text} cwd={cwd} threadRef={threadRef} lineBreaks />
            </div>
          ) : (
            <div key={row.id} className="min-w-0 text-sm">
              <ChatMarkdown
                text={row.text}
                cwd={cwd}
                threadRef={threadRef}
                isStreaming={row.streaming}
              />
            </div>
          ),
        )}
      </div>
    </div>
  );
}

/** One muted line for a stretch of agent work; the thread's work log has the details. */
function HomeCardActivity({
  row,
  live,
  cwd,
}: {
  readonly row: Extract<HomeCardRow, { kind: "activity" }>;
  readonly live: boolean;
  readonly cwd: string | undefined;
}) {
  const { label, thinking, failed } = homeCardActivityLabel(row.entries, live, cwd);
  const Icon = thinking ? BrainIcon : WrenchIcon;
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <Icon aria-hidden className={cn("size-3.5 shrink-0", failed && "text-error")} />
      <span className="truncate">{label}</span>
    </p>
  );
}

function HomeCardProviderSubagentFooter({
  threadRef,
  providerEntry,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly providerEntry: ProviderInstanceEntry | null;
}) {
  const projection = useQuietThreadProjection(threadRef)?.projection ?? null;
  const status = projection === null ? null : deriveProviderSubagentStatus(projection);
  // Without a start time the label stays static; a ticking timer per card is not worth the repaints.
  const statusLabel = formatProviderSubagentStatus(
    status === null ? null : { ...status, startedAt: null },
    0,
  );
  return (
    <div className="flex items-center gap-2 px-5 pb-4 text-xs text-muted-foreground">
      <HomeCardAgentEmblem providerEntry={providerEntry} />
      <span className="truncate">{statusLabel}</span>
      <span className="ms-auto shrink-0">Run by the provider; reply in the parent</span>
    </div>
  );
}
