import { CodeIcon, WorkflowIcon } from "lucide-react";
import { Suspense, use, useState, type ReactNode } from "react";

import { RenderErrorBoundary } from "../RenderErrorBoundary";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { MarkdownCodeBlock, type MarkdownCodeBlockLanguagePicker } from "./MarkdownCodeBlock";
import { findRevealRef, MarkdownFindContext } from "./markdownFindContext";
import { MermaidDiagram } from "./MermaidDiagram";

export function MarkdownMermaidCodeBlock({
  code,
  fenceTitle,
  theme,
  isStreaming,
  languagePicker,
  onExpand,
  children,
}: {
  code: string;
  fenceTitle: string | null;
  theme: "light" | "dark";
  isStreaming: boolean;
  /** Lets the reader retag a fence that was wrongly marked as a diagram. */
  languagePicker?: MarkdownCodeBlockLanguagePicker | undefined;
  onExpand: (imageUrl: string) => void;
  children: ReactNode;
}) {
  const [showCode, setShowCode] = useState(false);
  const searching = use(MarkdownFindContext);
  const revealSource = () => setShowCode(true);
  const sourceRevealRef = findRevealRef(revealSource);
  const showDiagram = !showCode && !isStreaming && code.trim().length > 0;
  const toggleLabel = showCode ? "Show diagram" : "Show code";
  return (
    <MarkdownCodeBlock
      code={code}
      language="mermaid"
      fenceTitle={fenceTitle}
      theme={theme}
      isStreaming={isStreaming}
      languagePicker={languagePicker}
      canWrap={!showDiagram}
      diagram={showDiagram}
      viewToggle={
        isStreaming ? null : (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost-muted"
                  size="icon-xs"
                  onClick={() => setShowCode((value) => !value)}
                  aria-label={toggleLabel}
                />
              }
            >
              {showCode ? <WorkflowIcon className="size-3" /> : <CodeIcon className="size-3" />}
            </TooltipTrigger>
            <TooltipPopup side="top">{toggleLabel}</TooltipPopup>
          </Tooltip>
        )
      }
    >
      {showDiagram ? (
        <RenderErrorBoundary resetKeys={[code, theme]} fallback={children}>
          <Suspense
            fallback={
              <pre className="invisible" aria-hidden>
                {code}
              </pre>
            }
          >
            <MermaidDiagram source={code} onExpand={onExpand} />
          </Suspense>
          {searching ? (
            <pre ref={sourceRevealRef} hidden aria-hidden>
              {code}
            </pre>
          ) : null}
        </RenderErrorBoundary>
      ) : (
        children
      )}
    </MarkdownCodeBlock>
  );
}
