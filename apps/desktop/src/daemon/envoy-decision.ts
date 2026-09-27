/**
 * Envoy Harness decision-gate settings (System One / Laya / Jev).
 *
 * Off by default. Non-secret fields live under `stateDir`; API keys stay in
 * process env (e.g. `TYPESAFE_API_KEY`) — never returned on the wire.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { CoderPaths } from "@envoydev/host-bridge";

export type DecisionMode = "off" | "shadow" | "enforce";
export type DecisionBackend = "null" | "laya-http" | "jev" | "onnx";

export interface EnvoyDecisionConfig {
  mode: DecisionMode;
  backend: DecisionBackend;
  endpoint?: string;
}

export interface EnvoyDecisionPublic {
  mode: DecisionMode;
  backend: DecisionBackend;
  endpoint?: string;
}

export interface EnvoyDecisionSetInput {
  mode?: DecisionMode;
  backend?: DecisionBackend;
  /** Empty string clears a stored endpoint. */
  endpoint?: string;
}

function stateFile(paths: CoderPaths): string {
  return join(paths.stateDir, "envoy-decision.json");
}

async function atomicWrite(path: string, body: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, body, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
}

function normalize(raw: Partial<EnvoyDecisionConfig>): EnvoyDecisionConfig {
  const mode =
    raw.mode === "shadow" || raw.mode === "enforce" || raw.mode === "off"
      ? raw.mode
      : "off";
  const backend =
    raw.backend === "laya-http" ||
    raw.backend === "jev" ||
    raw.backend === "onnx" ||
    raw.backend === "null"
      ? raw.backend
      : "null";
  return {
    mode,
    backend,
    ...(typeof raw.endpoint === "string" && raw.endpoint.trim() !== ""
      ? { endpoint: raw.endpoint.trim() }
      : {}),
  };
}

export async function getEnvoyDecisionPublic(
  paths: CoderPaths,
): Promise<EnvoyDecisionPublic> {
  try {
    const raw = JSON.parse(
      await readFile(stateFile(paths), "utf8"),
    ) as Partial<EnvoyDecisionConfig>;
    return normalize(raw);
  } catch {
    return { mode: "off", backend: "null" };
  }
}

export async function setEnvoyDecision(
  paths: CoderPaths,
  input: EnvoyDecisionSetInput,
): Promise<EnvoyDecisionPublic> {
  const current = await getEnvoyDecisionPublic(paths);
  const next = normalize({
    mode: input.mode ?? current.mode,
    backend: input.backend ?? current.backend,
    endpoint:
      input.endpoint !== undefined
        ? input.endpoint.trim() === ""
          ? undefined
          : input.endpoint.trim()
        : current.endpoint,
  });
  await mkdir(paths.stateDir, { recursive: true });
  await atomicWrite(stateFile(paths), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/**
 * Env vars for the envoy-harness child. Synchronous for the spawn path.
 * Mode `off` injects nothing so Package 1 defaults stay hermetic.
 */
export function envoyDecisionLaunchEnv(
  paths: CoderPaths,
): Record<string, string> {
  let config: EnvoyDecisionConfig;
  try {
    const raw = JSON.parse(
      readFileSync(stateFile(paths), "utf8"),
    ) as Partial<EnvoyDecisionConfig>;
    config = normalize(raw);
  } catch {
    return {};
  }
  if (config.mode === "off") return {};
  return {
    ENVOY_DECISION_MODE: config.mode,
    ENVOY_DECISION_BACKEND: config.backend,
    ...(config.endpoint !== undefined
      ? { ENVOY_DECISION_ENDPOINT: config.endpoint }
      : {}),
  };
}
