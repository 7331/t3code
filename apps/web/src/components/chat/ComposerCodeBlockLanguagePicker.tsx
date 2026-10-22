import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useState } from "react";

import {
  type CodeBlockLanguage,
  codeBlockLanguageItems,
  codeLanguageEntry,
  codeLanguageLabel,
} from "~/composer-code-languages";
import { syntheticFileNameForLanguageId } from "~/pierre-icons";

import { Button } from "../ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
} from "../ui/combobox";
import { PierreEntryIcon } from "./PierreEntryIcon";

function LanguageIcon(props: { language: string; theme: "light" | "dark" }) {
  const fileName = props.language ? syntheticFileNameForLanguageId(props.language) : "file.txt";
  return (
    <PierreEntryIcon pathValue={fileName} kind="file" theme={props.theme} className="size-3.5" />
  );
}

/** A code block's language control: an icon and label that open a searchable language list. */
export function ComposerCodeBlockLanguagePicker(props: {
  language: string;
  theme: "light" | "dark";
  disabled: boolean;
  /** The fence's own language, kept in the list after the reader picks another. */
  originalLanguage?: string;
  /** Hides the chevron until the surrounding code block is hovered or focused. */
  quietChevron?: boolean;
  /**
   * Renders only the trigger until first opened. A chat thread can hold hundreds of code blocks
   * and few readers open any, so the combobox and its list mount on demand.
   */
  lazy?: boolean;
  onChange: (language: string) => void;
}) {
  const [activated, setActivated] = useState(!props.lazy);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const current = codeLanguageEntry(props.language)?.id ?? props.language;
  const label = codeLanguageLabel(props.language);
  const triggerContent = (
    <>
      <LanguageIcon language={current} theme={props.theme} />
      <span className="max-w-40 truncate">{label}</span>
      <ChevronDownIcon
        className={
          props.quietChevron
            ? "opacity-0 pointer-coarse:opacity-60 group-focus-within/codeblock:opacity-60 group-hover/codeblock:opacity-60"
            : "opacity-60"
        }
      />
    </>
  );
  const trigger = (
    <Button
      type="button"
      variant="ghost-muted"
      size="xs"
      disabled={props.disabled}
      aria-label={`Code language: ${label}`}
    />
  );

  if (!activated) {
    return (
      <span className="-ml-1.5 flex min-w-0">
        <Button
          type="button"
          variant="ghost-muted"
          size="xs"
          disabled={props.disabled}
          aria-label={`Code language: ${label}`}
          onClick={() => {
            setActivated(true);
            setOpen(true);
          }}
        >
          {triggerContent}
        </Button>
      </span>
    );
  }

  const items = codeBlockLanguageItems(current, props.originalLanguage);
  const needle = query.trim().toLowerCase();
  const filteredItems = needle
    ? items.filter(
        (entry) => entry.label.toLowerCase().includes(needle) || entry.id.includes(needle),
      )
    : items;
  const selected = items.find((entry) => entry.id === current) ?? null;

  return (
    <span className="-ml-1.5 flex min-w-0">
      <Combobox
        items={items}
        filteredItems={filteredItems}
        autoHighlight
        open={open}
        itemToStringLabel={(entry) => entry.label}
        isItemEqualToValue={(a, b) => a.id === b.id}
        value={selected}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setQuery("");
        }}
        onValueChange={(entry) => {
          if (entry && entry.id !== current) props.onChange(entry.id);
        }}
      >
        <ComboboxTrigger render={trigger}>{triggerContent}</ComboboxTrigger>
        <ComboboxPopup align="start" className="w-56">
          <ComboboxSearchInput
            aria-label="Search languages"
            placeholder="Search languages"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ComboboxEmpty>No matching languages.</ComboboxEmpty>
          <ComboboxList>
            {(entry: CodeBlockLanguage) => (
              <ComboboxItem key={entry.id || "plain"} value={entry}>
                <LanguageIcon language={entry.id} theme={props.theme} />
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                {entry.id === current ? <CheckIcon className="ml-auto" /> : null}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxPopup>
      </Combobox>
    </span>
  );
}
