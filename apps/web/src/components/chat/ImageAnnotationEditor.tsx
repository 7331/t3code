import { useEffect, useEffectEvent, useId, useState } from "react";
import type { PainterroExportableImage, PainterroInstance } from "painterro";

import { isEditableFocused } from "../../lib/editableFocus";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Empty, EmptyDescription } from "../ui/empty";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";

/** Painterro editor behind the expanded preview, imported lazily so its chunk loads only on edit. */
export function ImageAnnotationEditor({
  src,
  name,
  onCancel,
  onApply,
}: {
  src: string;
  name: string;
  onCancel: () => void;
  onApply: (file: File) => void;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const holderId = `painterro-holder-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const saveEditedImage = useEffectEvent(
    async (image: PainterroExportableImage, done: (saved: boolean) => void) => {
      try {
        const blob = await image.asBlob("image/png");
        const stem = name.replace(/(-edited)?(\.[A-Za-z0-9]+)?$/, "") || "image";
        onApply(new File([blob], `${stem}-edited.png`, { type: "image/png" }));
        done(true);
      } catch (cause) {
        toastManager.add({
          type: "error",
          title: "Could not save the edited image",
          description: cause instanceof Error ? cause.message : "Please try again.",
        });
        done(false);
      }
    },
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mounts an external Painterro instance into the holder for this component's lifetime
  useEffect(() => {
    let cancelled = false;
    let editor: PainterroInstance | null = null;
    // Painterro only checks ctrlKey, so map Cmd+Z / Cmd+Shift+Z for Mac.
    const undoWithCommandKey = (event: KeyboardEvent) => {
      if (!event.metaKey || event.key.toLowerCase() !== "z" || isEditableFocused(event.target))
        return;
      event.preventDefault();
      if (event.shiftKey) editor?.worklog.redoState();
      else editor?.worklog.undoState();
    };
    import("painterro").then(
      ({ default: painterroExport }) => {
        if (cancelled) return;
        // `type: module` gives the prod build node-mode CJS interop, nesting the factory one level deeper than dev.
        const createPainterro =
          typeof painterroExport === "function" ? painterroExport : painterroExport.default;
        editor = createPainterro({
          id: holderId,
          defaultTool: "arrow",
          toolbarPosition: "top",
          // The full toolbar overflows the dialog and clips Save; keep the markup tools.
          hiddenTools: [
            "open",
            "close",
            "select",
            "pixelize",
            "filters",
            "rotate",
            "resize",
            "settings",
            "zoomin",
            "zoomout",
            "bucket",
          ],
          saveHandler: (image, done) => void saveEditedImage(image, done),
          onImageLoaded: () => setStatus("ready"),
          onImageFailedOpen: () => setStatus("failed"),
        });
        editor.show(src);
        document.addEventListener("keydown", undoWithCommandKey);
      },
      () => {
        if (!cancelled) setStatus("failed");
      },
    );
    return () => {
      cancelled = true;
      editor?.hide();
      document.removeEventListener("keydown", undoWithCommandKey);
    };
  }, [src, holderId]);

  // The holder stays mounted: Painterro resolves its `id` when it is created.
  return (
    <div className="relative h-[min(var(--media-height),44rem)] w-[min(var(--media-width),52rem)] overflow-hidden rounded-lg bg-background shadow-2xl ring-1 ring-border/70">
      <div id={holderId} className={cn("absolute inset-0", status !== "ready" && "invisible")} />
      {status !== "ready" ? (
        <Empty className="absolute inset-0 z-10">
          {status === "loading" ? (
            <Spinner size="lg" tone="muted" />
          ) : (
            <>
              <EmptyDescription role="alert">
                This image could not be loaded for editing.
              </EmptyDescription>
              <Button variant="outline" size="sm" onClick={onCancel}>
                Back to preview
              </Button>
            </>
          )}
        </Empty>
      ) : null}
    </div>
  );
}
