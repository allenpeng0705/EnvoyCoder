/**
 * Transcripts on disk, so a task opened after the daemon restarts still has its history.
 *
 * A run's events live in memory while the daemon does, and that is what `tailRun` used to read.
 * The task row keeps the run id across a restart; the events did not, so a phone that opened the
 * task was told the run did not exist. One JSON line per event is the record. An index lists the
 * run ids of a task in the order they happened, because the task itself only remembers the latest.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { RunEventSchema, type AgentRun, type RunEvent } from "@envoydev/protocol";

/** A run id is a filename. Anything else is refused rather than joined onto the directory. */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function transcriptFile(dir: string, runId: string): string | undefined {
  if (!RUN_ID.test(runId)) return undefined;
  return join(dir, `${runId}.jsonl`);
}

function indexFile(dir: string): string {
  return join(dir, "index.json");
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as { code?: string }).code === "ENOENT";
}

/** The events in one transcript, skipping a line that is not one. An absent file is an empty list. */
export async function readTranscript(file: string): Promise<RunEvent[]> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const events: RunEvent[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const result = RunEventSchema.safeParse(parsed);
    if (result.success) events.push(result.data);
  }
  return events;
}

/** The run a transcript describes, or nothing when it never recorded a start. */
export function agentRunFromTranscript(
  events: readonly RunEvent[],
  transcriptPath: string,
): AgentRun | undefined {
  const started = events.find((event) => event.kind === "run.started");
  if (started?.kind !== "run.started") return undefined;
  let ended: Extract<RunEvent, { kind: "run.ended" }> | undefined;
  for (const event of events) {
    if (event.kind === "run.ended") ended = event;
  }
  return {
    id: started.runId,
    taskId: started.taskId,
    harness: started.harness,
    ...(started.model !== undefined ? { model: started.model } : {}),
    ...(started.thinkingLevel !== undefined ? { thinkingLevel: started.thinkingLevel } : {}),
    hostId: started.hostId,
    startedAt: started.at,
    ...(ended !== undefined
      ? { endedAt: ended.at, exitCode: ended.exitCode, status: ended.status }
      : { status: "failed" }),
    transcriptPath,
  };
}

/** The session a later run should rejoin, when the transcript says that is possible. */
export function resumableSessionId(events: readonly RunEvent[]): string | undefined {
  let sessionId: string | undefined;
  for (const event of events) {
    if (event.kind === "run.session" && event.resumable) sessionId = event.sessionId;
  }
  return sessionId;
}

interface TranscriptIndex {
  tasks: Record<string, string[]>;
}

async function readIndex(dir: string): Promise<TranscriptIndex> {
  try {
    const parsed = JSON.parse(await readFile(indexFile(dir), "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || !("tasks" in parsed)) {
      return { tasks: {} };
    }
    const tasks = (parsed as { tasks: unknown }).tasks;
    if (typeof tasks !== "object" || tasks === null) return { tasks: {} };
    const clean: Record<string, string[]> = {};
    for (const [taskId, ids] of Object.entries(tasks)) {
      if (!Array.isArray(ids)) continue;
      clean[taskId] = ids.filter((id): id is string => typeof id === "string" && RUN_ID.test(id));
    }
    return { tasks: clean };
  } catch (error) {
    if (isMissing(error)) return { tasks: {} };
    return { tasks: {} };
  }
}

let indexChain: Promise<void> = Promise.resolve();

/** Remember that this run belongs to this task. A failure here must not fail the run. */
export function rememberRun(dir: string, taskId: string, runId: string): Promise<void> {
  if (!RUN_ID.test(runId)) return Promise.resolve();
  const run = indexChain.then(() => appendIndex(dir, taskId, runId));
  indexChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function appendIndex(dir: string, taskId: string, runId: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const index = await readIndex(dir);
  const ids = index.tasks[taskId] ?? [];
  if (!ids.includes(runId)) index.tasks[taskId] = [...ids, runId];
  const file = indexFile(dir);
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(index)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, file);
}

export async function runIdsForTask(dir: string, taskId: string): Promise<string[]> {
  const index = await readIndex(dir);
  return index.tasks[taskId] ?? [];
}
