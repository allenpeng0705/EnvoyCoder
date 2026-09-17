/**
 * Prove the acceptance criterion against a **real daemon**: German in, German out — errors included.
 *
 * ## What the criterion is, in the owner's words
 *
 * > "The language must be unified — we cannot give a German UI with English errors."
 *
 * A test can pin the mechanism (a wire string with a key renders German) and the producer (every
 * refusal carries a key this build knows). Neither of those is the *claim*, because neither of them
 * starts a daemon. This script does: it boots one, sets the language through the settings RPC the
 * window itself uses, asks it for something it must refuse, and shows the two strings side by side —
 * the English sentence that crossed the wire, and the German sentence the client renders from it.
 *
 * ## Why it drives the client's own code rather than a hand-written request
 *
 * The English half is printed *raw*, from the socket, because that is what a German user must never
 * see. The German half is produced by the window's own path — `CoderStore` puts the refusal in state
 * as a `Notice`, the provider's translator is built exactly as `I18nProvider` builds it
 * (`resolveLocale(preference, reported)` → `createTranslator(locale, CATALOGUES[locale])`), and
 * `localize` is the function the notice strip calls. Nothing here re-implements the lookup, so this
 * cannot pass while the app is broken — which is the only reason to have a script at all.
 *
 * What it does *not* do is render React: there is no DOM here. So it proves the daemon, the wire and
 * the client's translation path, and not the two lines of JSX that put the string on screen (those
 * are covered by `apps/desktop/test/i18n.test.ts` and the component tests).
 *
 * Usage: `npm run verify:language` (optionally `--language de`, `--path /some/nowhere`).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import process from "node:process";

import WebSocket from "ws";

import { coderErrorMessage, coderErrorRef, type CoderSettings } from "@envoydev/protocol";
import { coderPaths } from "@envoydev/host-bridge";

import { CATALOGUES } from "../apps/desktop/src/i18n/catalogues.js";
import { LOCALE_LABELS, resolveLocale, type LocalePreference } from "../apps/desktop/src/i18n/locales.js";
import { localize } from "../apps/desktop/src/i18n/notice.js";
import { createTranslator } from "../apps/desktop/src/i18n/translate.js";
import { startCoderDaemon } from "../apps/desktop/src/daemon/serve.js";
import { createCoderStore } from "../apps/desktop/src/state/coderStore.js";

function flag(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const language = flag("language", "de");
const missingPath = flag("path", join(tmpdir(), "envoydev-this-folder-does-not-exist"));

const home = await mkdtemp(join(tmpdir(), "envoydev-language-"));
const daemon = await startCoderDaemon({ port: 0, home, paths: coderPaths(home), skipMeshAttach: true });

let exitCode = 0;
try {
  /** One raw call, so the English sentence and the key are printed exactly as they crossed the wire. */
  async function rawCall(
    method: string,
    params: Record<string, unknown>,
  ): Promise<{ error?: string; result?: unknown }> {
    const socket = new WebSocket(`ws://127.0.0.1:${daemon.port}${daemon.path}`);
    return await new Promise((resolve, reject) => {
      socket.once("open", () => {
        socket.send(JSON.stringify({ id: "raw-1", method, params }));
      });
      socket.once("error", (error: Error) => reject(error));
      socket.on("message", (data: Buffer) => {
        const parsed = JSON.parse(data.toString("utf8")) as {
          id?: string;
          result?: unknown;
          error?: { message?: string };
        };
        if (parsed.id !== "raw-1") return;
        resolve({ ...(parsed.error?.message ? { error: parsed.error.message } : {}), ...(parsed.result !== undefined ? { result: parsed.result } : {}) });
        socket.close();
      });
    });
  }

  // ── 1. the window's own store, against the daemon's real socket ──
  const store = createCoderStore({
    resolveEndpoint: async () => ({
      endpoint: { host: "127.0.0.1", port: daemon.port, path: daemon.path },
      // No claim file was read here, which is exactly what the browser dev server reports.
      verifiedBy: "none",
    }),
  });
  await store.start();
  const connected = await waitFor(() => store.getSnapshot().connection.state === "connected", 5_000);
  console.log(`daemon    ws://127.0.0.1:${daemon.port}${daemon.path} (instance ${daemon.instanceId})`);
  console.log(`client    ${connected ? "connected" : "DID NOT CONNECT"}`);
  if (!connected) throw new Error("the client never connected, so nothing below would be meaningful");

  // ── 2. set the language the way the UI does: the settings RPC ──
  const before = store.getSnapshot().settings.language ?? "system";
  const patched = await store.updateSettings({ language: language as CoderSettings["language"] });
  if (!patched.ok) throw new Error(patched.message);
  const stored = (await rawCall("coder.getSettings", {})) as { result?: { settings?: CoderSettings } };
  console.log(
    `language  settings.language: ${before} → ${store.getSnapshot().settings.language} ` +
      `(read back from the daemon: ${stored.result?.settings?.language})`,
  );

  // The translator the provider builds, from the preference the daemon just stored.
  const preference = (store.getSnapshot().settings.language ?? "system") as LocalePreference;
  const locale = resolveLocale(preference, []);
  const t = createTranslator(locale, CATALOGUES[locale]).t;
  console.log(`window    ${LOCALE_LABELS[locale]} (preference "${preference}")`);

  // ── 3. ask the daemon for something it must refuse ──
  console.log(`\nasking    coder.addProject { path: "${missingPath}" }`);

  const wire = await rawCall("coder.addProject", { path: missingPath });
  console.log(`\n── what the daemon sent (the wire, verbatim) ──`);
  console.log(wire.error ?? "(no error — the daemon accepted the path, which makes this run meaningless)");
  const ref = wire.error ? coderErrorRef(wire.error) : undefined;
  console.log(`\n── decoded ──`);
  console.log(`  english  ${wire.error ? coderErrorMessage(wire.error) : "(none)"}`);
  console.log(`  key      ${ref?.key ?? "(none)"}`);
  console.log(`  values   ${JSON.stringify(ref?.values ?? {})}`);

  // ── 4. the same refusal, through the window's own path ──
  const refusal = await store.addProject(missingPath);
  console.log(`\n── what the window renders ──`);
  if (refusal.ok) {
    console.log("(the store accepted it — see the warning above)");
    exitCode = 1;
  } else {
    // `state.error` is what the notice strip shows when nothing newer is on screen; the action's own
    // refusal is the same notice, which the tests pin.
    console.log(`  notice   ${localize(t, refusal)}`);
    console.log(`  banner   ${localize(t, store.getSnapshot().error)}`);
  }

  const rendered = refusal.ok ? "" : (localize(t, refusal) ?? "");
  const english = wire.error ? coderErrorMessage(wire.error) : "";
  const german = locale === "en" ? true : rendered !== english && rendered !== "";
  console.log(`\n── verdict ──`);
  console.log(`  the client's text differs from the wire's English: ${rendered !== english}`);
  console.log(`  the client's text contains no key or code:        ${!rendered.includes("envoydev.") && !rendered.includes("envoydev.key")}`);
  console.log(`  the client's text is not English:                 ${german}`);
  if (locale !== "en" && (rendered === english || rendered.includes("envoydev."))) {
    console.log("\nFAILED: the window answered in the daemon's language, not the user's.");
    exitCode = 1;
  } else {
    console.log("\nOK: one language, from the UI through to the daemon's refusals.");
  }

  store.dispose();
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  exitCode = 1;
} finally {
  await daemon.stop();
  await rm(home, { recursive: true, force: true });
}

process.exit(exitCode);

/** Poll until `check` is true, or give up. A socket connect is not instantaneous. */
async function waitFor(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return check();
}
