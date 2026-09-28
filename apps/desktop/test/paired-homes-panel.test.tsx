/**
 * Thin-client Settings panel — join / forget paired homes.
 *
 * `jsdom` is configured per file so the rest of the suite stays on Node.
 */

/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../src/i18n/context.js";
import { PairedHomesPanel } from "../src/components/settings/PairedHomesPanel.js";
import { HomeRegistry, resetHomeRegistryForTests } from "../src/state/home-registry.js";
import { PairedHomeStore, memoryPairedHomesStorage } from "../src/state/paired-homes.js";

afterEach(() => {
  cleanup();
  resetHomeRegistryForTests();
});

function renderPanel(registry: HomeRegistry): void {
  render(
    <I18nProvider preference="en">
      <PairedHomesPanel homes={registry} />
    </I18nProvider>,
  );
}

const pasteLabel = "Pairing link or shared connection";

describe("PairedHomesPanel", () => {
  it("joins from a pasted URI and lists the home", async () => {
    const homes = new PairedHomeStore(memoryPairedHomesStorage());
    await homes.load();
    const registry = new HomeRegistry(homes);
    renderPanel(registry);

    const uri =
      "envoy://pair?wsUrl=ws%3A%2F%2F10.0.0.9%3A4770%2Fws&token=secret99&ownerPublicKey=KEY&ownerId=envoy%3Aowner%3Ax&app=EnvoyDev";
    fireEvent.change(screen.getByLabelText(pasteLabel), { target: { value: uri } });
    fireEvent.change(screen.getByLabelText("Name for this home"), {
      target: { value: "office" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join home" }));

    await waitFor(() => {
      expect(screen.getByText("office")).toBeTruthy();
      expect(screen.getByText(/Joined office/)).toBeTruthy();
    });
    expect(registry.pairedHomeStore().list()).toHaveLength(1);
    expect(registry.pairedHomeStore().list()[0]?.label).toBe("office");

    fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    await waitFor(() => {
      expect(registry.pairedHomeStore().list()).toHaveLength(0);
    });
    registry.dispose();
  });

  it("shows a refusal for a bad URI and does not add a home", async () => {
    const homes = new PairedHomeStore(memoryPairedHomesStorage());
    await homes.load();
    const registry = new HomeRegistry(homes);
    renderPanel(registry);

    fireEvent.change(screen.getByLabelText(pasteLabel), {
      target: { value: "not-a-pairing-link" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join home" }));

    await waitFor(() => {
      expect(screen.getByText(/pairing code|could not be read|not a pairing|does not look like/i)).toBeTruthy();
    });
    expect(registry.pairedHomeStore().list()).toHaveLength(0);
    registry.dispose();
  });

  it("joins from host:port + token", async () => {
    const homes = new PairedHomeStore(memoryPairedHomesStorage());
    await homes.load();
    const registry = new HomeRegistry(homes);
    renderPanel(registry);

    fireEvent.click(screen.getByTestId("homes-method-direct"));
    fireEvent.change(screen.getByLabelText("Home address"), {
      target: { value: "10.0.0.8:4770" },
    });
    fireEvent.change(screen.getByLabelText("Pairing token"), {
      target: { value: "MyPhone99" },
    });
    fireEvent.change(screen.getByLabelText("Name for this home"), {
      target: { value: "direct-home" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join home" }));

    await waitFor(() => {
      expect(screen.getByText("direct-home")).toBeTruthy();
    });
    expect(registry.pairedHomeStore().list()[0]?.host).toBe("10.0.0.8");
    expect(registry.pairedHomeStore().list()[0]?.token).toBe("MyPhone99");
    registry.dispose();
  });

  it("joins a phone direct share pasted on the pairing-link tab", async () => {
    const homes = new PairedHomeStore(memoryPairedHomesStorage());
    await homes.load();
    const registry = new HomeRegistry(homes);
    renderPanel(registry);

    fireEvent.change(screen.getByLabelText(pasteLabel), {
      target: { value: "endpoint: 10.0.0.4:4770\ntoken: FromPhone1" },
    });
    fireEvent.change(screen.getByLabelText("Name for this home"), {
      target: { value: "from-phone" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join home" }));

    await waitFor(() => {
      expect(screen.getByText("from-phone")).toBeTruthy();
    });
    expect(registry.pairedHomeStore().list()[0]?.host).toBe("10.0.0.4");
    expect(registry.pairedHomeStore().list()[0]?.token).toBe("FromPhone1");
    registry.dispose();
  });

  it("persists an optional SSH hop on join", async () => {
    const homes = new PairedHomeStore(memoryPairedHomesStorage());
    await homes.load();
    const registry = new HomeRegistry(homes);
    renderPanel(registry);

    const uri =
      "envoy://pair?wsUrl=ws%3A%2F%2F10.0.0.3%3A4770%2Fws&token=sshtoken1&ownerPublicKey=KEY&ownerId=envoy%3Aowner%3Ay&app=EnvoyDev";
    fireEvent.change(screen.getByLabelText(pasteLabel), { target: { value: uri } });
    fireEvent.change(screen.getByLabelText("Name for this home"), {
      target: { value: "remote" },
    });
    fireEvent.change(screen.getByLabelText("SSH hop (optional)"), {
      target: { value: "me@bastion:22" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join home" }));

    await waitFor(() => {
      expect(screen.getByText("remote")).toBeTruthy();
    });
    expect(registry.pairedHomeStore().list()[0]?.sshHop).toBe("me@bastion:22");
    expect(screen.getByText(/ssh me@bastion:22/)).toBeTruthy();
    registry.dispose();
  });

  it("keeps Join disabled until a URI is pasted", async () => {
    const homes = new PairedHomeStore(memoryPairedHomesStorage());
    await homes.load();
    const registry = new HomeRegistry(homes);
    renderPanel(registry);
    expect((screen.getByRole("button", { name: "Join home" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    registry.dispose();
  });
});
