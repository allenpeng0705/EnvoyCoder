/**
 * `@envoycoder/protocol` — the public surface.
 *
 * Two modules, and the split is the package's own architecture rather than tidiness:
 *
 *   * `domain.ts` — the **nouns**: agents, projects, tasks, runs, run events, errors, the
 *     method catalogue, settings. Product vocabulary, no transport.
 *   * `rpc.ts` — the **wire**: the JSON-RPC envelope, the schema of every method in the catalogue,
 *     the broadcast event names, and the error-code convention. Transport vocabulary, built on the
 *     nouns.
 *
 * Why two files and not one: `zod` schemas are evaluated when the module loads, so a single module
 * that both declared `HarnessIdSchema` and used it to build the method table would only work
 * because of the order its statements happen to run in. Two modules make that dependency a fact the
 * compiler checks.
 *
 * Everything a client needs is reachable from here, which is deliberate: the window, the phone's
 * generated stubs and the daemon all import this one name, so "what did we agree to say?" has one
 * answer that cannot be half-updated.
 */

export * from "./domain.js";
export * from "./rpc.js";
