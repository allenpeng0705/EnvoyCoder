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
 *   2. **QR mint stays out of the manual block.** A QR press produces a long secret in the panel only;
 *      the host:port route has its own form (address + 8–10 char token) and never echoes that QR secret.
 *   3. **SSH is not overstated.** The pairing code carries no SSH hop (`daemon/pairing.ts` never passes one
 *      and `apps/mobile/lib/services/add_host.dart` is where the route is actually built), so the block
 *      must say what the phone will ask for and must **not** render a form that implies the desktop can set
 *      it up. `AGENTS.md` §4 is the rule this case exists for.
 *
 * ## The mutations it fails on
 *
 *   * dumping a QR long token into the manual route after a QR mint;
 *   * gating the manual form on "mint a QR first";
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
    // QR mint must not dump the long random token into the manual route.
    const manual = document.querySelector('[data-route="manual"]');
    if (!(manual instanceof HTMLElement)) throw new Error("no manual block");
    expect(within(manual).queryByText("test-secret")).toBeNull();
    expect(manual.querySelector("[data-manual-result]")).toBeNull();
  });

  it("mints a short user token from the manual form without needing a QR first", async () => {
    const shortUri =
      "envoy://pair?wsUrl=ws%3A%2F%2F203.0.113.7%3A4770%2Fws&token=MyPhone99&ownerPublicKey=pk&ownerId=envoy%3Aowner%3Aabc&app=EnvoyDev";
    const mintPairing = minting(shortUri);
    show({ mintPairing });

    const manual = document.querySelector('[data-route="manual"]');
    if (!(manual instanceof HTMLElement)) throw new Error("no manual block");
    // Form is present up front — not gated on a QR mint.
    expect(within(manual).getByPlaceholderText(en["settings.pairing.manual.address.placeholder"])).toBeTruthy();
    expect(manual.querySelector("[data-manual-result]")).toBeNull();
    const address = within(manual).getByPlaceholderText(en["settings.pairing.manual.address.placeholder"]);
    const token = within(manual).getByPlaceholderText(en["settings.pairing.manual.token.placeholder"]);
    fireEvent.change(address, { target: { value: "203.0.113.7:4770" } });
    fireEvent.change(token, { target: { value: "MyPhone99" } });
    fireEvent.click(within(manual).getByRole("button", { name: en["settings.pairing.manual.action"] }));

    await vi.waitFor(() =>
      expect(mintPairing).toHaveBeenCalledWith({
        deviceLabel: "Phone",
        host: "203.0.113.7:4770",
        token: "MyPhone99",
      }),
    );
    await vi.waitFor(() => expect(manual.querySelector("[data-manual-result]")).toBeTruthy());
    const result = manual.querySelector("[data-manual-result]");
    if (!(result instanceof HTMLElement)) throw new Error("no manual result");
    expect(within(result).getByText("203.0.113.7:4770")).toBeTruthy();
    expect(within(result).getByText("MyPhone99")).toBeTruthy();
    expect(within(result).getByText(en["settings.pairing.secret"])).toBeTruthy();
    // Short token only — not the QR's long secret from a different mint.
    expect(within(result).queryByText("test-secret")).toBeNull();
  });

  it("refuses a short token that is too short before calling the daemon", async () => {
    const mintPairing = minting();
    show({ mintPairing });
    const manual = document.querySelector('[data-route="manual"]');
    if (!(manual instanceof HTMLElement)) throw new Error("no manual block");
    fireEvent.change(within(manual).getByPlaceholderText(en["settings.pairing.manual.address.placeholder"]), {
      target: { value: "example.com:4770" },
    });
    fireEvent.change(within(manual).getByPlaceholderText(en["settings.pairing.manual.token.placeholder"]), {
      target: { value: "short" },
    });
    fireEvent.click(within(manual).getByRole("button", { name: en["settings.pairing.manual.action"] }));
    expect(within(manual).getByRole("alert").textContent).toBe(en["settings.pairing.manual.token.length"]);
    expect(mintPairing).not.toHaveBeenCalled();
  });

  /**
   * The honest half, and the reason this block is a `<dl>`: there is no SSH in the pairing payload to show.
   */
  it("describes the SSH route the phone builds, and says the code carries no SSH hop", () => {
    show();
    const ssh = document.querySelector('[data-route="ssh"]');
    if (!(ssh instanceof HTMLElement)) throw new Error("no ssh block");
    for (const key of [
      "settings.pairing.ssh.host",
      "settings.pairing.ssh.port",
      "settings.pairing.ssh.user",
      "settings.pairing.ssh.daemon",
      "settings.pairing.ssh.token",
    ] as const) {
      expect(within(ssh).getByText(en[key])).toBeTruthy();
    }
    expect(within(ssh).getByText(en["settings.pairing.ssh.host.detail"])).toBeTruthy();
    expect(en["settings.pairing.ssh.host.detail"]).toMatch(/public IP or domain/i);
    expect(within(ssh).getByText(/127\.0\.0\.1:4770/)).toBeTruthy();
    expect(within(ssh).getByText(en["settings.pairing.ssh.token.detail"])).toBeTruthy();
    expect(en["settings.pairing.ssh.token.detail"]).toMatch(/short token/i);
    expect(within(ssh).queryByRole("textbox")).toBeNull();
    expect(within(ssh).queryByRole("button")).toBeNull();
    expect(within(ssh).getByText(en["settings.pairing.ssh.notInCode"])).toBeTruthy();
  });

  it("says where an issued code is revoked, because that control is on another page", () => {
    show();
    expect(screen.getByText(en["settings.pairing.manage"])).toBeTruthy();
  });
});
