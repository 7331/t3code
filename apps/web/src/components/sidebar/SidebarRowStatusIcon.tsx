import {
  AlarmClockIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotDashedIcon,
  MessageCircleQuestionIcon,
  UserRoundIcon,
  ShieldQuestionIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import type { SidebarRowStatusIcon } from "../Sidebar.logic";

const ICONS = {
  working: CircleDashedIcon,
  waiting: CircleDotDashedIcon,
  approval: ShieldQuestionIcon,
  input: MessageCircleQuestionIcon,
  request: UserRoundIcon,
  failed: CircleAlertIcon,
  woke: AlarmClockIcon,
  done: CircleCheckIcon,
} as const;

/** The still glyph beside a thread row's status word. */
export function SidebarRowStatusIconView({
  icon,
  className,
}: {
  readonly icon: SidebarRowStatusIcon;
  readonly className?: string;
}) {
  const Icon = ICONS[icon];
  return <Icon aria-hidden className={cn("size-4 shrink-0", className)} />;
}
