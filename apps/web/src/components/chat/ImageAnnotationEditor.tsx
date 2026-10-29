import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ArrowUpRight, Check, Eraser, Pencil, Square, Undo2, X } from "lucide-react";

import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";

type AnnotationTool = "pen" | "arrow" | "rectangle";

interface AnnotationPoint {
  x: number;
  y: number;
}

/** A stroke in natural-image pixels so the live canvas and the export share one renderer. */
interface AnnotationStroke {
  tool: AnnotationTool;
  color: string;
  width: number;
  points: AnnotationPoint[];
}

const ANNOTATION_TOOLS: ReadonlyArray<{ id: AnnotationTool; label: string; icon: typeof Pencil }> =
  [
    { id: "pen", label: "Pen", icon: Pencil },
    { id: "arrow", label: "Arrow", icon: ArrowUpRight },
    { id: "rectangle", label: "Rectangle", icon: Square },
  ];

const ANNOTATION_COLORS = [
  { name: "Red", value: "#f87171" },
  { name: "Amber", value: "#fbbf24" },
  { name: "Green", value: "#4ade80" },
  { name: "Blue", value: "#60a5fa" },
  { name: "White", value: "#ffffff" },
  { name: "Black", value: "#111111" },
] as const;

/** Stroke widths in CSS pixels on screen, scaled to natural pixels while drawing. */
const ANNOTATION_STROKE_WIDTHS = [3, 6, 12] as const;

export function annotatedImageFileName(originalName: string): string {
  const stem = originalName.replace(/\.[A-Za-z0-9]+$/, "");
  return `${stem.length > 0 ? stem : "image"}-edited.png`;
}

function drawAnnotationStroke(context: CanvasRenderingContext2D, stroke: AnnotationStroke): void {
  const first = stroke.points[0];
  if (!first) return;
  const last = stroke.points[stroke.points.length - 1] ?? first;
  context.save();
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth = stroke.width;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (stroke.tool === "pen") {
    context.beginPath();
    context.moveTo(first.x, first.y);
    for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y);
    context.stroke();
  } else if (stroke.tool === "rectangle") {
    context.strokeRect(
      Math.min(first.x, last.x),
      Math.min(first.y, last.y),
      Math.abs(last.x - first.x),
      Math.abs(last.y - first.y),
    );
  } else {
    context.beginPath();
    context.moveTo(first.x, first.y);
    context.lineTo(last.x, last.y);
    context.stroke();
    // Arrowhead wings sized to the stroke so the head stays visible at any zoom.
    const angle = Math.atan2(last.y - first.y, last.x - first.x);
    const headLength = Math.max(stroke.width * 3, stroke.width + 10);
    for (const offset of [(Math.PI * 2) / 3, -(Math.PI * 2) / 3]) {
      context.beginPath();
      context.moveTo(last.x, last.y);
      context.lineTo(
        last.x + Math.cos(angle + offset) * headLength,
        last.y + Math.sin(angle + offset) * headLength,
      );
      context.stroke();
    }
  }
  context.restore();
}

async function composeAnnotatedImageFile(input: {
  src: string;
  width: number;
  height: number;
  strokes: ReadonlyArray<AnnotationStroke>;
  name: string;
}): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = input.width;
  canvas.height = input.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("A drawing context is unavailable.");
  const image = new Image();
  image.src = input.src;
  await image.decode();
  context.drawImage(image, 0, 0);
  for (const stroke of input.strokes) drawAnnotationStroke(context, stroke);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  if (!blob) throw new Error("The edited image could not be encoded.");
  return new File([blob], annotatedImageFileName(input.name), { type: "image/png" });
}

function redrawAnnotationCanvas(input: {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  size: { width: number; height: number };
  strokes: ReadonlyArray<AnnotationStroke>;
  inProgress: AnnotationStroke | null;
}): void {
  input.context.clearRect(0, 0, input.size.width, input.size.height);
  for (const stroke of input.strokes) drawAnnotationStroke(input.context, stroke);
  if (input.inProgress) drawAnnotationStroke(input.context, input.inProgress);
}

const TOOLBAR_GROUP_DIVIDER = "mx-0.5 h-4 w-px shrink-0 bg-white/15";

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
  const [editableSrc, setEditableSrc] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [strokes, setStrokes] = useState<AnnotationStroke[]>([]);
  const [tool, setTool] = useState<AnnotationTool>("pen");
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0].value);
  const [strokeWidth, setStrokeWidth] = useState<number>(ANNOTATION_STROKE_WIDTHS[1]);
  const [applying, setApplying] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inProgressStrokeRef = useRef<AnnotationStroke | null>(null);

  // The source is fetched into an object URL so the canvas is never tainted by a
  // cross-origin image and the export always reads back cleanly.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const response = await fetch(src);
        if (!response.ok) throw new Error("The image could not be loaded.");
        const blob = await response.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        const image = new Image();
        image.src = objectUrl;
        await image.decode();
        if (cancelled) return;
        setEditableSrc(objectUrl);
        setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("failed");
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  const redrawCanvas = () => {
    const canvas = canvasRef.current;
    const size = naturalSize;
    if (!canvas || !size) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    redrawAnnotationCanvas({
      canvas,
      context,
      size,
      strokes,
      inProgress: inProgressStrokeRef.current,
    });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const size = naturalSize;
    if (!canvas || !size) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    redrawAnnotationCanvas({
      canvas,
      context,
      size,
      strokes,
      inProgress: inProgressStrokeRef.current,
    });
  }, [strokes, naturalSize]);

  const undoLastStroke = () => setStrokes((current) => current.slice(0, -1));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      undoLastStroke();
    }
  };

  const toNaturalPoint = (event: PointerEvent<HTMLCanvasElement>): AnnotationPoint => {
    const canvas = canvasRef.current;
    const size = naturalSize;
    if (!canvas || !size) return { x: 0, y: 0 };
    const bounds = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * size.width,
      y: ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * size.height,
    };
  };

  const naturalStrokeWidth = (): number => {
    const canvas = canvasRef.current;
    const size = naturalSize;
    if (!canvas || !size) return strokeWidth;
    const bounds = canvas.getBoundingClientRect();
    return strokeWidth * (size.width / Math.max(1, bounds.width));
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || applying || status !== "ready") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toNaturalPoint(event);
    inProgressStrokeRef.current = {
      tool,
      color,
      width: naturalStrokeWidth(),
      points: [point, point],
    };
    redrawCanvas();
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const inProgress = inProgressStrokeRef.current;
    if (!inProgress) return;
    const point = toNaturalPoint(event);
    if (inProgress.tool === "pen") {
      const last = inProgress.points[inProgress.points.length - 1];
      // Sub-pixel moves only bloat the stroke list without changing the drawn path.
      if (last && Math.hypot(point.x - last.x, point.y - last.y) < 0.75) return;
      inProgress.points.push(point);
    } else {
      inProgress.points[1] = point;
    }
    redrawCanvas();
  };

  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    const inProgress = inProgressStrokeRef.current;
    if (!inProgress) return;
    inProgressStrokeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const first = inProgress.points[0];
    const last = inProgress.points[inProgress.points.length - 1];
    const isTap =
      inProgress.tool !== "pen" &&
      first !== undefined &&
      last !== undefined &&
      Math.hypot(last.x - first.x, last.y - first.y) < 2;
    if (isTap) {
      // A bare tap on arrow or rectangle leaves no committed stroke; clear its preview.
      redrawCanvas();
      return;
    }
    setStrokes((current) => [...current, inProgress]);
  };

  const applyEdits = () => {
    if (applying || status !== "ready" || !editableSrc || !naturalSize) return;
    setApplying(true);
    void composeAnnotatedImageFile({
      src: editableSrc,
      width: naturalSize.width,
      height: naturalSize.height,
      strokes,
      name,
    })
      .then(onApply)
      .catch((cause: unknown) => {
        toastManager.add({
          type: "error",
          title: "Could not save the edited image",
          description: cause instanceof Error ? cause.message : "Please try again.",
        });
        setApplying(false);
      });
  };

  if (status !== "ready" || !editableSrc || !naturalSize) {
    return (
      <div className="flex aspect-auto h-48 w-[min(var(--media-width),32rem)] flex-col items-center justify-center gap-3 rounded-lg border border-border/70 bg-black p-6 text-center text-sm text-white shadow-2xl">
        {status === "failed" ? (
          <p role="alert">This image could not be loaded for editing.</p>
        ) : (
          <p>Loading image for editing…</p>
        )}
        <Button type="button" size="sm" variant="media-close" onClick={onCancel}>
          Back to preview
        </Button>
      </div>
    );
  }

  return (
    <div className="flex max-h-full flex-col items-center gap-2" onKeyDown={onKeyDown}>
      <div
        role="toolbar"
        aria-label="Image editing tools"
        className="flex max-w-[var(--media-width)] flex-wrap items-center justify-center gap-1 rounded-lg bg-black/75 p-1.5 text-white shadow-2xl ring-1 ring-white/15"
      >
        {ANNOTATION_TOOLS.map(({ id, label, icon: Icon }) => (
          <Tooltip key={id}>
            <TooltipTrigger
              render={
                <Button
                  aria-label={label}
                  aria-pressed={tool === id}
                  onClick={() => setTool(id)}
                  size="icon-micro"
                  variant={tool === id ? "media-close" : "overlay"}
                />
              }
            >
              <Icon className="size-3" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipPopup side="top">{label}</TooltipPopup>
          </Tooltip>
        ))}
        <span aria-hidden="true" className={TOOLBAR_GROUP_DIVIDER} />
        {ANNOTATION_COLORS.map((swatch) => (
          <button
            key={swatch.name}
            type="button"
            aria-label={`${swatch.name} stroke`}
            aria-pressed={color === swatch.value}
            onClick={() => setColor(swatch.value)}
            className={cn(
              "size-4 rounded-full focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white",
              color === swatch.value && "outline-2 -outline-offset-2 outline-white",
            )}
            style={{ backgroundColor: swatch.value }}
          />
        ))}
        <span aria-hidden="true" className={TOOLBAR_GROUP_DIVIDER} />
        {ANNOTATION_STROKE_WIDTHS.map((width, index) => (
          <Tooltip key={width}>
            <TooltipTrigger
              render={
                <Button
                  aria-label={`${["Thin", "Medium", "Thick"][index]} stroke`}
                  aria-pressed={strokeWidth === width}
                  onClick={() => setStrokeWidth(width)}
                  size="icon-micro"
                  variant={strokeWidth === width ? "media-close" : "overlay"}
                />
              }
            >
              <span
                aria-hidden="true"
                className="block rounded-full bg-current"
                style={{ width: index + 1.5, height: index + 1.5 }}
              />
            </TooltipTrigger>
            <TooltipPopup side="top">{["Thin", "Medium", "Thick"][index]} stroke</TooltipPopup>
          </Tooltip>
        ))}
        <span aria-hidden="true" className={TOOLBAR_GROUP_DIVIDER} />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label="Undo stroke"
                disabled={strokes.length === 0}
                onClick={undoLastStroke}
                size="icon-micro"
                variant="overlay"
              />
            }
          >
            <Undo2 className="size-3" aria-hidden="true" />
          </TooltipTrigger>
          <TooltipPopup side="top">Undo stroke</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label="Clear all strokes"
                disabled={strokes.length === 0}
                onClick={() => setStrokes([])}
                size="icon-micro"
                variant="overlay"
              />
            }
          >
            <Eraser className="size-3" aria-hidden="true" />
          </TooltipTrigger>
          <TooltipPopup side="top">Clear all strokes</TooltipPopup>
        </Tooltip>
        <span aria-hidden="true" className={TOOLBAR_GROUP_DIVIDER} />
        <Button
          type="button"
          size="xs"
          variant="media-close"
          disabled={applying}
          onClick={onCancel}
        >
          <X className="size-3.5" aria-hidden="true" />
          Cancel
        </Button>
        <Button type="button" size="xs" disabled={applying} onClick={applyEdits}>
          <Check className="size-3.5" aria-hidden="true" />
          {applying ? "Saving…" : "Save edit"}
        </Button>
      </div>
      <div className="relative inline-block max-h-[var(--media-height)] overflow-hidden rounded-lg bg-background shadow-2xl ring-1 ring-border/70">
        <img
          src={editableSrc}
          alt={name}
          draggable={false}
          className="block max-h-[var(--media-height)] max-w-[var(--media-width)] select-none object-contain"
        />
        <canvas
          ref={canvasRef}
          width={naturalSize.width}
          height={naturalSize.height}
          aria-label={`Drawing surface over ${name}`}
          className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
      <span className="sr-only" aria-live="polite">
        {strokes.length === 0 ? "No edits yet" : `${strokes.length} edits on this image`}
      </span>
    </div>
  );
}
