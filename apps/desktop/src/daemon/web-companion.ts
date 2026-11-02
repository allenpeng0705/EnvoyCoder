/**
 * Loopback-only thin companion UI: active runs + pending approvals.
 *
 * Not a desktop clone — status and Allow/Deny only, over HTTP on 127.0.0.1.
 * POSTs require a per-boot token embedded in the served HTML (CSRF).
 */

import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { RunManager } from "./runs.js";
import type { CoderStore } from "./store.js";

export const WEB_COMPANION_PORT = 18794;
export const COMPANION_TOKEN_HEADER = "x-envoydev-companion-token";

export interface WebCompanionHandle {
  port: number;
  /** Opaque token required on mutating requests. Tests use this; the HTML embeds it. */
  token: string;
  close: () => Promise<void>;
}

function pageHtml(token: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>EnvoyDev companion</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; }
    body { margin: 1.5rem; background: #12141a; color: #e8eaef; }
    h1 { font-size: 1.1rem; font-weight: 600; }
    .run { border: 1px solid #2a2f3a; border-radius: 8px; padding: 0.75rem 1rem; margin: 0.75rem 0; }
    .meta { color: #9aa3b2; font-size: 0.85rem; }
    .q { margin: 0.5rem 0; }
    button { margin-right: 0.5rem; padding: 0.35rem 0.75rem; border-radius: 6px; border: 0; cursor: pointer; }
    .allow { background: #3a9a5b; color: #fff; }
    .deny { background: #c44; color: #fff; }
    .empty { color: #9aa3b2; }
  </style>
</head>
<body>
  <h1>EnvoyDev companion</h1>
  <p class="meta">Loopback status and approvals. Updates every few seconds.</p>
  <div id="root" class="empty">Loading…</div>
  <script>
    const TOKEN = ${JSON.stringify(token)};
    const headers = () => ({
      "content-type": "application/json",
      "${COMPANION_TOKEN_HEADER}": TOKEN,
    });
    async function load() {
      const res = await fetch("/api/status", { headers: { "${COMPANION_TOKEN_HEADER}": TOKEN } });
      if (!res.ok) {
        document.getElementById("root").textContent = "Could not load status.";
        return;
      }
      const data = await res.json();
      const root = document.getElementById("root");
      if (!data.runs || data.runs.length === 0) {
        root.className = "empty";
        root.textContent = "No active runs.";
        return;
      }
      root.className = "";
      root.innerHTML = data.runs.map((run) => {
        const approval = run.approvalRequestId
          ? '<p class="q">Allow the agent to continue?</p>' +
            '<button class="allow" data-run="' + run.runId + '" data-req="' + escapeAttr(run.approvalRequestId) + '" data-choice="' + escapeAttr(run.allowOptionId || "allow") + '">Allow</button>' +
            '<button class="deny" data-run="' + run.runId + '" data-req="' + escapeAttr(run.approvalRequestId) + '" data-choice="deny">Deny</button>'
          : '<p class="meta">Running…</p>';
        return '<div class="run"><div><strong>' + escapeHtml(run.title) + '</strong></div>' +
          '<div class="meta">' + escapeHtml(run.status) + ' · ' + escapeHtml(run.runId) + '</div>' + approval + '</div>';
      }).join("");
      root.querySelectorAll("button[data-run]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await fetch("/api/answer", {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({
              runId: btn.getAttribute("data-run"),
              requestId: btn.getAttribute("data-req"),
              choice: btn.getAttribute("data-choice"),
            }),
          });
          load();
        });
      });
    }
    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;" }[c]));
    }
    function escapeAttr(s) { return escapeHtml(s); }
    load();
    setInterval(load, 3000);
  </script>
</body>
</html>`;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** True when Origin/Referer is absent (same-origin script) or clearly loopback for this port. */
export function companionOriginOk(req: IncomingMessage, port: number): boolean {
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin !== "") {
    return isLoopbackOrigin(origin, port);
  }
  const referer = req.headers.referer;
  if (typeof referer === "string" && referer !== "") {
    try {
      const url = new URL(referer);
      return isLoopbackOrigin(`${url.protocol}//${url.host}`, port);
    } catch {
      return false;
    }
  }
  // No Origin/Referer — same-origin fetch from the served page often omits Origin on GET.
  return true;
}

function isLoopbackOrigin(origin: string, port: number): boolean {
  const allowed = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`,
  ]);
  return allowed.has(origin);
}

export function companionTokenOk(req: IncomingMessage, token: string): boolean {
  const header = req.headers[COMPANION_TOKEN_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === "string" && value !== "" && value === token;
}

export function startWebCompanion(input: {
  store: CoderStore;
  runs: RunManager;
  port?: number;
  /** Injected for tests; production mints a random token. */
  token?: string;
}): Promise<WebCompanionHandle> {
  const listenPort = input.port ?? WEB_COMPANION_PORT;
  const token = input.token ?? randomBytes(24).toString("base64url");
  let boundPort = listenPort;

  const server: Server = createServer((req, res) => {
    void handle(req, res, { ...input, port: boundPort, token }).catch((error) => {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(error instanceof Error ? error.message : "error");
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPort, "127.0.0.1", () => {
      const address = server.address();
      boundPort =
        typeof address === "object" && address !== null ? address.port : listenPort;
      resolve({
        port: boundPort,
        token,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  input: { store: CoderStore; runs: RunManager; port: number; token: string },
): Promise<void> {
  const url = req.url ?? "/";
  if (req.method === "GET" && (url === "/" || url.startsWith("/?"))) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(pageHtml(input.token));
    return;
  }

  if (!companionTokenOk(req, input.token) || !companionOriginOk(req, input.port)) {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "forbidden" }));
    return;
  }

  if (req.method === "GET" && url.startsWith("/api/status")) {
    const tasks = input.store.tasks();
    const runs = input.runs.companionSnapshot().map((entry) => {
      const task = tasks.find((row) => row.id === entry.taskId);
      return {
        runId: entry.runId,
        taskId: entry.taskId,
        title: task?.title || "Untitled",
        status: entry.status,
        approvalRequestId: entry.approvalRequestId,
        allowOptionId: entry.allowOptionId,
      };
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ runs }));
    return;
  }
  if (req.method === "POST" && url.startsWith("/api/answer")) {
    let body: { runId?: string; requestId?: string; choice?: string };
    try {
      const raw = await readBody(req);
      body = JSON.parse(raw) as { runId?: string; requestId?: string; choice?: string };
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
      return;
    }
    if (!body.runId || !body.requestId || !body.choice) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
      return;
    }
    await input.runs.answerApproval(body.runId, body.requestId, body.choice);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
}
