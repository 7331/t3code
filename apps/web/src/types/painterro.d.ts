// Painterro ships no types; this covers what ImageAnnotationEditor uses (github.com/devforth/painterro).
declare module "painterro" {
  export interface PainterroExportableImage {
    asBlob(mimeType?: string): Promise<Blob>;
  }

  export interface PainterroInstance {
    show(openImage: string): void;
    hide(): void;
    /** Internal undo history; Painterro has no public undo API. */
    worklog: { undoState(): void; redoState(): void };
  }

  type PainterroFactory = (options: {
    id: string;
    defaultTool: string;
    toolbarPosition: "top" | "bottom";
    hiddenTools: string[];
    saveHandler: (image: PainterroExportableImage, done: (saved: boolean) => void) => void;
    onImageLoaded: () => void;
    onImageFailedOpen: () => void;
  }) => PainterroInstance;

  const painterroExport: PainterroFactory | { default: PainterroFactory };
  export default painterroExport;
}
