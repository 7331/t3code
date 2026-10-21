import { ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { describe, expect, it } from "vite-plus/test";

import type { ComposerTrigger } from "../../composer-logic";
import {
  applyHomeCardMenuItem,
  homeCardModelSlug,
  homeCardSendModelSelection,
  stepHomeCardMenuHighlight,
  type HomeCardMenuItem,
} from "./homeCardComposer.logic";

const trigger = (value: string, start: number): ComposerTrigger => ({
  kind: "skill",
  query: value.slice(start + 1),
  rangeStart: start,
  rangeEnd: value.length,
});

describe("applyHomeCardMenuItem", () => {
  it("replaces the typed trigger with the chosen skill and a trailing space", () => {
    const value = "use $fron";
    const item = {
      id: "skill:frontend-design",
      type: "skill",
      skill: { name: "frontend-design" },
    } as unknown as HomeCardMenuItem;

    expect(applyHomeCardMenuItem(value, trigger(value, 4), item)).toEqual({
      text: "use $frontend-design ",
      cursor: "use $frontend-design ".length,
    });
  });

  it("inserts a provider slash command", () => {
    const value = "/rev";
    const item = {
      id: "slash:review",
      type: "provider-slash-command",
      command: { name: "review" },
    } as unknown as HomeCardMenuItem;

    expect(
      applyHomeCardMenuItem(value, { ...trigger(value, 0), kind: "slash-command" }, item).text,
    ).toBe("/review ");
  });
});

describe("stepHomeCardMenuHighlight", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("wraps around both ends", () => {
    expect(stepHomeCardMenuHighlight(items, "c", 1)).toBe("a");
    expect(stepHomeCardMenuHighlight(items, "a", -1)).toBe("c");
  });

  it("starts at the first or last item when nothing is highlighted", () => {
    expect(stepHomeCardMenuHighlight(items, null, 1)).toBe("a");
    expect(stepHomeCardMenuHighlight(items, null, -1)).toBe("c");
    expect(stepHomeCardMenuHighlight([], null, 1)).toBeNull();
  });
});

describe("homeCardSendModelSelection", () => {
  const codex = ProviderInstanceId.make("codex");
  const thread = createModelSelection(codex, "gpt-5.6");

  it("sends nothing without a draft pick, so the server keeps the thread's model", () => {
    expect(homeCardSendModelSelection(thread, undefined)).toBeUndefined();
  });

  it("keeps the draft's options even when the model matches the thread's", () => {
    const sameModelMoreEffort = createModelSelection(codex, "gpt-5.6", [
      { id: "reasoningEffort", value: "high" },
    ]);
    expect(homeCardSendModelSelection(thread, sameModelMoreEffort)).toBe(sameModelMoreEffort);
  });

  it("sends the draft's model for the thread's own provider instance", () => {
    const picked = createModelSelection(codex, "gpt-5.6-mini");
    expect(homeCardSendModelSelection(thread, picked)).toBe(picked);
  });

  it("ignores a draft pick for another provider instance", () => {
    const other = createModelSelection(ProviderInstanceId.make("claudeAgent"), "claude-haiku-5-5");
    expect(homeCardSendModelSelection(thread, other)).toBeUndefined();
  });
});

describe("homeCardModelSlug", () => {
  const codex = ProviderInstanceId.make("codex");
  const thread = createModelSelection(codex, "gpt-6-astra");

  it("names the draft's pick for the thread's instance, which is what the next reply uses", () => {
    expect(homeCardModelSlug(thread, createModelSelection(codex, "gpt-6-luna"))).toBe("gpt-6-luna");
  });

  it("falls back to the thread's model", () => {
    expect(homeCardModelSlug(thread, undefined)).toBe("gpt-6-astra");
    expect(
      homeCardModelSlug(thread, createModelSelection(ProviderInstanceId.make("other"), "x")),
    ).toBe("gpt-6-astra");
  });
});
