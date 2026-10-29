import { useEffect, useId, useRef, useState } from "react";

import { toastManager } from "../ui/toast";

export function annotatedImageFileName(originalName: string): string {
  const stem = originalName.replace(/\.[A-Za-z0-9]+$/, "");
  return `${stem.length > 0 ? stem : "image"}-edited.png`;
}

/**
 * The image editor behind the expanded preview. Painterro is loaded lazily so
 * its chunk only downloads when an image is actually edited; its own toolbar
 * (arrow, text, shapes, crop, pixelize) replaces any custom tooling here.
 */
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
  // The instance outlives renders; the effect below owns its full lifecycle.
  const editorRef = useRef<import("painterro").PainterroInstance | null>(null);

  // Fetch the bytes into a data URL: Painterro needs an embeddable source, and
  // a fetched copy keeps cross-origin asset URLs out of its loader.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps an external Painterro instance mounted in the holder for exactly this component's lifetime
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(src);
        if (!response.ok) throw new Error("The image could not be loaded.");
        const blob = await response.blob();
        if (cancelled) return;
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error ?? new Error("Read failed."));
          reader.readAsDataURL(blob);
        });
        if (cancelled) return;
        const imported = (await import("painterro")) as unknown as {
          default:
            | typeof import("painterro").default
            | { default?: typeof import("painterro").default };
        };
        // The package ships a webpack commonjs2 build whose factory sits one
        // namespace deeper than the declared default export under some bundlers.
        const createEditor =
          typeof imported.default === "function" ? imported.default : imported.default?.default;
        if (!createEditor) throw new Error("The image editor failed to load.");
        if (cancelled) return;
        const editor = createEditor({
          id: holderId,
          defaultTool: "arrow",
          toolbarPosition: "top",
          // Loading other files and the standalone close button belong to the
          // host dialog, not the editor surface.
          hiddenTools: ["open", "close"],
          saveHandler: (image, done) => {
            void (async () => {
              try {
                const blob = await image.asBlob("image/png");
                onApply(new File([blob], annotatedImageFileName(name), { type: "image/png" }));
                done(true);
              } catch (cause) {
                toastManager.add({
                  type: "error",
                  title: "Could not save the edited image",
                  description: cause instanceof Error ? cause.message : "Please try again.",
                });
                done(false);
              }
            })();
          },
        });
        editorRef.current = editor;
        editor.show(dataUrl);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("failed");
      }
    })();
    return () => {
      cancelled = true;
      editorRef.current?.hide();
      editorRef.current = null;
    };
    // Painterro is created once per mounted editor; name changes remount via key.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [src]);

  // The holder div is always mounted: Painterro resolves its `id` target at
  // construction, before any "ready" state would render it.
  return (
    <div className="relative h-[min(var(--media-height),44rem)] w-[min(var(--media-width),52rem)] overflow-hidden rounded-lg bg-background shadow-2xl ring-1 ring-border/70">
      {/* Painterro positions its toolbar and canvas absolutely inside the holder. */}
      <div id={holderId} className="absolute inset-0" />
      {status !== "ready" ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black p-6 text-center text-sm text-white">
          {status === "failed" ? (
            <p role="alert">This image could not be loaded for editing.</p>
          ) : (
            <p>Loading image for editing…</p>
          )}
          {status === "failed" ? (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md bg-white/10 px-3 py-1.5 text-xs ring-1 ring-white/20 hover:bg-white/20"
            >
              Back to preview
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
