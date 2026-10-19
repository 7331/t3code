import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";

const state = vi.hoisted(() => ({ providers: [] as ServerProvider[] }));
vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: () => state.providers,
}));
vi.mock("../../state/server", () => ({ primaryServerProvidersAtom: {} }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

const checkedAt = "2026-10-19T03:00:00.000Z";
const finishedAt = "2026-10-19T04:00:00.000Z";

function provider(status?: "running" | "succeeded" | "failed"): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("claude"),
    driver: ProviderDriverKind.make("claudeAgent"),
    enabled: true,
    installed: true,
    version: "2.1.303",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    ...(status
      ? {
          updateState: {
            status,
            startedAt: checkedAt,
            finishedAt: status === "running" ? null : finishedAt,
            message: status === "failed" ? "Update failed." : "Provider updated.",
            output: null,
          },
        }
      : {}),
  };
}

let root: Root;
let container: HTMLDivElement;
const render = (providers: ServerProvider[]) => {
  state.providers = providers;
  act(() => root.render(<SidebarProviderUpdatePill />));
};
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  render([provider("running")]);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("provider update notice exit", () => {
  it("replaces a completed update and dismisses success when no transitionend arrives", () => {
    expect(container.textContent).toContain("Updating Claude");
    expect(container.querySelector('[role="status"]')).not.toBeNull();

    // A skipped/cancelled transition has no transitionend to advance the notice.
    render([provider("succeeded")]);
    advance(180);
    expect(container.textContent).toContain("Claude updated: v2.1.303");
    expect(container.querySelector('[role="status"]')).toBeNull();

    advance(3_000);
    advance(180);
    expect(container.textContent).toBe("");
    render([provider("succeeded")]);
    expect(container.textContent).toBe("");
  });

  it("unmounts a cleared loading notice without a transitionend", () => {
    render([provider()]);
    advance(180);
    expect(container.textContent).toBe("");
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("keeps a failure visible until dismissed, then removes it without a transitionend", () => {
    render([provider("failed")]);
    advance(180);
    expect(container.textContent).toContain("Claude update failed");
    advance(5_000);
    expect(container.textContent).toContain("Claude update failed");
    const dismiss = container.querySelector<HTMLButtonElement>(
      '[aria-label="Dismiss provider update notice"]',
    );
    expect(dismiss).not.toBeNull();
    act(() => dismiss!.click());
    advance(180);
    expect(container.textContent).toBe("");
  });
});
