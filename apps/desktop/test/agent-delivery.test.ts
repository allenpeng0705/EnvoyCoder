/**
 * **The install command stays on a row that is fetching.**
 *
 * The owner's requirement, verbatim: *"we should keep the command text, but also provide the exec button. Not to
 * remove the text. The user can install it by himself."*
 *
 * A fetched (`npx`) delivery makes a row `Ready`, and `availability.fix` is then empty **because there is nothing
 * to fix** — which quietly took the install command off the screen, leaving a user who would rather install it with
 * nothing to read, copy or press. So the *other* route's commands travel in `installFix`, and these legs assert the
 * daemon's half of that: the field is present, it holds the catalogue's own command, and it is absent when the
 * delivery is the ordinary one.
 *
 * ## Why this is a table test rather than a socket test
 *
 * On the machine this was written on the bridges **are** installed, so the installed route has nothing to install
 * and `installFix` is legitimately absent — a socket leg here would have been a test of the developer's machine.
 * The table takes an injected probe, so the state that matters (`needs-bridge`: the connector is missing) is
 * arranged rather than hoped for.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { coderPaths } from "@envoycoder/host-bridge";
import type { HarnessSummary } from "@envoycoder/protocol";

import { CoderStore } from "../src/daemon/store.js";
import { createCoderHandlers } from "../src/daemon/service.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const ADAPTER = "npm install -g @agentclientprotocol/codex-acp";

/**
 * The handler table over a throwaway home, with the probe and the delivery choice injected.
 *
 * `delivery: "npx"` is what a user who pressed *Run it through npx* has stored, and `finding` is what the probe
 * found for the **installed** route — `needs-bridge` is the state in which there is something to install.
 */
async function summariseFor(
  finding: { state: "needs-bridge" | "ready"; fix?: { command: string }[] },
  delivery: "installed" | "npx",
): Promise<HarnessSummary | undefined> {
  const home = await mkdtemp(join(tmpdir(), "envoycoder-delivery-"));
  cleanups.push(() => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const paths = coderPaths(home);
  const store = await CoderStore.open({ paths });

  const handlers = createCoderHandlers({
    store,
    paths,
    instance: { instanceId: "delivery-test", version: "0.1.0", startedAt: "2026-09-14T00:00:00.000Z", connectionCount: () => 1 },
    mesh: () => ({ kind: "no-node", reason: "" }),
    // The installed route's probe, arranged rather than discovered: only `codex` differs from "ready", because it
    // is the one whose answer this test is about.
    probe: (harness) =>
      harness === "codex"
        ? ({
            id: harness,
            state: finding.state,
            ...(finding.state === "ready"
              ? { binaryPath: "/usr/local/bin/codex-acp" }
              : { agentBinaryPath: "/usr/local/bin/codex" }),
            ...(finding.fix !== undefined ? { fix: finding.fix } : {}),
          } as never)
        : ({ id: harness, state: "ready", binaryPath: "/usr/local/bin/agent" } as never),
    deliveries: { of: (harness) => (harness === "codex" ? delivery : "installed"), set: async () => undefined },
  });

  const answer = (await handlers["coder.listHarnesses"]?.({})) as { harnesses: HarnessSummary[] };
  return answer.harnesses.find((summary) => summary.id === "codex");
}

describe("the install command on a row that fetches its connector", () => {
  it("keeps the command, so a user can install it themselves", async () => {
    const codex = await summariseFor({ state: "needs-bridge", fix: [{ command: ADAPTER }] }, "npx");
    expect(codex?.delivery).toEqual({ kind: "npx", package: "@agentclientprotocol/codex-acp" });
    // The command the catalogue carries, verbatim — the same string the fix block would have shown, which is what
    // makes the text and the press one answer rather than two.
    expect(codex?.installFix?.map((step) => step.command)).toEqual([ADAPTER]);
    // And the route in force is the fetched one: the probe followed the delivery, so the row is `ready` through
    // `npx` rather than through the bridge this fixture says is missing.
    expect(codex?.availability.state).toBe("ready");
  });

  it("sends none when there is nothing to install", async () => {
    // The ordinary delivery, and the connector already here: an install command on this row would invite a user to
    // reinstall a program the row just said was working — the contradiction `HarnessSummarySchema` refuses.
    const installed = await summariseFor({ state: "ready" }, "installed");
    expect(installed?.installFix).toBeUndefined();
    expect(installed?.delivery).toEqual({ kind: "installed" });

    // And a fetched row whose connector is *also* installed carries none either: the same rule, from the state
    // side rather than the delivery side.
    const fetchedButPresent = await summariseFor({ state: "ready" }, "npx");
    expect(fetchedButPresent?.installFix).toBeUndefined();
    expect(fetchedButPresent?.delivery).toEqual({ kind: "npx", package: "@agentclientprotocol/codex-acp" });
  });
});
