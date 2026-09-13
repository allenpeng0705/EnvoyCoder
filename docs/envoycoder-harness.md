# Agents: the catalogue, and how each one is driven

**Code:** `packages/agent-catalog` · **Contract:** `@envoycoder/protocol` (`HarnessId`) ·
**Status:** two native harnesses, six external CLIs, each with its evidence recorded.

---

## 1. Two tiers, and why the distinction is load-bearing

| Tier | Members | What it means |
|---|---|---|
| **native** | `envoy-harness`, `deepseek-harness` | we own the integration end to end: structured tool calls, approvals, sessions, cancel |
| **external** | `claudecode`, `codex`, `copilot`, `opencode`, `cursor`, `pi` | a third-party CLI we launch and interpret. The set mirrors what Paseo supports, because that is the baseline a user arrives with |

The tier is not decoration — it is what the UI is allowed to promise. An agent we cannot cancel and
cannot ask on gets a terminal and a prompt, not a diff panel and an approval dialog.

**The capability that matters most is `approvals`.** An agent whose surface cannot answer a
permission request will *silently deny* every escalation: DeepSeek Harness's SDK profile does exactly
that (below), and a user reads it as "the agent is broken". `capabilities.approvals` is therefore a
statement about the protocol we chose to speak, and `test/agent-catalog.test.ts` asserts it against
the launch arguments.

## 2. ACP is the common denominator

Most agents — and both of ours — can be driven over the **Agent Client Protocol**: a JSON-RPC session
lifecycle (`session/new`, `resume`, `cancel`, `close`, `set_config_option`, `prompt`), `session/update`
for streaming, and `session/request_permission` for approvals.

That is why the catalogue records a *stream dialect* rather than a client class per agent: one ACP
adapter covers the built-in harness, DeepSeek Harness, and any third-party agent that speaks it.
Only agents with no ACP support get a bespoke argv adapter, and they are marked as such in the
catalogue.

## 3. `envoy-harness` — our built-in agent

* **How:** in-process (`@envoymesh/envoy-harness`). It is *our* code, so it can be linked rather than
  spawned, which makes cancel and resume exact rather than best-effort.
* **Where it comes from:** a **peer** of the family, not a package EnvoyMesh distributes. EnvoyCoder
  clones or copies it itself (EnvoyMesh design **D4**; guide §7.5). `npm run peers:check` says so in
  the error message when it is missing.
* **Why it exists:** a control plane needs at least one agent whose every event it understands. The
  external CLIs give us text and, at best, JSONL; ours gives us tool calls, approvals and a session
  we can store.

## 4. `deepseek-harness` (`dsh`) — verified against `../deepseek-harness` @ 0.1.5-alpha.2 (MIT)

Read the source before wiring this one, because three facts change the integration:

1. **It is not a library.** "this package is not a library you import"
   (`packages/bundle/base/README.md:12`); the only supported launcher is the `dsh` CLI, and the repo
   has a script that enforces it (`scripts/verify-application-entrypoints.ts`). So we **spawn** it.
2. **The `sdk` profile cannot answer approvals, and cannot cancel.** Its wire has `initialize`,
   `session/prompt` and `shutdown` — "a client abandons a turn by closing the runtime process"
   (`packages/sdk/protocol/README.md:114`), and there is no answerer for the approval seam, so asks
   resolve `unavailable` and are denied (`docs/subsystems/approval.md`).
3. **The `acp` profile has both.** `session/cancel`, `session/resume`, `session/close` and
   `session/request_permission` (`packages/acp/acp/README.md`).

⇒ We spawn `dsh --profile acp`. It costs nothing we need and buys cancel plus approvals.

**Operational notes a host must know:**

| | |
|---|---|
| Working directory | the *invoking* directory is the workspace root (`workspaceRoot: process.cwd()`), so the child's `cwd` **is** the workspace |
| Home | `$DSH_HOME` (default `~/.dsh`) holds sessions, settings, credentials and plugin state. Use a **fresh home per profile** for isolation |
| Sessions on disk | `$DSH_HOME/sessions/--<cwd>--/<id>/session.vN.jsonl` (zstd by default) |
| Credentials | environment → `$DSH_HOME/.credentials.yaml` → cwd `.env`; `DEEPSEEK_API_KEY` for the DeepSeek route. Resolved per request, so a missing key fails the request, not the boot |
| stdout | **is the protocol** in `sdk`/`acp` profiles — never attach a stdout logger to the child |
| Permission mode | `DSH_PERMISSION_MODE`; `danger-full-access` sets policy to `never`. We do **not** set it by default: the whole point of driving ACP is that escalations reach the user |
| Teardown | stdin EOF → SIGTERM → SIGKILL |

**Platform differences (see `docs/envoycoder-platforms.md` §4):** `bash` on macOS/Linux, `pwsh` on
Windows; sandbox enforcement is `partial` on Windows (ACL restricted token) and *fails closed* when
no runner is usable; `chmod 0600` on credentials is skipped on Windows; SIGTERM is not distinct from
force-kill there.

## 5. The external CLIs

| Agent | Binary | Assumed invocation | Verified? |
|---|---|---|---|
| `claudecode` | `claude` | `-p <prompt> --output-format stream-json --verbose [--model M] [--resume ID]` | **no** — confirm with `claude --help` on each platform |
| `codex` | `codex` | `exec --cd <cwd> [--model M] --json <prompt>` | **no** |
| `copilot` | `copilot` | `-p <prompt>` (text stream) | **no**, and the least certain: Paseo lists Copilot as supported, but its non-interactive flags have not been read |
| `opencode` | `opencode` | `run [--model M] <prompt>` | **no** |
| `cursor` | `cursor-agent`, `cursor` | `-p <prompt> [--model M]` | **no** — carried over from EnvoyMesh's harness list |
| `pi` | `pi` | `<prompt>` | **no** — and EnvoyMesh runs Pi *in-process* (`packages/harness`), which may be the better route here too |

Every entry's `evidence` field in `packages/agent-catalog/src/index.ts` says `unverified` where that
is the truth. **That is a worklist, not a disclaimer**: an agent adapter is not finished until the
argv has been run against the real binary on macOS, Windows and Linux, and the entry says so.

`npm run smoke` prints which of these are actually installed on this machine — on the machine this
scaffold was written on, `dsh`, `claude`, `codex` and `cursor-agent` resolve; `copilot`, `opencode`
and `pi` do not.

## 6. Adding an agent

1. Add the id to `HARNESS_IDS` in `@envoycoder/protocol` (it is the wire type).
2. Add the entry to `HARNESS_CATALOG`, with `evidence` naming where the argv came from.
3. If it speaks ACP, prefer that over a bespoke adapter — and set `approvals: true` only because the
   protocol provides `session/request_permission`, not because the agent is "probably fine".
4. Add it to the probe test's expectations if it is text-only.
5. Verify the argv by running it. An adapter written from documentation is a guess with a type.
