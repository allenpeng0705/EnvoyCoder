/**
 * `@envoycoder/protocol` — the public surface.
 *
 * Three modules, and the split is the package's own architecture rather than tidiness:
 *
 *   * `domain.ts` — the **nouns**: agents, projects, tasks, runs, run events, errors, the
 *     method catalogue, settings. Product vocabulary, no transport.
 *   * `rpc.ts` — the **wire**: the JSON-RPC envelope, the schema of every method in the catalogue,
 *     the broadcast event names, and the error-code convention. Transport vocabulary, built on the
 *     nouns.
 *   * `agent-auth.ts` — **one subject the other two both need**: what an agent's authentication is (three
 *     states, `unknown` until a probe says otherwise), the record a probe leaves behind, and the
 *     vocabulary of an attempted sign-in. `domain.ts` names its methods and `rpc.ts` schematises its
 *     answers, so it could live in neither of them without one owning a fact the other reads.
 *
 * Why separate files and not one: `zod` schemas are evaluated when the module loads, so a single module
 * that both declared `HarnessIdSchema` and used it to build the method table would only work
 * because of the order its statements happen to run in. Separate modules make the dependency a fact the
 * compiler checks, and the direction is one way — which is what keeps it acyclical:
 * `agent-auth.ts` → `domain.ts` → `rpc.ts`, with `index.ts` reading all three.
 *
 * Everything a client needs is reachable from here, which is deliberate: the window, the phone's
 * generated stubs and the daemon all import this one name, so "what did we agree to say?" has one
 * answer that cannot be half-updated.
 */

export * from "./domain.js";
export * from "./agent-auth.js";
export * from "./rpc.js";
