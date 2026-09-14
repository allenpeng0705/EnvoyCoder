/**
 * The acceptance criterion, as a test: **a German window must not be answered in English by the daemon**.
 *
 * ## What this adds over `i18n.test.ts`
 *
 * That file proves the mechanism — a wire string with a key in it renders German. This one proves the
 * *producer*: it drives the daemon's real handlers and asserts that every refusal a user can read
 * arrives with a key this build's catalogue actually has. The failure it is written to catch is
 * silent by construction: a refusal with no key, or with a typo'd one, still renders — in English, to
 * a German user, which looks like a working app and is exactly the bug this milestone exists to fix.
 *
 * ## Why the handlers, and not a socket
 *
 * The socket adds a transport that is already covered (`daemon-rpc.test.ts`) and nothing about
 * language. What matters here is what each handler *throws*, which is a function call.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ENVOYCODER_ERRORS, coderErrorCode, coderErrorMessage, coderErrorRef } from "@envoycoder/protocol";
import { coderPaths } from "@envoycoder/host-bridge";

import { CATALOGUES } from "../src/i18n/catalogues.js";
import { en, isMessageKey, type MessageKey } from "../src/i18n/messages/en.js";
import { localize, noticeOf } from "../src/i18n/notice.js";
import { createTranslator } from "../src/i18n/translate.js";
import { createCoderHandlers, type CoderHandler } from "../src/daemon/service.js";
import { CoderStore } from "../src/daemon/store.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** The daemon's handler table over a throwaway home, with `isDirectory` answering "no". */
async function handlersThatRefuse(): Promise<Record<string, CoderHandler>> {
  const home = await mkdtemp(join(tmpdir(), "envoycoder-i18n-"));
  const paths = coderPaths(home);
  const store = await CoderStore.open({ paths });
  cleanups.push(async () => {
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const handlers = createCoderHandlers({
    store,
    paths,
    instance: {
      instanceId: "i18n-test",
      version: "0.1.0",
      startedAt: "2026-09-14T00:00:00.000Z",
      connectionCount: () => 1,
    },
    mesh: () => ({ kind: "no-node", reason: "not attached in this test" }),
    // Nothing on this machine is a directory, which is how each refusal below is reached without
    // touching a real filesystem.
    isDirectory: async () => false,
    // No run manager: the run methods refuse by name, which is itself one of the refusals tested.
  });

  return handlers as Record<string, CoderHandler>;
}

/** Call a handler and return the failure it threw, which is what the transport would serialize. */
async function refusalOf(
  handlers: Record<string, CoderHandler>,
  method: string,
  params: Record<string, unknown>,
): Promise<string> {
  try {
    await handlers[method]?.(params);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`${method} did not refuse — this test needs a refusal to inspect`);
}

const german = createTranslator("de", CATALOGUES.de).t;

describe("every refusal a user can read", () => {
  /**
   * The refusals a window can actually put on screen, and the key each one must carry.
   *
   * Kept as data rather than as several near-identical tests: the point is the *list*, and a new
   * refusal added to the daemon without a translation should be one line here rather than a new
   * assertion nobody writes.
   */
  const cases: readonly { method: string; params: Record<string, unknown>; key: MessageKey }[] = [
    {
      // The acceptance criterion's own example: a path that is not a directory on this machine.
      method: "coder.addProject",
      params: { path: "/tmp/envoycoder-does-not-exist" },
      key: "error.addProject.notDirectory",
    },
    {
      method: "coder.createTask",
      params: { projectId: "local::/nope", title: "add the keys" },
      key: "error.projectNotFound",
    },
    {
      method: "coder.updateProject",
      params: { id: "local::/nope" },
      key: "error.projectNotFound",
    },
    {
      method: "coder.updateTask",
      params: { id: "w-nope" },
      key: "error.taskNotFound",
    },
    {
      // The folder control's own refusal: `isDirectory` says no to everything in this fixture, so the
      // path is reached exactly as the window reaches it when a user picks a folder that has gone.
      // (The other half of the check below — that the English matches byte for byte — is what stops
      // this sentence and `en.ts` drifting apart, and it is only *this* test that can see both.)
      method: "coder.updateTask",
      params: { id: "w1", cwd: "/tmp/envoycoder-does-not-exist" },
      key: "error.updateTask.notDirectory",
    },
    {
      method: "coder.archiveTask",
      params: { id: "w-nope" },
      key: "error.taskNotFound",
    },
    {
      method: "coder.startRun",
      params: { taskId: "w-nope", prompt: "hello" },
      key: "error.noRunRuntime",
    },
    {
      method: "coder.tailRun",
      params: { runId: "r-nope" },
      key: "error.noRunRuntime",
    },
    {
      method: "coder.sendToRun",
      params: { runId: "r-nope", text: "hello", mode: "queue" },
      key: "error.noRunRuntime",
    },
    {
      // A user's provider may not take the id of an agent we ship: the two rows would be indistinguishable
      // wherever an id is the key.
      method: "coder.addProvider",
      params: { id: "codex", label: "Codex (mine)", command: "my-codex", transport: "acp" },
      key: "error.providerIdTaken",
    },
    {
      // **A value where a name belongs**, which is the credential case: this project stores variable names
      // and never values, so a key pasted into that field is refused — and the refusal quotes the
      // *position*, never what was pasted, because a refusal reaches a log and a bug report.
      method: "coder.addProvider",
      params: {
        id: "my-agent",
        label: "My Agent",
        command: "auggie",
        env: ["sk-live-0000-not-a-real-key"],
        transport: "acp",
      },
      key: "error.providerEnvNotAName",
    },
    {
      // An id a client invented that is not the shape a provider id has. The daemon refuses rather than
      // silently rewriting it, so a second window and this one agree on what the provider is called.
      method: "coder.addProvider",
      params: { id: "My-Agent", label: "My Agent", command: "auggie", transport: "acp" },
      key: "error.providerIdInvalid",
    },
    {
      method: "coder.removeProvider",
      params: { id: "no-such-provider" },
      key: "error.providerNotFound",
    },
  ];

  it("carries a key this build knows, alongside the English sentence", async () => {
    const handlers = await handlersThatRefuse();
    for (const testCase of cases) {
      const message = await refusalOf(handlers, testCase.method, testCase.params);
      const ref = coderErrorRef(message);
      expect(ref?.key, `${testCase.method} carried no key`).toBe(testCase.key);
      // A key the catalogue does not have is worse than no key: it would fall back to English while
      // looking translated in review.
      expect(isMessageKey(ref?.key ?? ""), `${testCase.method} key "${ref?.key}" is unknown`).toBe(true);
      // …and the English sentence is untouched: it is the fallback and the log line.
      expect(coderErrorMessage(message)).not.toContain("envoycoder.key");
      expect(coderErrorCode(message)).not.toBeNull();
    }
  });

  it("renders German for a German window, and the same English for an English one", async () => {
    const handlers = await handlersThatRefuse();
    for (const testCase of cases) {
      const wire = await refusalOf(handlers, testCase.method, testCase.params);
      const notice = noticeOf(wire);
      const english = coderErrorMessage(wire);

      // German: the sentence the user reads is the catalogue's, in German, with the values filled in.
      const rendered = localize(german, notice) ?? "";
      expect(rendered, testCase.method).not.toBe("");
      expect(rendered, testCase.method).not.toBe(english);
      expect(rendered, testCase.method).not.toContain("envoycoder.");

      // English: byte-identical to the daemon's own sentence. A user who never opens the language
      // setting must not see this milestone at all.
      const englishTranslator = createTranslator("en", en).t;
      expect(localize(englishTranslator, notice), testCase.method).toBe(english);
    }
  });

  it("names the path or the id it refused, in the user's language", async () => {
    // The values are what make a translated refusal *useful*: "kein Verzeichnis" without the path is
    // a sentence a user cannot act on.
    const handlers = await handlersThatRefuse();
    const path = "/tmp/envoycoder-does-not-exist";
    const wire = await refusalOf(handlers, "coder.addProject", { path });
    const rendered = localize(german, noticeOf(wire)) ?? "";
    expect(rendered).toContain(path);
    expect(rendered).toContain("kein Verzeichnis");

    const missing = await refusalOf(handlers, "coder.updateTask", { id: "w-nope" });
    expect(localize(german, noticeOf(missing)) ?? "").toContain("w-nope");

    // A provider's refusals carry their values too — the id that is taken, the provider that is gone — for
    // the same reason: "dieser Name ist vergeben" without the name is a sentence a user cannot act on.
    const taken = await refusalOf(handlers, "coder.addProvider", {
      id: "codex",
      label: "Codex (mine)",
      command: "my-codex",
      transport: "acp",
    });
    expect(localize(german, noticeOf(taken)) ?? "").toContain("codex");
  });

  it("leaves a developer-only refusal in English, and says so by having no key", async () => {
    // `parseRpcParams` names the method and the field: "which call, which argument" is the whole
    // value, the Zod detail inside it is English prose, and a user seeing it means this app sent a
    // bad call — a bug report, not a sentence to translate.
    const handlers = await handlersThatRefuse();
    const wire = await refusalOf(handlers, "coder.addProject", { path: "" });
    expect(coderErrorCode(wire)).toBe(ENVOYCODER_ERRORS.badRequest);
    expect(coderErrorRef(wire)).toBeUndefined();
    expect(noticeOf(wire)?.key).toBeUndefined();
    // Which means a user reads it in English — the honest outcome for a message addressed to us.
    expect(localize(german, noticeOf(wire)) ?? "").toContain("coder.addProject");
  });
});
