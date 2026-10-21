import type { ComponentProps } from "react";

import { cn } from "~/lib/utils";

/** The composer's round send key, for surfaces that send a prompt without the full composer. */
export function ComposerSendButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="composer-send-button"
      className={cn(
        "relative isolate flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-message-action text-message-action-foreground shadow-xs transition-all duration-150 enabled:cursor-pointer enabled:inset-shadow-control-highlight enabled:shadow-message-action/24 hover:scale-105 hover:bg-message-action-hover active:inset-shadow-control-pressed active:shadow-none disabled:pointer-events-none disabled:opacity-64 disabled:shadow-none disabled:hover:scale-100 [&_svg]:pointer-events-none",
        className,
      )}
      {...props}
    />
  );
}
