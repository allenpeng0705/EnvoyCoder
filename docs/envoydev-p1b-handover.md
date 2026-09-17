# P1b handover: put EnvoyMesh's node onto the shared mesh transport

**For:** the agent picking this up · **Repo:** `../EnvoyMesh` (all paths below are relative to it unless stated otherwise) ·
**Design:** `EnvoyCoder/docs/envoydev-mesh-transport.md` · **Plan:** `EnvoyCoder/docs/envoydev-mesh-transport-plan.md` ·
**Gate:** `RUN_E2E=1 npx vitest run apps/node/test/relay-bridge-e2e.test.ts` (the file is **excluded** from the
default suite — `vitest.config.ts` excludes `**/test/**/*e2e*.test.ts`, so it must be invoked deliberately)

---

## 0. What exists, and why P1b is next

The reusable transport is written and green: `packages/host-connect/src/mesh-host-transport.ts`
(handshake, newline-delimited framing, request/reply, event push, a device-scoped close registry), 8 unit
tests, exported through `reuse-host` and consumed by `@envoydev/host-bridge`.

**The node does not use it.** `apps/node/src/client-proxy-handler.ts` (293 lines) still owns its own
handshake, its own framing and its own request loop. P1b replaces that plumbing with the shared
transport and leaves the product-bound middle where it belongs. After P1b, "serve a product host over a
mesh stream" exists once in the family instead of once per product — which is what EnvoyDev's daemon
needs for P3.

**Everything is verified green before you start:** `npx tsc -b` → 0, `relay-bridge-e2e` → 15/15 in
314 ms, `npx vitest run packages/host-connect` → 40/40. If any of those is red when you arrive, the tree
has moved and you are fixing someone else's problem first.

---

## 1. Prerequisite: the transport's options must be built **per connection**

**Do this first. P1b is unsafe without it, and the leak is silent.**

Today:

```ts
createMeshHostTransport(options)              // options built once…
  → (duplex: FramedDuplex) => Promise<void>   // …and invoked once per connection
```

Every closure built in `options` is therefore **shared by every connection**. The node needs
per-connection state, and not incidentally:

| State | Declared at | If shared between connections |
|---|---|---|
| `const companion = {}` | `client-proxy-handler.ts:70` — inside the per-connection closure | one phone's terminal WS session appears in another's; `closeHomeTerminalWsForCompanion` on one stream tears down the other's |
| `tokenRecord`, `reviewToken`, `rpcCaller` | derived in the handshake, per token | a second phone inherits the first's caller identity and family-profile binding |
| `unwirePush` | per connection | the first stream to close unwires the *second* stream's event push |

Change the signature to a **factory**:

```ts
export function createMeshHostTransport<TCaller = unknown>(
  options: MeshHostTransportOptions<TCaller> | ((duplex: FramedDuplex) => MeshHostTransportOptions<TCaller>),
): (duplex: FramedDuplex) => Promise<void> {
  return async (duplex) => {
    const resolved = typeof options === "function" ? options(duplex) : options;
    // …the existing body, reading `resolved.sessionIdentity` / `.dispatch` / `.subscribe` / `.onSession`
  };
}
```

**Do not keep both shapes as "convenience".** Two ways to build the same thing, one of which silently
shares per-connection state, is the defect this change exists to remove. A caller that needs no
per-connection state writes `() => options` — one line, and honest about what it is doing.

**Then:**
1. Update the 8 tests in `packages/host-connect/test/mesh-host-transport.test.ts` to the factory form.
   Add one test that **two concurrent connections keep their own state** — it is the regression test for
   the leak, and nothing else covers it (the e2e dials one connection at a time, which is exactly why
   the leak would have shipped).
2. `npx tsc -p packages/host-connect/tsconfig.json && npx tsc -p packages/reuse-host/tsconfig.json`
3. `npx vitest run packages/host-connect` → 40+ green.
4. `node scripts/classify-modules.mjs` if you add a module (it regenerates `scripts/module-boundary.json`;
   the package-surface test fails if a module in that package is unclassified — do not hand-edit the JSON).

---

## 2. P1b: the migration, site by site

### 2.1 The three ports, and where each part of today's handler goes

Read `apps/node/src/client-proxy-handler.ts` in full before editing. The mapping:

**`sessionIdentity.resolveSession(token)` — the handshake body, minus every wire write.**

Today, in order (lines ~84–140):

1. `readFrame()` → `JSON.parse` → `handshake.token` → **drop**: the transport reads the frame.
2. `if (!token || !(await nodeService.validatePairingToken(token)))` → reject → **return `null`**; the
   transport writes the `proxy-reject`.
3. `const tokenRecord = await nodeService.lookupSessionToken(token)` — **keep**, assign to the factory's
   scope so `dispatch` can see it.
4. `const reviewToken = tokenRecord ? false : await nodeService.isReviewPairingToken(token)` — **keep**.
5. The caller build: `sessionCallerFromToken` / `anonymousPairingCaller` / `localOwnerCaller`, then the
   `listFamilyProfiles()` reconciliation that sets `rpcCaller` — **keep verbatim**. This is the family-profile
   binding; dropping it collapses every profile onto the owner thread.
6. `registerClientProxyStream(tokenRecord?.deviceId, () => stream.close())` → **delete**; return the
   deviceId in the session and let the transport's `createProxyCloseRegistry()` own it (see §2.3).
7. `writeFrame({type:"proxy-accept"})` → **delete**; the transport writes it.
8. `unwirePush = wireClientProxyPushEvents(nodeService, rpcCaller, cb)` → **delete**; it becomes
   `subscribe` (see §2.2).

Return the session: `{ scopeKey, ownerId, isOwnerScope, deviceId: tokenRecord?.deviceId, caller: rpcCaller }`.
`rpcCaller` is opaque to the transport and comes straight back as `dispatch`'s third argument.

**`dispatch(method, params, session)` — the loop body, minus framing and id correlation.**

From line ~144: `readFrame()` → parse → `if (!msg.id || !msg.method) continue` → **delete all three**; the
transport owns reading, parsing and correlating `id`.

**Keep, in this order:**
1. The per-RPC revocation recheck (`lookupSessionToken(token)` → if gone, throw so the transport answers;
   today it writes `UNAUTHORIZED` and `break`s — **change the `break` to a throw**, or the stream stays
   open after revocation).
2. The review-token allow-list (`pairThinClient`, `previewFamilyInvite`) → throw `UNAUTHORIZED` otherwise.
3. `PROXY_AUDIT_METHODS` and the audit behaviour.
4. The terminal methods `homeTerminalWsOpen` / `homeTerminalWsSend` / `homeTerminalWsClose` → the
   `rpcHomeTerminalWs*` calls, passing **the factory's `companion`** and the `emitEvent` equivalent.
5. Everything else: `runWithRpcCaller(rpcCaller, () => routeRpcMethod(...))`.
6. `isSelfRevokeResult(result, deviceId)` handling at the end.

**Return the RPC result.** The transport writes `{id, result}`. On failure **throw** — the transport
writes `{id, error: {code: "ERROR", message}}`, which is the family convention (the code rides in the
message; see the transport's `handleFrame`).

**`subscribe(send)` — the push.**

```ts
subscribe: (send) => wireClientProxyPushEvents(nodeService, rpcCaller, (event, data) => { send(event, data); })
```
Built **inside the factory**, so it closes over this connection's `rpcCaller`.

### 2.2 The shape you are writing

```ts
export function createClientProxyHandler(
  nodeService: NodeServiceImpl,
): (stream: unknown, _connection: unknown) => Promise<void> {
  const closes = createProxyCloseRegistry();
  return createMeshHostTransport((duplex) => {
    // Per-connection state, and the whole reason §1 exists.
    const companion = {};
    let tokenRecord: Awaited<ReturnType<NodeServiceImpl["lookupSessionToken"]>> | undefined;
    let reviewToken = false;
    let rpcCaller: RpcCallerContext = localOwnerCaller("");
    let unregister: () => void = () => undefined;

    return {
      sessionIdentity: {
        localScopeKey: /* unchanged */,
        resolveSession: async (token) => { /* §2.1 handshake body */ },
      },
      dispatch: async (method, params, session) => { /* §2.1 loop body */ },
      subscribe: (send) => wireClientProxyPushEvents(nodeService, rpcCaller, (e, d) => send(e, d)),
      onSession: () => { rpcCaller = /* caller from resolveSession */; },
    };
  })(meshStreamAsDuplex(stream));   // ← the adapter, §2.4
}
```

### 2.3 The close registry

`registerClientProxyStream` / `closeClientProxyStreamsForDevice` and the module-level
`proxyStreamCloseRegistry` are **used elsewhere** — grep before deleting:

```
grep -rn "closeClientProxyStreamsForDevice\|registerClientProxyStream" apps packages --include=*.ts
```

`closeClientProxyStreamsForDevice` is called on revocation; the current handler's per-connection
`unregister` must still be reachable. Either re-export the two names over a single
`createProxyCloseRegistry()` instance, or pass that instance in. **Do not end up with two registries** —
revocation would close one set of streams and leave the other open, which is revocation in name only.

### 2.4 The adapter: a libp2p stream as a `FramedDuplex`

The transport takes a `FramedDuplex` (`write(bytes)`, `read(): Promise<Uint8Array|undefined>`, `close()`).
The node has a libp2p stream and today wraps it with `byteStream(stream)` from `@libp2p/utils`.

Write the adapter **in `@envoymesh/network`**, beside `handleRawProtocol` — it is the only piece that
knows what a stream is, and `host-connect` deliberately does not depend on libp2p. Shape:

```ts
// packages/network/src/mesh-stream-duplex.ts
export function meshStreamAsDuplex(stream: P2PStreamLike): FramedDuplex
```
It must be **boundary-agnostic**: `read()` returns whatever arrived, and the transport's framing
reassembles. Do not re-implement splitting — `MeshFrameBuffer` in the Dart client and `splitFrames` in
`host-connect` are the two halves of one contract, tested on both sides.

### 2.5 Delete

`writeFrame`, `readFrame`, `rxBuffer`, `encoder`/`decoder` (if now unused), the two `streamIo.read()`
sites, and the `streamIo.write(...)` calls everywhere. The framing exists in the transport; a second copy
in the node is how the two drift.

---

## 3. Acceptance

| Check | Command | Expected |
|---|---|---|
| Types | `npx tsc -b` | 0 errors |
| **The gate** | `RUN_E2E=1 npx vitest run apps/node/test/relay-bridge-e2e.test.ts` | **15/15** |
| Transport unit | `npx vitest run packages/host-connect` | all green, including the new two-connection test |
| The app's own suite | `npx vitest run apps/node` | no new failures (baseline first — see §4) |

**What the gate does and does not prove.** It dials one connection at a time with a real libp2p stream,
and covers: handshake accept/reject, a good and a bad token, the review-token allow-list, revocation
mid-stream, terminal open/send/close, and a non-JSON frame. It does **not** cover two concurrent streams,
which is why §1's new unit test is not optional.

---

## 4. Traps, in the order they will bite

1. **Baseline before you change anything.** Run `RUN_E2E=1 npx vitest run apps/node/test/relay-bridge-e2e.test.ts`
   and `npx vitest run apps/node` first and record the result. Another agent's P1b has already been
   attempted here with no baseline, and five unrelated failures became unattributable. If you are in that
   situation: `git stash push -m baseline -- <paths you edited>` → run → `git stash pop`.
2. **The `break` after a revocation refusal** (§2.1) — as a `break` it closes nothing; as a throw it does.
3. **`companion` must be per connection.** If you put it in module scope or in the shared `options`, the
   leak of §1 returns and the e2e will not catch it.
4. **One close registry, not two** (§2.3).
5. **The terminal methods must not be moved into `routeRpcMethod`.** They are handled before it today, and
   `routeToNodeService`/`routeRpcMethod` will not know them.
6. **Do not touch the framing.** It was migrated deliberately across all three speakers (node, e2e client,
   Dart client) and `relay-bridge-e2e` went from 9 failures/547 s to 15/15 in 314 ms because of it. If you
   find yourself editing `encodeFrame` or `MeshFrameBuffer`, stop — you are undoing a decision.
7. **`npx tsc -p apps/node/tsconfig.json --noEmit`** may report errors in `json-rpc-router.ts` or
   `node-service-impl.ts` that are not yours — those two files carried uncommitted work when this handover
   was written. Check `git status` on a file before assuming you broke it.

---

## 5. After P1b

**P3** (EnvoyDev's daemon becomes its own mesh peer) and **P4** (the phone's dial order) are specified in
`EnvoyCoder/docs/envoydev-mesh-transport-plan.md` §2–§3. P1b is their prerequisite: P3 hands the daemon's
own `dispatch` to this same transport, and P4 cannot dial a route the pairing payload does not carry.
