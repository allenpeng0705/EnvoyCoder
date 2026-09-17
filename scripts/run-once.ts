/**
 * Run one task, over the wire, the way the window does.
 *
 * ## Why this exists next to the UI
 *
 * M2's acceptance is that the same run driven two ways produces the same event sequence — which is
 * a claim about there being **one engine**, not two. This script is the second way: it is a client,
 * it speaks `coder.*` over the daemon's own socket, and it has no privileged path. So it cannot
 * disagree with the window about what a run produces, because it is not the thing producing it —
 * `RunManager` in the daemon is, for both.
 *
 * It is also the fastest way for a maintainer to see what an agent actually emits, without a window,
 * a click, or a screenshot:
 *
 * ```bash
 * npm run run -- --prompt "add a test for the parser" --harness deepseek-harness
 * npm run run -- --prompt "say hello" --dir /path/to/a/repo          # reuse a real project
 * ```
 *
 * ## What it prints
 *
 * One line per event, in `seq` order, then a summary. That *is* the transcript a window would
 * render, in the form a terminal can show — which makes it the thing to diff when a UI bug is
 * suspected of being a daemon bug.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import WebSocket from "ws";

import { isHarnessId, type HarnessId, type RunEvent } from "@envoydev/protocol";
import { coderPaths } from "@envoydev/host-bridge";

import { startCoderDaemon } from "../apps/desktop/src/daemon/serve.js";

interface Args {
  prompt: string;
  harness: HarnessId;
  dir: string | undefined;
  timeoutMs: number;
}

function parseArgs(argv: readonly string[]): Args {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const prompt = get("--prompt") ?? argv.filter((arg) => !arg.startsWith("--")).join(" ");
  if (!prompt) {
    console.error("Usage: npm run run -- --prompt \"<what to do>\" [--harness <id>] [--dir <dir>]");
    console.error("       --harness defaults to deepseek-harness; --dir defaults to a temp directory.");
    process.exit(2);
  }
  const harness = get("--harness") ?? "deepseek-harness";
  if (!isHarnessId(harness)) {
    console.error(`"${harness}" is not an agent EnvoyDev knows. Try one of: envoy-harness, deepseek-harness, claudecode, codex, copilot, opencode, cursor, pi.`);
    process.exit(2);
  }
  const timeout = Number.parseInt(get("--timeout-ms") ?? "600000", 10);
  return {
    prompt,
    harness,
    dir: get("--dir"),
    timeoutMs: Number.isFinite(timeout) ? timeout : 600_000,
  };
}

/** A minimal client for the daemon's protocol — the same frames the window sends. */
async function connect(port: number): Promise<{
  call: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  onEvent: (listener: (event: RunEvent) => void) => void;
  close: () => void;
}> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  // Wait for the socket before returning. A WebSocket is not usable while it is CONNECTING, and a
  // first call written into it is lost with `readyState 0` — which reads as a daemon bug rather than
  // as the client's mistake.
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", (error: Error) => reject(new Error(`could not reach the daemon: ${error.message}`)));
  });
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let counter = 0;

  socket.on("message", (raw: Buffer) => {
    const message = JSON.parse(raw.toString("utf8")) as {
      id?: string;
      result?: unknown;
      error?: { message: string };
      event?: string;
      data?: unknown;
    };
    if (message.event === "coder:run-event") {
      listeners.forEach((listener) => listener(message.data as RunEvent));
      return;
    }
    if (typeof message.id !== "string") return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });

  const listeners = new Set<(event: RunEvent) => void>();

  return {
    call(method, params) {
      const id = `r${(counter += 1)}`;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params: params ?? {} }));
      });
    },
    onEvent(listener) {
      listeners.add(listener);
    },
    close() {
      socket.close();
    },
  };
}

function describeEvent(event: RunEvent): string {
  switch (event.kind) {
    case "run.started":
      return `started        ${event.harness}${event.model ? ` · ${event.model}` : ""}`;
    case "run.session":
      return `session        ${event.sessionId}${event.resumed ? " (resumed)" : ""}`;
    case "run.output":
      return `[${event.stream}] ${event.text.replace(/\n/g, "\n               ")}`;
    case "run.thought":
      return `(thinking) ${event.text.replace(/\n/g, "\n               ")}`;
    case "run.message":
      return `you (${event.delivered}) ${event.text}`;
    case "run.tool":
      return `tool ${event.status.padEnd(9)} ${event.name || event.callId}`;
    case "run.approval-requested":
      return `APPROVAL       ${event.question}`;
    case "run.approval-resolved":
      return `answered       ${event.optionId}`;
    case "run.diff":
      return `diff           ${event.files.length} file(s)`;
    case "run.usage":
      return `context        ${event.contextUsed ?? "?"}/${event.contextSize ?? "?"}`;
    case "run.status":
      return `status         ${event.status}${event.note ? ` — ${event.note}` : ""}`;
    case "run.ended":
      return `ended          ${event.status}`;
  }
}

const args = parseArgs(process.argv.slice(2));
const home = await mkdtemp(join(tmpdir(), "envoydev-run-"));
const workDir = args.dir ?? (await mkdtemp(join(tmpdir(), "envoydev-work-")));
const daemon = await startCoderDaemon({ port: 0, home, paths: coderPaths(home), skipMeshAttach: true });

let exitCode = 0;
try {
  const client = await connect(daemon.port);

  // The window's own order: subscribe first, so no event can be broadcast before we are listening.
  await client.call("coder.subscribe", { events: ["coder:run-event"] });
  const hello = (await client.call("coder.hello", {})) as { instanceId: string; stateDir: string };
  console.log(`daemon   ${hello.instanceId} (state in ${hello.stateDir})`);

  const project = (await client.call("coder.addProject", { path: workDir })) as {
    project: { id: string; label: string };
  };
  const task = (await client.call("coder.createTask", {
    projectId: project.project.id,
    title: args.prompt.slice(0, 60),
    harness: args.harness,
  })) as { task: { id: string } };
  console.log(`project  ${project.project.label} (${project.project.id})`);
  console.log(`task     ${task.task.id}`);
  console.log(`\n--- events ---`);

  const events: RunEvent[] = [];
  let finished: (() => void) | undefined;
  const done = new Promise<void>((resolve) => {
    finished = resolve;
  });
  client.onEvent((event) => {
    events.push(event);
    console.log(`${String(event.seq).padStart(3)} ${describeEvent(event)}`);
    if (event.kind === "run.ended") finished?.();
    // An approval in a headless run cannot be answered, so the run would hang. Saying so is better
    // than a timeout with no explanation: this script is for watching an agent, not for driving one
    // that needs a human.
    if (event.kind === "run.approval-requested") {
      console.log("      (this run needs your answer; run it from the window to give one)");
    }
  });

  await client.call("coder.startRun", { taskId: task.task.id, prompt: args.prompt });

  const timeout = setTimeout(() => finished?.(), args.timeoutMs);
  await done;
  clearTimeout(timeout);

  console.log(`\n--- summary ---`);
  const counts = new Map<string, number>();
  for (const event of events) counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
  for (const [kind, count] of counts) console.log(`${kind.padEnd(24)} ${count}`);

  const ended = events.find((event) => event.kind === "run.ended");
  console.log(`\nsequence: ${events.map((event) => event.kind).join(" → ")}`);
  if (!ended) {
    console.error("\nThe run never ended. That is a failure of the daemon or the agent, not of this script.");
    exitCode = 1;
  } else if (ended.kind === "run.ended" && ended.status === "failed") {
    // A failed run is still a *successful* run of this script: it printed what happened, which is
    // the point. The exit code says so, because a CI job that treated "the agent needs credentials"
    // as a broken build would be wrong.
    console.log("\nThe run failed. The reason is in the events above and in the transcript on disk.");
  }
  client.close();
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  exitCode = 1;
} finally {
  await daemon.stop();
  await rm(home, { recursive: true, force: true });
  // Only the directory this script made is removed. `--dir` names a directory of the user's, and the
  // condition used to read `args.workspace` — a field that does not exist (it was a compile error in
  // `tsconfig.unchecked`, and at runtime `undefined` every time, so `--dir` deleted the user's
  // directory on the way out).
  if (!args.dir) await rm(workDir, { recursive: true, force: true });
}

process.exit(exitCode);
