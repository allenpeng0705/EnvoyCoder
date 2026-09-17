/**
 * **Pairing: the section, its three routes, and the code they share.**
 *
 * ## What this file is for
 *
 * Pairing was one row on *This machine* and is now a section with three blocks — QR, host:port, SSH —
 * because they are three mechanisms rather than three phrasings of one. The properties worth a test are
 * the ones a screenshot cannot hold:
 *
 *   1. **Three routes, three blocks.** Each is its own `<section data-route=…>` with its own heading, and
 *      the QR route is *marked* primary rather than merely first.
 *   2. **One code, one mint.** The section reuses `PairPhone.tsx`'s call rather than growing a second one,
 *      and the host:port values are read **out of the minted URI** — so a reader that invented a second
 *      token format, or that filled the fields from the window's loopback connection, fails here.
 *   3. **SSH is not overstated.** The pairing code carries no SSH hop (`daemon/pairing.ts` never passes one
 *      and `apps/mobile/lib/services/add_host.dart` is where the route is actually built), so the block
 *      must say what the phone will ask for and must **not** render a form that implies the desktop can set
 *      it up. `AGENTS.md` §4 is the rule this case exists for.
 *
 * ## The two mutations it fails on
 *
 *   * filling the manual route from `state.connection` (address `127.0.0.1:4770` appears with no mint);
 *   * rendering the SSH block as inputs (a `textbox` appears under `[data-route="ssh"]`).
 */

/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CoderSettings, Project } from "@envoydev/protocol";

import { PairingSection, readPairingLink } from "../src/components/settings/PairingSection.js";
import { en } from "../src/i18n/messages/en.js";
import { I18nProvider } from "../src/i18n/context.js";
import type { CoderState } from "../src/state/coderStore.js";
import { stubAgentActions } from "./fixtures/agent-actions.js";

afterEach(() => {
  cleanup();
  // See `beforeEach`: the stub is per-test state, not a property of the environment this file runs in.
  Reflect.deleteProperty(navigator, "clipboard");
});

beforeEach(() => {
  /**
   * **A clipboard, because `canCopyText()` decides whether the Copy controls exist at all.**
   *
   * jsdom offers neither `navigator.clipboard` nor `execCommand`, so without this the file would assert the
   * absence of controls the *environment* disabled rather than anything about the section —
   * `settings-agent-verdict.test.tsx` records the same trap for the fix block's Copy.
   */
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async () => undefined },
  });
});

const settings: CoderSettings = {
  defaults: { harness: "envoy-harness" },
  requireApprovalForDestructive: true,
  keepTranscripts: true,
  language: "en",
};

const project: Project = {
  id: "local::/work/api",
  path: "/work/api",
  label: "api",
  hostId: "local",
  addedAt: "2026-09-01T09:00:00.000Z",
};

/** The window state the section reads: a connected daemon on the shipped port. */
function stateWith(over: Partial<CoderState> = {}): CoderState {
  return {
    connection: { state: "connected", endpoint: { host: "127.0.0.1", port: 4770, path: "/ws" } },
    resolved: undefined,
    hello: {
      product: "EnvoyDev",
      version: "0.1.0",
      instanceId: "test",
      home: "/home/you/.envoymesh",
      stateDir: "/home/you/.envoymesh/EnvoyDev",
      startedAt: "2026-09-14T00:00:00.000Z",
      windowCount: 1,
      methods: [],
      mesh: { kind: "no-node" },
      notes: [],
    },
    projects: [project],
    tasks: [],
    tasksKnown: true,
    settings,
    harnesses: [],
    providers: [],
    catalog: [],
    mesh: { kind: "no-node", reason: "" },
    runs: {},
    loaded: true,
    error: undefined,
    notes: [],
    ...over,
  };
}

/** The daemon's real answer shape: the family's `envoy://pair?…` query form. */
const MINTED_URI =
  "envoy://pair?wsUrl=ws%3A%2F%2F192.168.1.20%3A4770%2Fws&lanWsUrl=ws%3A%2F%2F192.168.1.20%3A4770%2Fws&token=test-secret&ownerPublicKey=pk&ownerId=envoy%3Aowner%3Aabc&app=EnvoyDev";

/** The section, with the one action it may call. */
function show(overrides: Parameters<typeof stubAgentActions>[0] = {}): void {
  render(
    <I18nProvider preference="en">
      <PairingSection
        state={stateWith()}
        onUpdate={vi.fn()}
        agents={stubAgentActions(overrides)}
      />
    </I18nProvider>,
  );
}

/** A mint that succeeds, and records the one call. `uri` defaults to the daemon's usual answer. */
function minting(uri: string = MINTED_URI) {
  return vi.fn(async () => ({
    ok: true as const,
    uri,
    device: {
      id: "device-1",
      deviceLabel: "Phone",
      createdAt: "2026-09-14T10:00:00.000Z",
      expiresAt: "2026-09-14T10:10:00.000Z",
    },
  }));
}

/* ────────────────────────── the reader ────────────────────────── */

describe("readPairingLink", () => {
  it("reads the address, the LAN address and the token out of the family's own query form", () => {
    expect(readPairingLink(MINTED_URI)).toEqual({
      address: "192.168.1.20:4770",
      lanAddress: "192.168.1.20:4770",
      token: "test-secret",
    });
  });

  it("answers `undefined` rather than guessing when a part is absent or unreadable", () => {
    // A code with no `lanWsUrl` (the daemon omits it when the LAN address is the same as the reach address,
    // and also when the machine has no non-loopback interface at all) simply has no LAN row.
    expect(readPairingLink("envoy://pair?wsUrl=ws://10.0.0.4:4770/ws&token=t")).toEqual({
      address: "10.0.0.4:4770",
      lanAddress: undefined,
      token: "t",
    });
    // A build-skew shape: nothing to read, and no fabricated `127.0.0.1` fallback.
    expect(readPairingLink("envoy://pair?host=127.0.0.1&port=4770")).toEqual({
      address: undefined,
      lanAddress: undefined,
      token: undefined,
    });
    expect(readPairingLink("not a uri at all")).toEqual({
      address: undefined,
      lanAddress: undefined,
      token: undefined,
    });
  });
});

/* ────────────────────────── the three routes ────────────────────────── */

describe("the three routes, separately", () => {
  it("renders one block per route, each with its own heading, and marks the QR route primary", () => {
    show();
    const routes = ["qr", "manual", "ssh"].map((route) => {
      const block = document.querySelector(`[data-route="${route}"]`);
      if (!(block instanceof HTMLElement)) throw new Error(`no ${route} block`);
      return block;
    });
    // Three *distinct* elements: the owner's "put them separately" is a structural property, not a line break.
    expect(new Set(routes).size).toBe(3);
    expect(routes[0]!.querySelector("h2")?.textContent).toBe(en["settings.pairing.qr.title"]);
    expect(routes[1]!.querySelector("h2")?.textContent).toBe(en["settings.pairing.manual.title"]);
    expect(routes[2]!.querySelector("h2")?.textContent).toBe(en["settings.pairing.ssh.title"]);
    // …and the primary route says so on its own heading, rather than relying on being first.
    expect(within(routes[0]!).getByText(en["settings.pairing.qr.primary"])).toBeTruthy();
    expect(within(routes[1]!).queryByText(en["settings.pairing.qr.primary"])).toBeNull();
    // Default fixture mesh is `no-node`, so the QR route must say the code still works without hosting.
    expect(within(routes[0]!).getByText(en["settings.pairing.qr.meshUnavailable"])).toBeTruthy();
    expect(routes[0]!.querySelector('[data-mesh-route="unavailable"]')).toBeTruthy();
  });

  it("tells the user when the mesh peer is hosting and the QR includes a direct route", () => {
    render(
      <I18nProvider preference="en">
        <PairingSection
          state={stateWith({
            mesh: {
              kind: "hosting",
              peerId: "12D3KooWHost",
              multiaddrs: ["/ip4/192.168.1.20/tcp/4001"],
              relayHints: [],
              peerCount: 2,
            },
          })}
          onUpdate={vi.fn()}
          agents={stubAgentActions()}
        />
      </I18nProvider>,
    );
    const qr = document.querySelector('[data-route="qr"]');
    expect(qr).toBeTruthy();
    expect(within(qr as HTMLElement).getByText(en["settings.pairing.qr.meshHosting"])).toBeTruthy();
    expect(qr!.querySelector('[data-mesh-route="ready"]')).toBeTruthy();
  });

  it("mints once, from the section's own press, through the shared call", async () => {
    const mintPairing = minting();
    show({ mintPairing });

    // Before a press there is no panel and no code anywhere in the section.
    expect(screen.queryByTestId("pairing-panel")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: en["settings.pairing.qr.action"] }));

    await vi.waitFor(() => expect(mintPairing).toHaveBeenCalledWith({ deviceLabel: "Phone" }));
    expect(mintPairing).toHaveBeenCalledTimes(1);
    const panel = await screen.findByTestId("pairing-panel");
    const uriField = within(panel).getByLabelText(en["settings.pairing.uriLabel"]) as HTMLTextAreaElement;
    expect(uriField.value).toBe(MINTED_URI);
  });

  it("shows the minted code's address and token as copyable values in the manual route", async () => {
    show({ mintPairing: minting() });
    // Nothing yet: the manual route says where the two values come from instead of filling them in from the
    // window's own connection, which is loopback and therefore an address a phone cannot dial.
    expect(screen.getByText(en["settings.pairing.manual.waiting"])).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: en["settings.pairing.qr.action"] }));
    await screen.findByTestId("pairing-panel");

    const manual = document.querySelector('[data-route="manual"]');
    if (!(manual instanceof HTMLElement)) throw new Error("no manual block");
    expect(within(manual).getByText("192.168.1.20:4770")).toBeTruthy();
    expect(within(manual).getByText("test-secret")).toBeTruthy();
    // The daemon mints `lanWsUrl` equal to `wsUrl` when the machine has one non-loopback address, and the
    // same `host:port` twice under two labels would read as two routes when there is one — so the LAN row
    // is absent here.
    expect(within(manual).queryByText(en["settings.pairing.manual.lanAddress"])).toBeNull();
    // The token is a secret, and the section says so where the user is about to copy it.
    expect(within(manual).getByText(en["settings.pairing.secret"])).toBeTruthy();
    // **Each field's button says "Copy", not "Copy pairing link".** Found by driving the real window: the
    // first build reused the QR panel's whole-link label on the address field, so a button beside
    // `192.168.1.20:4770` named the wrong thing. The accessible name still names the field, which is what
    // makes two identical-looking buttons distinguishable.
    expect(within(manual).getAllByText(en["settings.pairing.field.copy"])).toHaveLength(2);
    expect(within(manual).queryByText(en["settings.pairing.copy"])).toBeNull();
    expect(
      within(manual).getByRole("button", {
        name: en["settings.pairing.copy.aria"].replace("{field}", en["settings.pairing.manual.address"]),
      }),
    ).toBeTruthy();
    expect(
      within(manual).getByRole("button", {
        name: en["settings.pairing.copy.aria"].replace("{field}", en["settings.pairing.manual.token"]),
      }),
    ).toBeTruthy();
    // …and the values are not in an editable field: they are read-only text plus a Copy button, so nothing
    // here can be mistaken for a setting the desktop stores.
    expect(within(manual).queryByRole("textbox")).toBeNull();
  });

  /**
   * The other shape: a reach address that is a tunnel and a LAN address that is not. Then both are shown,
   * because they are two routes to one daemon and the phone may prefer the local one.
   */
  it("shows the LAN address as its own row only when it differs from the reach address", async () => {
    const viaTunnel =
      "envoy://pair?wsUrl=wss%3A%2F%2Frelay.example%3A443%2Fws&lanWsUrl=ws%3A%2F%2F192.168.1.20%3A4770%2Fws&token=test-secret";
    show({ mintPairing: minting(viaTunnel) });
    fireEvent.click(screen.getByRole("button", { name: en["settings.pairing.qr.action"] }));
    await screen.findByTestId("pairing-panel");

    const manual = document.querySelector('[data-route="manual"]');
    if (!(manual instanceof HTMLElement)) throw new Error("no manual block");
    expect(within(manual).getByText("relay.example:443")).toBeTruthy();
    expect(within(manual).getByText("192.168.1.20:4770")).toBeTruthy();
    expect(within(manual).getByText(en["settings.pairing.manual.lanAddress"])).toBeTruthy();
  });

  /**
   * The honest half, and the reason this block is a `<dl>`: there is no SSH in the pairing payload to show.
   */
  it("describes the SSH route the phone builds, and says the code carries no SSH hop", () => {
    show();
    const ssh = document.querySelector('[data-route="ssh"]');
    if (!(ssh instanceof HTMLElement)) throw new Error("no ssh block");
    // The fields the phone's Add host → SSH form asks for, all five named.
    for (const key of [
      "settings.pairing.ssh.host",
      "settings.pairing.ssh.port",
      "settings.pairing.ssh.user",
      "settings.pairing.ssh.daemon",
      "settings.pairing.ssh.token",
    ] as const) {
      expect(within(ssh).getByText(en[key])).toBeTruthy();
    }
    // The daemon address as seen from the far machine, from the live connection — not a hardcoded 4770.
    expect(within(ssh).getByText(/127\.0\.0\.1:4770/)).toBeTruthy();
    // No form: a control the user could fill in here would be a control that does not do anything.
    expect(within(ssh).queryByRole("textbox")).toBeNull();
    expect(within(ssh).queryByRole("button")).toBeNull();
    // And the sentence that keeps the product from claiming more than the protocol provides.
    expect(within(ssh).getByText(en["settings.pairing.ssh.notInCode"])).toBeTruthy();
  });

  it("says where an issued code is revoked, because that control is on another page", () => {
    // Found by reading the move back: minting left *This machine* and the issued-codes list stayed there,
    // so the section that mints has to say where the record — and the way to revoke it — now lives.
    show();
    expect(screen.getByText(en["settings.pairing.manage"])).toBeTruthy();
  });
});
