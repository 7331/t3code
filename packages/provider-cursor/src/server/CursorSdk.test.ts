// @effect-diagnostics nodeBuiltinImport:off globalTimers:off -- The probe is a plain Node child; this deadline kills it if it hangs.
import * as NodeChildProcess from "node:child_process";
import { describe, expect, it } from "vite-plus/test";

import { isCursorClosedStreamWrite } from "./CursorSdk.ts";

const cursorSdkUrl = new URL("./CursorSdk.ts", import.meta.url).href;

// The vitest worker already has its own unhandledRejection listener, which
// would hide the process-exit behavior.
const probeProgram = `
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "cursor-sdk-stub-"));
const stub = join(dir, "stub.cjs");
writeFileSync(
  stub,
  "module.exports = { Agent: {}, AuthenticationError: class {}, createAgentPlatform: () => ({}), Cursor: {}, CursorSdkError: class {}, InMemoryCredentialStore: class {} };",
);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@cursor/sdk" || specifier === "@cursor/sdk/sqlite") {
      return { url: pathToFileURL(stub).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const { layer } = await import(${JSON.stringify(cursorSdkUrl)});
const Effect = await import("effect/Effect");
const Layer = await import("effect/Layer");
const Scope = await import("effect/Scope");
const scope = Scope.makeUnsafe();
await Effect.runPromise(Layer.buildWithScope(layer, scope));
const mode = process.argv[1];

if (mode === "cursor-closed-write") {
  // Shaped like the SDK's minified class: the constructor is not named after the error.
  class o extends Error {
    constructor(message) {
      super(message);
      this.name = "WriteIterableClosedError";
    }
  }
  Promise.reject(new o("WritableIterable is closed"));
  setTimeout(() => process.exit(0), 500);
} else {
  console.error("Unknown cursor closed stream guard probe: " + mode);
  process.exit(2);
}
`;

function runProbe(mode: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = NodeChildProcess.spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        "--disable-warning=ExperimentalWarning",
        "--input-type=module",
        "-e",
        probeProgram,
        mode,
      ],
      { stdio: ["ignore", "pipe", "pipe"], timeout: 5_000 },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

describe("isCursorClosedStreamWrite", () => {
  it("matches only the SDK's closed stream write error", () => {
    class o extends Error {
      constructor(message: string) {
        super(message);
        this.name = "WriteIterableClosedError";
      }
    }
    expect(isCursorClosedStreamWrite(new o("WritableIterable is closed"))).toBe(true);
    expect(isCursorClosedStreamWrite(new Error("WritableIterable is closed"))).toBe(false);
    expect(isCursorClosedStreamWrite(Object.assign(new Error("x"), { name: "TimeoutError" }))).toBe(
      false,
    );
    expect(isCursorClosedStreamWrite(new TypeError("x"))).toBe(false);
    expect(
      isCursorClosedStreamWrite(
        Object.assign(new Error("x"), { name: "WriteIterableClosedErrorX" }),
      ),
    ).toBe(false);
    expect(isCursorClosedStreamWrite({ name: "WriteIterableClosedError" })).toBe(false);
    expect(isCursorClosedStreamWrite("WriteIterableClosedError")).toBe(false);
  });
});

describe("Cursor closed stream guard", () => {
  it("keeps the process alive when the SDK writes to a closed stream", async () => {
    const result = await runProbe("cursor-closed-write");
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("The server will keep running.");
    expect(result.stderr).not.toContain("WritableIterable is closed");
  });
});
