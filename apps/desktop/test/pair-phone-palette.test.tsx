/**
 * **The palette's *Pair a phone* row, clicked.**
 *
 * The owner found this defect by clicking it: the row answered with a sentence — *"Pairing a phone arrives
 * with the mobile milestone…"* — that had stopped being true (the session store exists, `coder.mintPairing`
 * is implemented, and pairing had already been minting codes for a while). The sentence was the whole of
 * the row's behaviour, so no unit test of a helper could have failed on it: the only failing assertion is
 * the one that watches the press.
 *
 * So this drives `CoderApp` the way a user does — open the Command Center, click the row — and asserts the
 * two facts the defect denied: the owner window actually **mints**, and the pairing surface with the code
 * on it **appears**. It is written against the real `buildCommandContributions` and the real
 * `SettingsPane → PairingSection`, not a fixture of them, because the bug lived exactly in the wiring
 * between those two halves and a fixture could have wired them itself.
 *
 * **The mutation it fails on:** restoring `onPairPhone: () => localNotice("palette.pairPhone.notYet")` in
 * `CoderApp`. `mintPairing` is then never called, the pane never opens, and the palette stays on screen
 * showing the stale sentence. Both assertions below fail — verified by reverting the fix and running this
 * file.
 */

/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CoderSettings, Project } from "@envoydev/protocol";

import { CoderApp } from "../src/components/CoderApp.js";
import { en } from "../src/i18n/messages/en.js";
import { I18nProvider } from "../src/i18n/context.js";
import type { CoderState, CoderStore } from "../src/state/coderStore.js";

afterEach(cleanup);

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

/** The window's state, with a daemon that answered `hello` — what `PairingSection` needs to render. */
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

/**
 * A minted code, in the shape the daemon actually mints — the family's query form (`wsUrl`, `lanWsUrl`,
 * `token`, owner identity, the `app` claim), not the invented `host`/`port` shape an earlier fixture used.
 * `PairingSection` reads the address and token back out of this, so a fixture that is not the real shape
 * would let the manual route's assertions pass against a parse that never happens in production.
 */
const MINTED_URI =
  "envoy://pair?wsUrl=ws%3A%2F%2F192.168.1.20%3A4770%2Fws&lanWsUrl=ws%3A%2F%2F192.168.1.20%3A4770%2Fws&token=test-secret&ownerPublicKey=pk&ownerId=envoy%3Aowner%3Aabc&app=EnvoyDev";

describe("the palette's Pair a phone row", () => {
  it("mints a code in the owner window and shows it, instead of the milestone notice", async () => {
    const mintPairing = vi.fn(async () => ({
      ok: true as const,
      uri: MINTED_URI,
      device: {
        id: "device-1",
        deviceLabel: "Phone",
        createdAt: "2026-09-14T10:00:00.000Z",
        expiresAt: "2026-09-14T10:10:00.000Z",
      },
    }));
    const listPairedDevices = vi.fn(async () => ({ ok: true as const, devices: [] }));
    const actions = {
      mintPairing,
      listPairedDevices,
      updateSettings: vi.fn(async () => ({ ok: true as const })),
      clearError: vi.fn(),
    } as unknown as CoderStore;

    render(
      <I18nProvider preference="en">
        <CoderApp state={stateWith()} actions={actions} />
      </I18nProvider>,
    );

    // The catalogue, opened the way the title bar opens it. The row is pressed **inside the dialog**: the
    // rail's QR button now carries the same words as its accessible name, so an unscoped `getByText` would
    // find two elements and the failure would be about the fixture rather than about the palette.
    fireEvent.click(screen.getByRole("button", { name: en["palette.title"] }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: en["palette.title"] })).getByText(
        en["palette.pairPhone.title"],
      ),
    );

    // **The press minted.** `{ deviceLabel: "Phone" }` is what the settings row has always sent, and the
    // assertion is on the argument rather than on the call count alone: a mint with a changed label would
    // be a second shape of the same call.
    await vi.waitFor(() => expect(mintPairing).toHaveBeenCalledWith({ deviceLabel: "Phone" }));

    // **The code is on screen**, in the one pairing surface the settings row also shows — the palette
    // navigates to it rather than growing a second rendering of the same secret.
    const panel = await screen.findByTestId("pairing-panel");
    expect(panel).toBeTruthy();
    const uriField = screen.getByLabelText(en["settings.pairing.uriLabel"]) as HTMLTextAreaElement;
    expect(uriField.value).toBe(MINTED_URI);

    // **The stale sentence is not.** It claimed the daemon had no session store and refused remote
    // clients on purpose; both halves were false. Asserted by a fragment of its own wording rather than by
    // its catalogue key, because the key is deleted — a re-introduction would have to bring new words.
    expect(screen.queryByText(/mobile milestone/i)).toBeNull();

    // And the palette did its job and got out of the way: a command that lands closes it.
    expect(screen.queryByRole("dialog", { name: en["palette.title"] })).toBeNull();
  });

  /**
   * **The Pairing section's own action, which is the surface the palette now reuses.**
   *
   * Pairing used to be a row on *This machine*; it is now its own section, reached from the bar, the rail's
   * QR button and the palette — three ways in, one mint. This is the half that proves the section still
   * mints through the shared module. Without it, a regression in `PairPhone.tsx` would be invisible to the
   * suite — the same shape of gap that let the palette's stub sit there in the first place.
   */
  it("mints from the Pairing section's own button, through the same shared code", async () => {
    const mintPairing = vi.fn(async () => ({
      ok: true as const,
      uri: MINTED_URI,
      device: {
        id: "device-1",
        deviceLabel: "Phone",
        createdAt: "2026-09-14T10:00:00.000Z",
        expiresAt: "2026-09-14T10:10:00.000Z",
      },
    }));
    const actions = {
      mintPairing,
      listPairedDevices: vi.fn(async () => ({ ok: true as const, devices: [] })),
      updateSettings: vi.fn(async () => ({ ok: true as const })),
      clearError: vi.fn(),
    } as unknown as CoderStore;

    render(
      <I18nProvider preference="en">
        <CoderApp state={stateWith()} actions={actions} />
      </I18nProvider>,
    );

    // The rail's footer button opens settings; jsdom has no `matchMedia`, so the pane falls back to the
    // wide layout and the bar is beside the page (`settings-nav.test.tsx` asserts that fallback).
    fireEvent.click(screen.getByRole("button", { name: en["sidebar.footer.settings"] }));
    fireEvent.click(screen.getByRole("button", { name: en["settings.section.pairing.title"] }));
    fireEvent.click(screen.getByRole("button", { name: en["settings.pairing.qr.action"] }));

    await vi.waitFor(() => expect(mintPairing).toHaveBeenCalledWith({ deviceLabel: "Phone" }));
    expect(await screen.findByTestId("pairing-panel")).toBeTruthy();
  });

  /**
   * **The rail's QR button** — the control that replaced the useless *Host* button.
   *
   * The owner's report was that *Host* only opened Settings, which the gear beside it already does. The
   * button is asserted through the shell rather than as a rendered glyph, because the two things that make
   * it useful are the wiring this test can see: the press **mints** (one call, the shared one) and it lands
   * on the pairing section rather than on whatever page happened to be open.
   */
  it("opens Pairing and mints from the rail's QR button", async () => {
    const mintPairing = vi.fn(async () => ({
      ok: true as const,
      uri: MINTED_URI,
      device: {
        id: "device-1",
        deviceLabel: "Phone",
        createdAt: "2026-09-14T10:00:00.000Z",
        expiresAt: "2026-09-14T10:10:00.000Z",
      },
    }));
    const actions = {
      mintPairing,
      listPairedDevices: vi.fn(async () => ({ ok: true as const, devices: [] })),
      updateSettings: vi.fn(async () => ({ ok: true as const })),
      clearError: vi.fn(),
    } as unknown as CoderStore;

    render(
      <I18nProvider preference="en">
        <CoderApp state={stateWith()} actions={actions} />
      </I18nProvider>,
    );

    // The accessible name is the `visually-hidden` label, which is the point of the icon-only pattern: the
    // glyph is on the face, the name is announced, and there is no stray text in the rail.
    fireEvent.click(screen.getByRole("button", { name: en["sidebar.footer.pair"] }));

    await vi.waitFor(() => expect(mintPairing).toHaveBeenCalledTimes(1));
    // The section it landed on, by its own heading — not merely "a pane opened".
    expect(screen.getByRole("heading", { name: en["settings.section.pairing.title"] })).toBeTruthy();
    expect(await screen.findByTestId("pairing-panel")).toBeTruthy();
  });
});
