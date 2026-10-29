import {
  useEffect,
  useEffectEvent,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import type { PainterroExportableImage, PainterroInstance } from "painterro";

import { isEditableFocused } from "../../lib/editableFocus";
import { cn } from "../../lib/utils";
import { Empty, EmptyDescription } from "../ui/empty";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";

export interface ImageAnnotationEditorHandle {
  save: () => void;
  hasUnsavedChanges: () => boolean;
}

// Leaves select, crop, arrow, rect, brush, text, undo and redo; Save lives beside the preview.
const PAINTERRO_HIDDEN_TOOLS = [
  "pixelize",
  "line",
  "filters",
  "ellipse",
  "eraser",
  "rotate",
  "resize",
  "settings",
  "zoomout",
  "zoomin",
  "bucket",
  "clear",
  "save",
  "open",
  "close",
];

// Painterro injects these into a global <style>, so theme variables track light/dark live.
const PAINTERRO_COLOR_SCHEME = {
  main: "var(--background)",
  control: "var(--accent)",
  controlShadow: "none",
  controlContent: "var(--muted-foreground)",
  hoverControl: "var(--border)",
  hoverControlContent: "var(--foreground)",
  activeControl: "color-mix(in srgb, var(--primary) 16%, transparent)",
  activeControlContent: "var(--primary)",
  inputBorderColor: "transparent",
  inputBackground: "var(--accent)",
  inputShadow: "none",
  inputText: "var(--foreground)",
  backgroundColor: "var(--accent)",
  dragOverBarColor: "var(--primary)",
  toolControlNameColor: "transparent",
};

// Painterro has no options for these: rounded controls, and no one-letter labels, toggles, fill swatch or size readout.
const PAINTERRO_HOLDER_CLASS_NAME =
  "absolute inset-0 [&_.ptro-color-control]:rounded-lg [&_.ptro-input]:rounded-lg [&_.ptro-btn-color-checkers-bar]:hidden [&_.ptro-tool-ctl-name]:hidden [&_.ptro-check]:hidden! [&_[data-id=fill]]:hidden [&_.ptro-info]:hidden";

/** Painterro editor behind the expanded preview, imported lazily so its chunk loads only on edit. */
export function ImageAnnotationEditor({
  src,
  name,
  onApply,
  ref,
}: {
  src: string;
  name: string;
  onApply: (file: File) => void;
  ref?: Ref<ImageAnnotationEditorHandle>;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const holderId = `painterro-holder-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const editorRef = useRef<PainterroInstance | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      save() {
        if (status === "ready") editorRef.current?.save();
      },
      hasUnsavedChanges() {
        return (editorRef.current?.worklog.current?.prevCount ?? 0) > 0;
      },
    }),
    [status],
  );

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
          toolbarHeightPx: 48,
          buttonSizePx: 32,
          hiddenTools: PAINTERRO_HIDDEN_TOOLS,
          activeColor: "#f43f5e",
          defaultPrimitiveShadowOn: false,
          defaultTextStrokeAndShadow: false,
          colorScheme: PAINTERRO_COLOR_SCHEME,
          saveHandler: (image, done) => void saveEditedImage(image, done),
          onImageLoaded: () => setStatus("ready"),
          onImageFailedOpen: () => setStatus("failed"),
        });
        editorRef.current = editor;
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
      editorRef.current = null;
      document.removeEventListener("keydown", undoWithCommandKey);
    };
  }, [src, holderId]);

  // The holder stays mounted: Painterro resolves its `id` when it is created.
  return (
    <div className="relative h-[min(var(--media-height),44rem)] w-[min(var(--media-width),52rem)] overflow-hidden rounded-2xl bg-background">
      <div
        id={holderId}
        className={cn(PAINTERRO_HOLDER_CLASS_NAME, status !== "ready" && "invisible")}
      />
      {status !== "ready" ? (
        <Empty className="absolute inset-0 z-10">
          {status === "loading" ? (
            <Spinner size="lg" tone="muted" />
          ) : (
            <EmptyDescription role="alert">
              This image could not be loaded for editing.
            </EmptyDescription>
          )}
        </Empty>
      ) : null}
    </div>
  );
}
