# Finishing the mesh transport: the remaining work, step by step

**Status:** plan · **Predecessor:** `docs/envoydev-mesh-transport.md` (design, wire contract, decisions) ·
**Rule:** reusable things are built in EnvoyMesh; EnvoyDev consumes them.

---

## 0. What is already done (so the steps below start from truth)

| Done | Evidence |
|---|---|
| The reusable transport: handshake, newline framing, request/reply, event push, revocation registry, over any duplex — `EnvoyMesh/packages/host-connect/src/mesh-host-transport.ts` | 8 unit tests; 40/40 in that package |
| Exported through the product-facing surface: `host-connect` → `reuse-host` → `@envoydev/host-bridge` | EnvoyDev `tsc -b` clean; `wiring:check` clean |
| **Framing migrated on all three speakers**: the node's handler, the e2e client, and the Dart client (`envoy-mesh-libp2p-dart/lib/src/mesh_framing.dart`) | `RUN_E2E=1 npx vitest run apps/node/test/relay-bridge-e2e.test.ts` → **15/15 in 314 ms** (from 9 failures / 547 s of timeouts) |
| EnvoyMesh's whole build: **`npx tsc -b` exits 0**, 55 tests green | after resolving the six outstanding type errors (see §5) |

Nothing else in the design has been built: the node still runs its **own** handler, EnvoyDev's daemon has
no mesh peer, and the phone has no mesh dial path.

---

## 1. P1b — put the node onto the shared transport

**Goal:** `apps/node/src/client-proxy-handler.ts` stops owning the handshake, the framing, the
request/reply loop and the push plumbing, and passes its product-bound middle in as ports.

**The mapping, site by site** (the file is 293 lines; only the middle moves):

| Today, in the node's handler | Becomes |
|---|---|
| `streamIo.read()` + `JSON.parse` handshake; `validatePairingToken`; `lookupSessionToken`; review-token check; `localOwnerCaller` / `sessionCallerFromToken` / family-profile binding | the transport's `sessionIdentity.resolveSession(token)` — one function returning a session or `null` |
| the `while (true)` loop, `JSON.parse`, the per-RPC revocation recheck, the review-token method allow-list, `rpcHomeTerminalWsOpen/Send/Close`, `routeRpcMethod`, `isSelfRevokeResult` | the transport's `dispatch(method, params, session)` — the node's closure keeps every rule above; the transport only moves bytes and correlates `id`s |
| `wireClientProxyPushEvents(...) → emitEvent` | the transport's `subscribe(send)` |
| `registerClientProxyStream` / `closeClientProxyStreamsForDevice` / `proxyStreamCloseRegistry` | `createProxyCloseRegistry()` from the transport |
| `writeFrame` / `readFrame` / `writeFrame` at 15 sites | **deleted** — the transport owns framing |

**Steps**

1. In `client-proxy-handler.ts`, build the two closures:
   * `resolveSession(token)`: today's handshake body (validate → look up → review check → caller), returning
     `{ scopeKey, ownerId, isOwnerScope, deviceId, caller }` or `null`. **Keep the token, `tokenRecord`,
     `reviewToken` and `companion` in the closure** — `dispatch` needs them.
   * `dispatch(method, params, session)`: today's loop body from the revocation recheck onward.
2. Replace the body of `createClientProxyHandler` with
   `createMeshHostTransport({ sessionIdentity: { localScopeKey, resolveSession }, dispatch, subscribe })`
   and return it.
3. Delete the now-unused `writeFrame`, `readFrame`, `rxBuffer`, `encoder`-based writes, and
   `registerClientProxyStream`/`closeClientProxyStreamsForDevice` (re-export the registry's two functions
   from the transport's `createProxyCloseRegistry()` so callers elsewhere keep working — grep for them
   first; `revokeThinClient` paths use `closeClientProxyStreamsForDevice`).
4. **Gate:** `RUN_E2E=1 npx vitest run apps/node/test/relay-bridge-e2e.test.ts` → 15/15, and
   `npx tsc -b` → 0.
5. Only then delete the hand-rolled framing behaviour from the test client if the test can drive the
   transport's own shape; the test's `encodeFrame` should stay either way — it is the client half.

### 1a. The blocker P1b found before it could break anything

Reading the handler for the `companion` object settled the risk I had flagged, and turned up a flaw in
the transport rather than in the node:

* `const companion = {}` is declared **inside the per-connection closure** (`client-proxy-handler.ts:70`),
  used by the terminal methods (227, 242, 251) and cleaned up in `finally` (289). So its lifetime is one
  stream — **not** one RPC. The same is true of `tokenRecord`, `reviewToken` and `rpcCaller`, which are
  all bound per connection.
* `createMeshHostTransport(options)` takes its options **once** and returns `(duplex) => Promise<void>`,
  which is invoked per connection. So closures built in `options` are **shared by every connection** —
  and a migration that put `companion`/`tokenRecord` there would leak one phone's terminal session and
  one phone's caller identity into another's.

**So P1b needs a transport change first**, and it is small and worth doing on its own:

```ts
// today
createMeshHostTransport(options)            // options built once, shared by all connections
// needed
createMeshHostTransport((duplex) => options) // options built per connection, so per-connection
                                             // state is per-connection by construction
```

Keeping both shapes (an object, or a factory) would be the worse answer: two ways to build the same
thing, and the wrong one silently shares state. **Make it a factory, and let the type system say so** —
a caller that needs no per-connection state writes `() => options`, which is one line and honest about
what it is doing.

**Risk, stated:** the terminal methods (`homeTerminalWsOpen`/`Send`/`Close`) attach a `companion` object
that lives across RPCs. It must move into the `dispatch` closure, or a stream's terminal session would be
recreated per call. This is the one place the migration can silently change behaviour, which is why the
e2e suite — not the type checker — is the gate.

---

## 2. P3 — EnvoyDev's daemon becomes its own peer

**Goal:** the desktop, with **no EnvoyMesh process running**, is reachable by the phone over a direct
libp2p stream or the shared relay.

1. **Identity.** `<home>/EnvoyDev/secrets/mesh-identity.json`, a libp2p seed of EnvoyDev's own. **Never**
   the family profile's key: two processes with one identity is corruption, and starting EnvoyMesh would
   create exactly that. Reuse `@envoymesh/network`'s seed/store shape for the file format.
2. **Peer.** In `apps/desktop/src/daemon/serve.ts`, construct an `EnvoyMesh` with that seed and the
   shared roster from `packages/api/src/relay-roster.ts` (cn + us) — the roster is a family contract, read
   never copied.
3. **Serve.** `peer.handleRawProtocol(CLIENT_PROXY_PROTOCOL, createMeshHostTransport({ sessionIdentity:
   coderSessionIdentity({ resolveSession: pairedDevices.resolveSession }), dispatch: createCoderDispatcher({ handlers }), subscribe: … }))`
   wrapped in the `MeshHostSocket` adapter that turns a libp2p stream into a `FramedDuplex`. **The
   adapter is the one new piece** and belongs in `@envoymesh/network` next to `handleRawProtocol`, because
   it is the only part that knows what a stream is.
4. **Reserve.** Reserve on each relay; expose `RelayReservationStatus` through `coder.meshStatus` so the
   status bar can say "reachable from anywhere" instead of guessing.
5. **Publish.** `coder.mintPairing` gains the peer id, the LAN multiaddrs and the relay circuit hints,
   and mints the compressed `pairing=<base64url-gzip-json>` form. Today `serve.ts` passes no `relay` at
   all, so a code can only ever name a LAN address — that is the bug this step fixes.
6. **Gate:** a new smoke leg — a **second in-process peer** dials EnvoyDev's daemon over the mesh and gets
   `coder.hello`, with no EnvoyMesh process anywhere. This is the leg that proves §1 and §2 together.

---

## 3. P4 — the phone dials direct first, then the relays

1. `RouteResolver` today: `lan → primary → ssh → relay(+extras)`. Insert the **mesh** between `ssh` and
   the relay bases, so the order is `lan → primary → direct libp2p → ssh → cn → us`.
2. Direct first is not a preference — it is the whole point of the family's transport: a home machine with
   no public address still often reaches a phone on the same city network directly, and only falls back to
   a relay when it cannot. `dial-budget.ts` in `@envoymesh/network` owns the timeouts; do not invent one.
3. Use the Dart twins: `envoy_mesh_libp2p` to dial, `envoy_thin_client` for the framing and pairing.
4. **Report which route is in use** in the UI. "Connected" hides a real difference to a user on metered
   or slow links, and the plan's §5 already says so.
5. **Gate:** Dart tests for candidate order, and one recorded run against a real desktop.

---

## 4. The order, and why

**P1b → P3.3 → P3.5 → P3.6 → P4.** P1b first because it is the node proving the transport works before a
second consumer depends on it; P3.3 next because the daemon is that second consumer; P3.5 before P4
because a phone cannot dial a route the code does not carry; the smoke leg (P3.6) before the phone,
because it proves the daemon is reachable without needing a device to find out.

---

## 5. The type errors, resolved this session (for the record)

| Error | Resolution |
|---|---|
| 4 × `permissionPolicy` missing in `apps/node` | Stale built `dist/` — `npx tsc -b` cleared them |
| 2 × `permissionPolicy` widened to `string` in `packages/api/src/coding-harness-runtime.ts` | The inline narrowing lost its literal type inside the object literal. Extracted to a **declared** local, because a fresh literal type widens when spread and a declared union does not |
| 1 × `setEnvoyHarnessCollaborationMode` not on `RpcMethods` | **Removed.** The method was declared nowhere and called by nothing — no UI, no test, no service. An unreachable router case; implementing it would have meant inventing a feature and its semantics |
| 1 + 3 × `HarnessProbeBadge` | Four declarations of one name with different memberships, which compiled in isolation and failed when one component's record was handed to another. Now declared once in `lib/coding-harness-probe.ts` and imported by the three consumers |

**If `setEnvoyHarnessCollaborationMode` was a feature you were building**, it comes back as a proper
addition: the method in the RPC contract, on `NodeService`, an implementation on `NodeServiceImpl`
mirroring `setEnvoyHarnessAutoRunPolicy`, and a caller. The removed router case is in this document's
§5 so it can be restored deliberately rather than rediscovered.

---

## 6. `setEnvoyHarnessCollaborationMode` — status, settled

**Backend: complete and verified.** All five wiring points now exist:

| Piece | Where |
|---|---|
| Declared on `NodeService` | `packages/api/src/node-service.ts:2394` — *"Native EH Mode — Default / Plan / Review (`session/set_mode`)"* |
| RPC catalogue | `packages/api/src/ws-protocol.ts` (`RpcMethods`) |
| Router table | `apps/node/src/json-rpc-router.ts:196` |
| Router switch case | `apps/node/src/json-rpc-router.ts` (beside `setEnvoyHarnessAutoRunPolicy`) |
| Implementation | `apps/node/src/node-service-impl.ts:6915` |

The catalogue line was the one that was missing, and its absence is what made a finished backend look
broken: declared, implemented, tabled — and **not nameable by any client**. Adding it also tripped the
generated-surface check (`core-surface.test.ts`), which is satisfied by re-running
`node scripts/generate-core-surface.mjs` rather than editing the artifact.

**Frontend: not built.** Nothing in the window calls it. The pattern to copy is the panel's existing
mode plumbing:

* `apps/social/src/components/views/EnvoyHarnessPanel.tsx` — the `/permissions` slash command
  (~line 948) reads `status.autoRunPolicy`, refuses an empty argument by *reporting the current value*,
  then calls `setEnvoyHarnessAutoRunPolicy` and sets the status from the answer. A `/mode` command is the
  sibling: `session/set_mode` with `Default | Plan | Review`.
* The select control at ~line 1346 is the other half — the same shape with the three mode values.

**A note on this document's §5.** It records that the case was removed because the method was "declared
nowhere". That was wrong: one grep returned nothing and the empty result was trusted. The lesson is in
the family's own rule — a claim about the code needs a source, and an absent grep result is not a source.
