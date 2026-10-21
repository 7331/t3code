import * as NodeBuffer from "node:buffer";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeHttp from "node:http";

// Synthetic read-only management responses from usage/cliproxyApi.test.ts.
// Run: node apps/server/scripts/cliproxy-usage-fixture.mjs [port] [isolated-worktree/.t3 ...]
// Optional homes are seeded through normal pairing and settings RPCs, without reading settings.
const port = Number(process.argv[2] ?? 0);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid port");
const key = "nonsecret-local-fixture";
const accounts = [
  {
    id: "first.json",
    auth_index: "a",
    provider: "codex",
    email: "first@example.com",
    id_token: { chatgpt_account_id: "account-a" },
  },
  {
    id: "second.json",
    auth_index: "b",
    provider: "codex",
    email: "second@example.com",
    id_token: { chatgpt_account_id: "account-b" },
  },
];
const credit = (id, expires_at = "2099-01-01T00:00:00Z") => ({
  id,
  expires_at,
  status: "available",
  reset_type: "codex_rate_limits",
});
const seed = async (home, patch) => {
  const resolved = await NodeFSP.realpath(home);
  const root = NodePath.dirname(resolved);
  if (NodePath.basename(resolved) !== ".t3") throw new Error("Expected a worktree .t3 home");
  await NodeFSP.access(NodePath.join(root, ".git"));
  const cli = NodeURL.fileURLToPath(new URL("../src/bin.ts", import.meta.url));
  const pairing = NodeChildProcess.spawnSync(
    process.execPath,
    [
      cli,
      "pair",
      "--base-dir",
      resolved,
      "--scope",
      "settings:write",
      "--scope",
      "providers:manage",
      "--label",
      "synthetic-usage-fixture",
    ],
    { cwd: root, encoding: "utf8" },
  );
  const match = pairing.stdout.match(/Pairing URL: (\S+)/);
  if (pairing.status !== 0 || !match) throw new Error("Could not pair isolated server");
  const url = new URL(match[1]);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("Expected a local server");
  const credential = new URLSearchParams(url.hash.slice(1)).get("token");
  const session = await fetch(new URL("/api/auth/browser-session", url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
    signal: AbortSignal.timeout(10000),
  });
  if (!session.ok) throw new Error("Isolated pairing failed");
  const cookie = session.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const ticketResponse = await fetch(new URL("/api/auth/websocket-ticket", url), {
    method: "POST",
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(10000),
  });
  if (!ticketResponse.ok) throw new Error("Isolated websocket ticket failed");
  const { ticket } = await ticketResponse.json();
  const socketUrl = new URL("/ws", url);
  socketUrl.protocol = "ws:";
  socketUrl.search = new URLSearchParams({
    wsTicket: ticket,
    orchestrationProtocol: "2",
  }).toString();
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Settings RPC timed out"));
    }, 10000);
    socket.addEventListener("open", () =>
      socket.send(
        JSON.stringify({
          _tag: "Request",
          id: "1",
          tag: "server.updateSettings",
          payload: { patch },
          headers: [],
        }),
      ),
    );
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message._tag !== "Exit" || message.requestId !== "1") return;
      clearTimeout(timer);
      socket.close();
      if (message.exit._tag === "Success") resolve();
      else reject(new Error("Settings RPC failed"));
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Isolated socket failed"));
    });
  });
  console.log(JSON.stringify({ seededHome: resolved, sourceId: "synthetic-preservation" }));
};
const server = NodeHttp.createServer(async (request, response) => {
  const reply = (status, body) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  };
  if (request.headers.authorization !== `Bearer ${key}`) return reply(401, {});
  if (request.method === "GET" && request.url === "/v0/management/auth-files")
    return reply(200, { files: accounts });
  if (request.method !== "POST" || request.url !== "/v0/management/api-call") return reply(405, {});
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of request) {
    byteLength += chunk.length;
    if (byteLength > 16384) return reply(413, {});
    chunks.push(chunk);
  }
  const data = NodeBuffer.Buffer.concat(chunks).toString("utf8");
  let call;
  try {
    call = JSON.parse(data);
  } catch {
    return reply(400, {});
  }
  if (call?.method !== "GET" || !["a", "b"].includes(call.auth_index)) return reply(405, {});
  let body;
  if (call.url === "https://chatgpt.com/backend-api/wham/usage") {
    body = {
      plan_type: "pro",
      rate_limit: {
        secondary_window: { used_percent: 78, reset_at: 4070908800, limit_window_seconds: 604800 },
      },
    };
  } else if (call.url === "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits") {
    body = {
      credits: [
        credit("later", "2099-02-01T00:00:00Z"),
        credit("first"),
        credit("expired", "2000-01-01T00:00:00Z"),
        { ...credit("used"), status: "redeemed" },
      ],
    };
  } else return reply(405, {});
  console.log(
    JSON.stringify({
      fixture: "synthetic",
      authIndex: call.auth_index,
      method: call.method,
      url: call.url,
    }),
  );
  return reply(200, { status_code: 200, body: JSON.stringify(body) });
});
server.listen(port, "127.0.0.1", async () => {
  const address = server.address();
  const settingsPatch = {
    usageLimitSources: {
      "synthetic-preservation": {
        kind: "cliproxy",
        label: "Synthetic quota preservation fixture",
        url: `http://127.0.0.1:${address.port}`,
        managementKey: key,
        enabled: true,
      },
    },
  };
  console.log(JSON.stringify({ pid: process.pid, settingsPatch }));
  try {
    for (const home of process.argv.slice(3)) await seed(home, settingsPatch);
  } catch (error) {
    console.error("Could not seed isolated home; fixture stopping:", error.message);
    process.exitCode = 1;
    server.close();
  }
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close());
