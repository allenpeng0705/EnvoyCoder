/**
 * Commands a person has already allowed, remembered per project.
 *
 * Allowing `npm test` in one folder does not allow it in another, and it does not allow `npm test
 * --watch`. The match is the command itself, or — when the step is not a command — the tool and the
 * file it names. A step we cannot name is not remembered: remembering "bash" would allow every
 * command.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const FILE = "allowed-commands.json";
const MAX_PER_PROJECT = 200;

interface StoreFile {
  projects: Record<string, string[]>;
}

export function permissionMemoryKey(input: { toolName?: string; args?: unknown }): string | undefined {
  const args = asRecord(input.args);
  if (args === undefined) return undefined;
  if (typeof args.command === "string") {
    const command = normalizeCommand(args.command);
    if (command !== "") return `command\t${command}`;
  }
  const tool = input.toolName?.trim();
  const path = firstPath(args);
  if (tool !== undefined && tool !== "" && path !== undefined) return `file\t${tool}\t${path}`;
  return undefined;
}

/** The option id that means allow, or nothing when this request has no allow choice. */
export function allowChoiceId(
  options: readonly { optionId?: string; kind?: string }[] | undefined,
): string | undefined {
  if (options === undefined || options.length === 0) return "allow";
  const hit = options.find((option) => option.kind === "allow_once" || option.kind === "allow_always");
  return typeof hit?.optionId === "string" && hit.optionId !== "" ? hit.optionId : undefined;
}

export function choiceAllows(
  options: readonly { optionId?: string; kind?: string }[] | undefined,
  optionId: string,
): boolean {
  if (options === undefined || options.length === 0) return optionId === "allow";
  const hit = options.find((option) => option.optionId === optionId);
  return hit?.kind === "allow_once" || hit?.kind === "allow_always";
}

export async function isCommandAllowed(stateDir: string, cwd: string, key: string): Promise<boolean> {
  const file = await readStore(stateDir);
  return file.projects[cwd]?.includes(key) === true;
}

let writeChain: Promise<void> = Promise.resolve();

export function rememberCommand(stateDir: string, cwd: string, key: string): Promise<void> {
  const run = writeChain.then(() => appendKey(stateDir, cwd, key));
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function normalizeCommand(command: string): string {
  return command
    .split("\n")
    .map((line) => line.trim().replace(/[ \t]+/g, " "))
    .filter((line) => line !== "")
    .join("\n");
}

function firstPath(args: Record<string, unknown>): string | undefined {
  for (const name of ["path", "file_path", "filePath", "filepath"]) {
    const value = args[name];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

async function readStore(stateDir: string): Promise<StoreFile> {
  try {
    const raw = await readFile(join(stateDir, FILE), "utf8");
    const parsed = JSON.parse(raw) as StoreFile;
    if (typeof parsed !== "object" || parsed === null || typeof parsed.projects !== "object") {
      return { projects: {} };
    }
    return parsed;
  } catch (error) {
    if (isMissing(error)) return { projects: {} };
    return { projects: {} };
  }
}

async function appendKey(stateDir: string, cwd: string, key: string): Promise<void> {
  const file = await readStore(stateDir);
  const current = file.projects[cwd] ?? [];
  if (current.includes(key)) return;
  const next = [...current, key];
  file.projects[cwd] = next.length > MAX_PER_PROJECT ? next.slice(next.length - MAX_PER_PROJECT) : next;
  await mkdir(stateDir, { recursive: true });
  const path = join(stateDir, FILE);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(file)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
