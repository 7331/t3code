/**
 * Painterro ships no TypeScript declarations; this covers the subset of the
 * documented API (github.com/devforth/painterro, README "API" and
 * "Configuration" tables) that ImageAnnotationEditor uses.
 */
declare module "painterro" {
  export interface PainterroExportableImage {
    asBlob(mimeType?: string): Promise<Blob>;
    suggestedFileName(): string;
  }

  export interface PainterroInstance {
    show(openImage?: string | false, initialMimeType?: string): void;
    hide(): void;
    save(): void;
  }

  export interface PainterroOptions {
    /** Holder element id; without it Painterro mounts a fullscreen overlay. */
    id?: string;
    saveHandler?: (image: PainterroExportableImage, done: (saved: boolean) => void) => void;
    /** Tool ids: crop, line, arrow, rect, ellipse, brush, text, rotate, resize, save, open, close, undo, redo, zoomin, zoomout, bucket, pixelize, settings, eraser. */
    hiddenTools?: string[];
    defaultTool?: string;
    toolbarPosition?: "top" | "bottom";
    defaultSize?: string | "fill";
    language?: string;
    onImageLoaded?: () => void;
    onImageFailedOpen?: () => void;
  }

  export default function Painterro(options?: PainterroOptions): PainterroInstance;
}
