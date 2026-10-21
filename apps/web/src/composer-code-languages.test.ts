import { describe, expect, it } from "vite-plus/test";

import { CODE_BLOCK_LANGUAGES, codeBlockLanguageItems } from "./composer-code-languages";

describe("codeBlockLanguageItems", () => {
  it("lists only the known languages for a known fence", () => {
    expect(codeBlockLanguageItems("bash", "sh")).toEqual(CODE_BLOCK_LANGUAGES);
  });

  it("keeps an unlisted original language after the reader retags the block", () => {
    const items = codeBlockLanguageItems("bash", "zsh");
    expect(items[0]).toEqual({ id: "zsh", label: "zsh" });
    expect(items.filter((entry) => entry.id === "bash")).toHaveLength(1);
  });

  it("lists an unlisted current language once, ahead of the known ones", () => {
    expect(codeBlockLanguageItems("hcl", "hcl").slice(0, 2)).toEqual([
      { id: "hcl", label: "hcl" },
      CODE_BLOCK_LANGUAGES[0],
    ]);
  });
});
