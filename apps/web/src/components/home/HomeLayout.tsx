import * as Schema from "effect/Schema";
import type { ReactNode } from "react";

import { isElectron } from "../../env";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn } from "~/lib/utils";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { WorkspaceBreadcrumb } from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";

const COLLAPSED_CARDS_STORAGE_KEY = "t3code:home:collapsed-threads";
const CollapsedCardKeys = Schema.Array(Schema.String);
const NO_COLLAPSED_CARDS: ReadonlyArray<string> = [];

/** Which cards are folded to their header, remembered on this device across Home and boards. */
export function useCollapsedHomeCards() {
  const [collapsedKeys, setCollapsedKeys] = useLocalStorage(
    COLLAPSED_CARDS_STORAGE_KEY,
    NO_COLLAPSED_CARDS,
    CollapsedCardKeys,
  );
  return {
    isCollapsed: (key: string) => collapsedKeys.includes(key),
    toggle: (key: string) =>
      setCollapsedKeys((current) =>
        current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
      ),
  };
}

export function HomePageShell({
  breadcrumbLabel,
  breadcrumb,
  children,
}: {
  readonly breadcrumbLabel: string;
  readonly breadcrumb: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <WorkspaceBreadcrumb ariaLabel={breadcrumbLabel}>{breadcrumb}</WorkspaceBreadcrumb>
        </WorkspacePageHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">{children}</div>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}

export function HomeSectionHeading({
  title,
  description,
}: {
  readonly title: string;
  readonly description?: string | null;
}) {
  return (
    <div className="mb-4 flex flex-col gap-0.5">
      <h2 className="text-sm font-medium">{title}</h2>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
    </div>
  );
}

/** The first card spans the full width, the rest share two columns on wide screens. */
export function HomeCardGrid({
  cards,
}: {
  readonly cards: ReadonlyArray<{ readonly key: string; readonly card: ReactNode }>;
}) {
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
      {cards.map(({ key, card }, index) => (
        <div key={key} className={cn("min-w-0", index === 0 && "lg:col-span-2")}>
          {card}
        </div>
      ))}
    </div>
  );
}
