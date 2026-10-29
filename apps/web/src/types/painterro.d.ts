// Painterro ships no types; this covers what ImageAnnotationEditor uses (github.com/devforth/painterro).
declare module "painterro" {
  export interface PainterroExportableImage {
    asBlob(mimeType?: string): Promise<Blob>;
  }

  export interface PainterroInstance {
    show(openImage: string): void;
    hide(): void;
    save(): void;
    /** Internal undo history; Painterro has no public undo API. */
    worklog: {
      undoState(): void;
      redoState(): void;
      current: { prevCount: number } | null;
    };
  }

  type PainterroFactory = (options: {
    id: string;
    defaultTool: string;
    toolbarPosition: "top" | "bottom";
    toolbarHeightPx: number;
    buttonSizePx: number;
    hiddenTools: string[];
    activeColor: string;
    defaultPrimitiveShadowOn: boolean;
    defaultTextStrokeAndShadow: boolean;
    colorScheme: Partial<
      Record<
        | "main"
        | "control"
        | "controlShadow"
        | "controlContent"
        | "hoverControl"
        | "hoverControlContent"
        | "activeControl"
        | "activeControlContent"
        | "inputBorderColor"
        | "inputBackground"
        | "inputShadow"
        | "inputText"
        | "backgroundColor"
        | "dragOverBarColor"
        | "toolControlNameColor",
        string
      >
    >;
    saveHandler: (image: PainterroExportableImage, done: (saved: boolean) => void) => void;
    onImageLoaded: () => void;
    onImageFailedOpen: () => void;
  }) => PainterroInstance;

  const painterroExport: PainterroFactory | { default: PainterroFactory };
  export default painterroExport;
}
