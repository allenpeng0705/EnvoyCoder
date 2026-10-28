/**
 * Zero-config credentials for catalogued (external) agents.
 *
 * Product rule: if Claude / Codex / DeepSeek / … already works standalone on
 * this machine, EnvoyDev must not ask for a second API key or invent a private
 * home under EnvoyDev state. Built-in Envoy Harness is the exception (Agents
 * LLM panel).
 *
 * A Dock-launched daemon often lacks interactive-shell exports. When a named
 * variable is unset in the process environment, this module fills it from:
 *   1. DeepSeek’s standalone harness home (`~/.dsh` credentials / `.env`) for
 *      `DEEPSEEK_API_KEY` only,
 *   2. a cached login-shell `printenv` for known agent keys (and any extra
 *      names a user-declared provider listed).
 *
 * Values are never logged. Claude/Codex/Cursor login stores under the real
 * user `HOME` are left to those agents — we do not parse them.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEEPSEEK_API_KEY_ENV = "DEEPSEEK_API_KEY";
export const ANTHROPIC_API_KEY_ENV = "ANTHROPIC_API_KEY";
export const OPENAI_API_KEY_ENV = "OPENAI_API_KEY";
export const CODEX_API_KEY_ENV = "CODEX_API_KEY";

/** Keys every catalogued launch may inherit from the login shell when unset. */
export const KNOWN_AGENT_API_KEY_ENVS = [
  DEEPSEEK_API_KEY_ENV,
  ANTHROPIC_API_KEY_ENV,
  OPENAI_API_KEY_ENV,
  CODEX_API_KEY_ENV,
] as const;

const DSH_HOME_DIR_NAME = ".dsh";
const DSH_HOME_ENV = "DSH_HOME";
const CREDENTIALS_FILE = ".credentials.yaml";
const DOTENV_FILE = ".env";

export type AmbientAgentEnvDeps = {
  env?: NodeJS.ProcessEnv;
  /** OS home; defaults to `homedir()`. */
  userHome?: string;
  readFile?: (path: string) => string | undefined;
  /** Login-shell lookup; inject in unit tests. */
  readLoginShellEnv?: (name: string) => string | undefined;
  /**
   * Extra names to resolve (e.g. a provider’s `env` list). Known agent keys
   * are always considered; duplicates are ignored.
   */
  names?: readonly string[];
};

/** Per-name login-shell results (`undefined` value = probed, absent). */
const loginShellCache = new Map<string, string | undefined>();
const loginShellProbed = new Set<string>();

/** Absolute harness home standalone `dsh` would use. */
export function userDshHome(env: NodeJS.ProcessEnv = process.env, userHome: string = homedir()): string {
  const override = env[DSH_HOME_ENV]?.trim();
  if (override !== undefined && override.length > 0) return override;
  return join(userHome, DSH_HOME_DIR_NAME);
}

/**
 * Env vars to merge into a catalogued-agent or provider ACP launch.
 *
 * Only names that are missing (or empty) in the daemon environment are filled.
 * The ACP client still merges `process.env` over this map for everything else.
 */
export function ambientAgentLaunchEnv(deps: AmbientAgentEnvDeps = {}): Record<string, string> {
  const env = deps.env ?? process.env;
  const names = uniqueNames([...(deps.names ?? []), ...KNOWN_AGENT_API_KEY_ENVS]);
  const out: Record<string, string> = {};
  const readFile = deps.readFile ?? readTextFile;
  const readShell = deps.readLoginShellEnv ?? readLoginShellEnv;

  for (const name of names) {
    const ambient = env[name];
    if (ambient !== undefined && ambient.trim().length > 0) continue;

    if (name === DEEPSEEK_API_KEY_ENV) {
      const home = userDshHome(env, deps.userHome ?? homedir());
      const fromHome = readDeepseekApiKeyFromDshHome(home, readFile);
      if (fromHome !== undefined) {
        out[name] = fromHome;
        continue;
      }
    }

    const fromShell = readShell(name);
    if (fromShell !== undefined && fromShell.trim().length > 0) {
      out[name] = fromShell.trim();
    }
  }
  return out;
}

/**
 * Fill missing provider-named variables into a copy of `from` so `resolveProviderEnv`
 * can succeed the same way a terminal-launched daemon would.
 *
 * Returns a new env object; never mutates `from`. Values already set win.
 */
export function withAmbientProviderEnv(
  names: readonly string[],
  from: NodeJS.ProcessEnv,
  deps: Omit<AmbientAgentEnvDeps, "env" | "names"> = {},
): NodeJS.ProcessEnv {
  const filled = ambientAgentLaunchEnv({ ...deps, env: from, names });
  if (Object.keys(filled).length === 0) return from;
  return { ...from, ...filled };
}

/** Test hook: clear the login-shell cache between cases. */
export function resetAmbientAgentEnvCacheForTests(): void {
  loginShellCache.clear();
  loginShellProbed.clear();
}

function uniqueNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function readTextFile(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Prefer the managed credentials document, then `$DSH_HOME/.env` — the same
 * order credentials-local uses below the process environment.
 */
export function readDeepseekApiKeyFromDshHome(
  dshHome: string,
  readFile: (path: string) => string | undefined = readTextFile,
): string | undefined {
  const fromCredentials = readRefFromCredentialsYaml(readFile(join(dshHome, CREDENTIALS_FILE)));
  if (fromCredentials !== undefined) return fromCredentials;
  return readEnvFileValue(readFile(join(dshHome, DOTENV_FILE)), DEEPSEEK_API_KEY_ENV);
}

function readRefFromCredentialsYaml(text: string | undefined): string | undefined {
  if (text === undefined || text.length === 0) return undefined;
  // Managed document shape: `version: 1` / `refs:` / `  DEEPSEEK_API_KEY: value`.
  const refs = text.match(/(?:^|\n)refs:\s*\n([\s\S]*?)(?=\n[^\s]|\n*$)/);
  const block = refs?.[1];
  if (block === undefined) return undefined;
  const line = block.match(new RegExp(`(?:^|\\n)\\s*${DEEPSEEK_API_KEY_ENV}:\\s*(.+)(?:\\n|$)`));
  const raw = line?.[1]?.trim();
  if (raw === undefined || raw.length === 0) return undefined;
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

function readEnvFileValue(text: string | undefined, name: string): string | undefined {
  if (text === undefined || text.length === 0) return undefined;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const body = trimmed.startsWith("export ") ? trimmed.slice("export ".length) : trimmed;
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    if (body.slice(0, eq).trim() !== name) continue;
    let value = body.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value.length > 0) return value;
  }
  return undefined;
}

function readLoginShellEnv(name: string): string | undefined {
  if (loginShellProbed.has(name)) return loginShellCache.get(name);

  const miss = (): undefined => {
    loginShellProbed.add(name);
    loginShellCache.set(name, undefined);
    return undefined;
  };

  const shell = process.env.SHELL?.trim();
  if (shell === undefined || shell.length === 0) return miss();
  // Only allow POSIX env identifier names into the shell command.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return miss();

  try {
    const result = spawnSync(shell, ["-ilc", `printenv ${name}`], {
      encoding: "utf8",
      timeout: 4000,
      // Near-empty env so the login shell reloads the user's profile.
      env: {
        HOME: process.env.HOME,
        USER: process.env.USER,
        LOGNAME: process.env.LOGNAME,
        SHELL: shell,
        PATH: process.env.PATH,
        TERM: "dumb",
      },
    });
    const value = result.status === 0 ? result.stdout?.trim() : undefined;
    const usable = value !== undefined && value.length > 0 ? value : undefined;
    loginShellProbed.add(name);
    loginShellCache.set(name, usable);
    return usable;
  } catch {
    return miss();
  }
}
