/**
 * **The status line that said "30 machines connected" to somebody who had connected nothing.**
 *
 * ## The report this file answers
 *
 * The owner's window read, along the bottom edge:
 *
 * > `Hosting this mesh — 30 machines connected`
 * > `30 peers`
 *
 * on a machine with no paired phone and no second window. Both numbers were real and both labels were
 * false. `peerCount` comes from `node.getConnectedPeerIds().length` (`packages/host-bridge/src/mesh-peer.ts`),
 * which is **every libp2p connection the daemon's own peer holds** — relays first, and historically also
 * the DHT swarm when `coderMeshOptions` still enabled discovery. None of those peers are phones paired
 * *to this user*, so the sentence claimed a capability the protocol never granted (AGENTS.md
 * non-negotiable #4). Today's options keep the swarm off (~2 peers at rest); the fixture below still
 * uses 30 so a regression that re-introduces a count in the headline fails even against the old swarm.
 *
 * ## What is pinned here
 *
 * * The `hosting` headline is the durable fact — *"Hosting this mesh"* — and carries **no count**.
 * * The count is not thrown away: the peer id (the identity a phone pairs against) and the shared mesh
 *   network's total travel in the tooltip, where the family's wording rule puts developer detail, labelled
 *   for what they are.
 * * A `peerCount` of 30 with nothing paired must never render as "30 machines connected", in English or in
 *   a translation, and must never leave a literal `{count}` on screen.
 *
 * The first case is the one that must fail against the old string: revert `mesh.hosting` to
 * `"Hosting this mesh — {count} machines connected"` and the component to pass the count, and it goes red.
 */

/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MeshStatusBar } from "../src/components/MeshStatusBar.js";
import { CATALOGUES } from "../src/i18n/catalogues.js";
import { I18nProvider } from "../src/i18n/context.js";
import { en } from "../src/i18n/messages/en.js";
import type { MeshStatus } from "../src/state/useCoderState.js";

afterEach(cleanup);

/**
 * The owner's bug report, preserved as a worst-case fixture: a high `peerCount` with nothing paired.
 * Production sits near 2 (the relays) after the swarm was turned off; 30 still proves the headline
 * never absorbs the count.
 */
const HOSTING_NOTHING_PAIRED: Extract<MeshStatus, { kind: "hosting" }> = {
  kind: "hosting",
  peerId: "12D3KooWStandaloneDaemonPeer",
  multiaddrs: ["/ip4/203.0.113.7/tcp/4001/p2p/12D3KooWRelay/p2p-circuit"],
  relayHints: ["/dns4/relay.example/tcp/443/wss/p2p/12D3KooWRelay"],
  peerCount: 30,
};

function show(mesh: MeshStatus, preference: "en" | "de" = "en"): void {
  render(
    <I18nProvider preference={preference}>
      <MeshStatusBar mesh={mesh} />
    </I18nProvider>,
  );
}

/** The one sentence a user reads. */
const headline = (): HTMLElement => document.querySelector(".statusbar__text") as HTMLElement;

/** Everything the status bar shows, so a badge cannot reintroduce the claim the headline dropped. */
const visibleText = (): string => document.querySelector(".statusbar")?.textContent ?? "";

describe("the hosting status line speaks for the shared network, not for the user's devices", () => {
  it("does not tell a user who paired nothing that 30 machines are connected", () => {
    show(HOSTING_NOTHING_PAIRED);

    // The fact the user needs, and nothing more: this machine *is* the node a phone dials.
    expect(headline().textContent).toBe(en["mesh.hosting"]);
    // The defect, as the sentence it must never contain again.
    expect(visibleText()).not.toMatch(/\d+\s+machines?\s+connected/i);
    // And the old secondary badge ("30 peers", which read as *their* peers) is gone with it.
    expect(visibleText()).not.toMatch(/\b30\b/);
  });

  it("keeps the peer id and the shared network's total in the tooltip, each labelled for what it is", () => {
    show(HOSTING_NOTHING_PAIRED);

    // `peerId` is the identity a phone pairs against — useful, and a tooltip is where the rule puts it.
    expect(headline().getAttribute("title")).toContain(HOSTING_NOTHING_PAIRED.peerId);
    // The count is real; naming the network it belongs to is what makes it honest.
    expect(headline().getAttribute("title")).toContain("30 peers on the shared mesh");
  });

  it("says the same thing in German, with no count and no dangling placeholder", () => {
    show(HOSTING_NOTHING_PAIRED, "de");

    expect(headline().textContent).toBe(CATALOGUES.de["mesh.hosting"]);
    expect(visibleText()).not.toContain("{count}");
    expect(visibleText()).not.toMatch(/\d+\s+Computer\s+verbunden/i);
    expect(headline().getAttribute("title")).toContain("30 Peers im gemeinsamen Mesh");
  });

  it("states the same fact when the peer reports no count at all", () => {
    // `peerCount` is optional — a peer that has just come up reports nothing (protocol `rpc.ts`). The
    // sentence must not depend on it, because the claim never did.
    show({ ...HOSTING_NOTHING_PAIRED, peerCount: undefined });

    expect(headline().textContent).toBe(en["mesh.hosting"]);
    expect(headline().getAttribute("title")).toBe(
      en["mesh.hosting.title"].replace("{peerId}", HOSTING_NOTHING_PAIRED.peerId),
    );
  });
});
