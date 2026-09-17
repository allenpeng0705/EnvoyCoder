/**
 * **The pairing list says what each record is, and a revoked one can be cleared.**
 *
 * ## The two defects this pins
 *
 * The owner looked at *This machine* and read a chip of **5** against **0 active** devices: the chip
 * printed `devices.length`, and the store deliberately keeps revoked rows, so the number could only ever
 * grow. Worse, the pane called the whole list *"Paired devices"* — but a row is written when a code is
 * **minted**, before any phone has scanned it, and survives revocation as the evidence the token was
 * withdrawn. So the list was true and the label lied, which is the same defect class as a status bar
 * claiming machines are connected.
 *
 * ## What the assertions are, and the mutation each one fails on
 *
 * | case | the mutation it fails on |
 * |---|---|
 * | the chip counts only active records | restoring `String(devices.length)` (the shipped bug) |
 * | an unused, a revoked and an expired record render different words from an active one | collapsing the state helper back to `revokedAt ? revoked : expires` |
 * | Forget is offered on a revoked row and on nothing else | rendering Forget unconditionally, or keying it off "not active" |
 * | forgetting removes the row and the count does not move | deleting from the list without refreshing, or counting the row anyway |
 * | revoking an unused record is still the route that changes it | making Forget the only control on a non-active row |
 *
 * ## Why it renders `MachineSection` itself
 *
 * The defect was in this component's rendering, and the state distinction is a property of the rows — a
 * test against a fixture of the component would have wired the fixture itself. The daemon's half (the
 * `coder.forgetPairedDevice` refusal for an active record) is pinned over a real socket in
 * `daemon-rpc.test.ts`; this file is the screen.
 */

/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CoderSettings } from "@envoydev/protocol";

import { MachineSection } from "../src/components/settings/SectionsFacts.js";
import { en } from "../src/i18n/messages/en.js";
import { I18nProvider } from "../src/i18n/context.js";
import type { CoderState } from "../src/state/coderStore.js";
import { stubAgentActions } from "./fixtures/agent-actions.js";

afterEach(cleanup);

const settings: CoderSettings = {
  defaults: { harness: "envoy-harness" },
  requireApprovalForDestructive: true,
  keepTranscripts: true,
  language: "en",
};

function stateWith(): CoderState {
  return {
    connection: { state: "connected", endpoint: { host: "127.0.0.1", port: 4770, path: "/ws" } },
    resolved: undefined,
    hello: {
      product: "EnvoyDev",
      version: "0.1.0",
      instanceId: "test",
      home: "/home/you/.envoymesh",
      stateDir: "/home/you/.envoymesh/EnvoyDev",
      startedAt: "2026-09-17T00:00:00.000Z",
      windowCount: 1,
      methods: [],
      mesh: { kind: "no-node" },
      notes: [],
    },
    projects: [],
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
  };
}

interface Row {
  id: string;
  deviceLabel: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  lastSeenAt?: string;
}

/**
 * The four states, from the fields the record already carries.
 *
 * Expiry is far enough away (2999 / 2000) that the assertion cannot depend on the wall clock: the
 * component reads `new Date()` for `now`, and a fixture dated "next year" would start failing in a year.
 */
const ACTIVE: Row = {
  id: "pad_active",
  deviceLabel: "Used phone",
  createdAt: "2026-09-01T00:00:00.000Z",
  expiresAt: "2999-09-01T00:00:00.000Z",
  lastSeenAt: "2026-09-17T11:00:00.000Z",
};
const UNUSED: Row = {
  id: "pad_unused",
  deviceLabel: "Fresh code",
  createdAt: "2026-09-17T11:30:00.000Z",
  expiresAt: "2999-09-17T11:30:00.000Z",
};
const REVOKED: Row = {
  id: "pad_revoked",
  deviceLabel: "Withdrawn phone",
  createdAt: "2026-09-01T00:00:00.000Z",
  expiresAt: "2999-09-01T00:00:00.000Z",
  revokedAt: "2026-09-17T10:00:00.000Z",
};
const EXPIRED: Row = {
  id: "pad_expired",
  deviceLabel: "Old code",
  createdAt: "2025-01-01T00:00:00.000Z",
  expiresAt: "2000-01-01T00:00:00.000Z",
};

/** The chip, once the list has answered. */
async function chipText(): Promise<string> {
  const chip = await screen.findByTestId("paired-active-count");
  // The list arrives in an effect, so the chip starts as "…" and settles a tick later.
  await vi.waitFor(() => expect(chip.textContent).not.toBe("…"));
  return chip.textContent ?? "";
}

/** The `<li>` for one device label — the row a user reads. */
function rowFor(label: string): HTMLElement {
  const name = screen.getByText(label);
  const row = name.closest("li");
  if (!(row instanceof HTMLElement)) throw new Error(`${label} rendered outside a row`);
  return row;
}

const forget = (row: HTMLElement): HTMLButtonElement | null =>
  within(row).queryByRole("button", { name: en["settings.machine.paired.forget"] });
const revoke = (row: HTMLElement): HTMLButtonElement | null =>
  within(row).queryByRole("button", { name: en["settings.machine.paired.revoke"] });

/** Render the section over a mutable list, so a button's press really changes what comes back. */
function show(initial: Row[]) {
  let devices = initial;
  const forgetPairedDevice = vi.fn(async (id: string) => {
    const device = devices.find((d) => d.id === id)!;
    devices = devices.filter((d) => d.id !== id);
    return { ok: true as const, device };
  });
  const revokePairedDevice = vi.fn(async (id: string) => {
    const device = { ...devices.find((d) => d.id === id)!, revokedAt: "2026-09-17T12:30:00.000Z" };
    devices = devices.map((d) => (d.id === id ? device : d));
    return { ok: true as const, device };
  });
  const agents = stubAgentActions({
    listPairedDevices: vi.fn(async () => ({ ok: true as const, devices })),
    forgetPairedDevice,
    revokePairedDevice,
  });
  render(
    <I18nProvider preference="en">
      <MachineSection state={stateWith()} onUpdate={vi.fn(async () => undefined)} agents={agents} />
    </I18nProvider>,
  );
  return { forgetPairedDevice, revokePairedDevice };
}

describe("the pairing list's count and its rows", () => {
  it("counts only active records and says which state each row is in", async () => {
    show([ACTIVE, UNUSED, REVOKED, EXPIRED]);

    // **The count is of devices that are still valid and have been used.** Four records exist; only one
    // qualifies. `String(devices.length)` — the shipped bug — would read "4 here".
    expect(await chipText()).toBe(en["settings.machine.paired.active.one"]);
    expect(screen.getByText(en["settings.machine.paired.title"])).toBeTruthy();

    const active = rowFor("Used phone");
    const unused = rowFor("Fresh code");
    const revoked = rowFor("Withdrawn phone");
    const expired = rowFor("Old code");

    // The structural half: each row carries its derived state, so a test can tell them apart without
    // parsing a localized sentence.
    expect(active.dataset.deviceState).toBe("active");
    expect(unused.dataset.deviceState).toBe("unused");
    expect(revoked.dataset.deviceState).toBe("revoked");
    expect(expired.dataset.deviceState).toBe("expired");

    // The words half: the four states must not share a sentence. This is the defect the owner named —
    // a never-scanned code called "paired" — so each one says the fact that puts it in its state.
    expect(within(active).getByText(/^Active · last used /)).toBeTruthy();
    expect(within(unused).getByText(/^Not used yet · expires /)).toBeTruthy();
    expect(within(revoked).getByText(/^Revoked · /)).toBeTruthy();
    expect(within(expired).getByText(/^Expired · /)).toBeTruthy();
  });

  it("offers Forget only on a revoked row, and keeps Revoke as the route for everything else", async () => {
    const { forgetPairedDevice } = show([ACTIVE, UNUSED, REVOKED, EXPIRED]);
    await chipText();

    // Destructive cleanup is a press on a record that is already dead. An active or unused record has no
    // Forget control at all: it must be revoked first, so revocation stays the deliberate two-step.
    expect(forget(rowFor("Withdrawn phone"))).not.toBeNull();
    expect(revoke(rowFor("Withdrawn phone"))).toBeNull();
    expect(forget(rowFor("Used phone"))).toBeNull();
    expect(forget(rowFor("Fresh code"))).toBeNull();
    expect(forget(rowFor("Old code"))).toBeNull();
    expect(revoke(rowFor("Used phone"))).not.toBeNull();
    expect(revoke(rowFor("Fresh code"))).not.toBeNull();

    // The active row's only route is revoke, and pressing Forget on it is not even expressible.
    expect(forgetPairedDevice).not.toHaveBeenCalled();
  });

  it("clears a revoked row on the press, and the chip does not move", async () => {
    const { forgetPairedDevice } = show([ACTIVE, UNUSED, REVOKED, EXPIRED]);
    await chipText();

    fireEvent.click(forget(rowFor("Withdrawn phone"))!);

    await vi.waitFor(() => expect(forgetPairedDevice).toHaveBeenCalledWith("pad_revoked"));
    // The row left the list the user is reading...
    await vi.waitFor(() => expect(screen.queryByText("Withdrawn phone")).toBeNull());
    // ...and it was never part of the count, so clearing it changes nothing a user reads as access.
    expect(await chipText()).toBe(en["settings.machine.paired.active.one"]);
  });

  it("revokes an unused record first, so it becomes Forget-able rather than deletable", async () => {
    const { revokePairedDevice } = show([ACTIVE, UNUSED]);
    await chipText();

    expect(forget(rowFor("Fresh code"))).toBeNull();
    fireEvent.click(revoke(rowFor("Fresh code"))!);

    await vi.waitFor(() => expect(revokePairedDevice).toHaveBeenCalledWith("pad_unused"));
    // The row is now revoked — same record, now with evidence a token was withdrawn — and only now does
    // it grow a Forget control.
    await vi.waitFor(() => expect(rowFor("Fresh code").dataset.deviceState).toBe("revoked"));
    expect(forget(rowFor("Fresh code"))).not.toBeNull();
    expect(await chipText()).toBe(en["settings.machine.paired.active.one"]);
  });
});
