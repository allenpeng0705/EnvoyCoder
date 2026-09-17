# The mesh transport: how the phone reaches a machine with no public address

**Status:** design, not yet built · **Owner:** the connection · **Reuses:**
`@envoymesh/network`, `@envoymesh/host-connect`, `@envoymesh/reuse-host`, `envoy_thin_client`,
`envoy_mesh_libp2p` · **Rule:** reusable things are built in EnvoyMesh and consumed here.

---

## 1. The problem, stated exactly

EnvoyDev's phone has to reach EnvoyDev's daemon on a home machine. The routes that exist today:

| Route | Works when | State |
|---|---|---|
| WebSocket over LAN | the phone is on the same network | **built and proven** (`scripts/smoke.ts`, the paired-device leg) |
| WebSocket over an SSH hop | the user can SSH to the machine | built (phone-initiated tunnel via `dartssh2`) |
| Anything else | the machine has no public address | **missing** |

A home machine has no public address and no port forwarding. That is the normal case, not the edge
case, so the missing row is the one that matters.

## 2. The shape of the answer, and the mistake to avoid

**EnvoyMesh is not in this picture.** When EnvoyDev's desktop and phone are running there is no
EnvoyMesh node, no EnvoyMesh app, and nothing to proxy through. EnvoyDev **reuses EnvoyMesh's code**
to be its own peer on the family's shared network:

```
  EnvoyDev desktop                                     EnvoyDev phone
  ┌─────────────────────┐                            ┌──────────────────┐
  │ daemon              │                            │ Flutter app      │
  │  ├ coder.* dispatch │◀──── one host protocol ────│ └ thin client    │
  │  └ mesh host socket │      two transports        │   + mesh dialer  │
  │     └ EnvoyMesh peer├──direct libp2p────────────▶│                  │
  └─────────┬───────────┘                            └────────┬─────────┘
            │ reserve on the shared roster                    │
            ▼                                                 ▼
      ┌───────────────────────────────────────────────────────────┐
      │ relay (cn, then us) — the family's, shared, extensible    │
      └───────────────────────────────────────────────────────────┘
```

**The mistake this design exists to prevent**, because it was made twice while writing this: treating
the phone's route as "attach to a running EnvoyMesh node as a product" and looking for a product proxy
inside the node. There is none, and there is nothing to proxy to — the node is not running. EnvoyDev's
`attachToMeshNode` path (attaching to a *local* EnvoyMesh when the user happens to run one) is a
**separate, optional feature**. It is not, and must never be documented as, the phone's route.

## 3. What the family already gives us

Verified by reading the packages, not the prose:

| Piece | Where | What it is |
|---|---|---|
| The mesh peer | `EnvoyMesh/packages/network` — `export class EnvoyMesh` (`src/index.ts:628`) | a libp2p node: listen, dial, discover, streams |
| Relay reservation | same package — `RelayReservationState = "off" \| "pending" \| "reserved" \| "failed"` (`:421`), `RelayReservationStatus` (`:423`), `computeReservationBackoffDelay` (`:140`) | registering on a relay is a first-class API, with its own backoff |
| Relay addressing | `relay-circuit-hints.ts`, `relay-listen-addrs.ts` | the addresses a pairing payload must carry |
| Framed streams | `data-framing.ts`, `InboundDataTransfer`, `MeshOutboundOptions` (`:328`, `:338`) | bytes over a stream, with framing |
| The relay roster | `packages/api/src/relay-roster.ts` — `DEFAULT_ENVOY_COMMUNITY_RELAY_BOOTSTRAP_ADDR` (cn), `DEFAULT_ENVOY_US_RELAY_BOOTSTRAP_ADDR` (us) | the shared list, extensible; re-exported through `reuse-host`, which we already depend on |
| The product host | `@envoymesh/host-connect` + `@envoymesh/reuse-host` | WS host, QR/pairing issuance, token validation — **in use today** |
| The phone's twins | `envoy_thin_client`, `envoy-mesh-libp2p-dart` | the Dart side of pairing and of the mesh |

**`docs/family/envoymesh-refactoring-plan.md` §8.17 already names this work and names us**: the missing
"Second-product proof" is *"a minimal TypeScript/desktop consumer that hosts QR + the harness from the
extracted packages — the real EnvoyDev spike"*. We are the refactoring's acceptance test.

## 4. What is missing, precisely

Nothing joins the two halves **in the packages** — but the join is *not unwritten*. The family has
already built and end-to-end tested the exact pattern, one layer up:

| Found | Where | Why it matters |
|---|---|---|
| `handleRawProtocol(protocol, handler)` | `packages/network/src/index.ts:2913` | gives a handler the **raw libp2p duplex stream**, documented as being "for non-envelope protocols like client-proxy" |
| `CLIENT_PROXY_PROTOCOL = "/envoymesh/client-proxy/0.1.0"` | `packages/network/src/protocols.ts:5` | a negotiated protocol for exactly this: reach a service on the far machine |
| `createClientProxyHandler(svc)`, driven by `home.handleRawProtocol(CLIENT_PROXY_PROTOCOL, …)` and dialled from another peer | **`apps/node/src/client-proxy-handler.ts`** — used in `apps/node/test/relay-bridge-e2e.test.ts:76,103,125,153` | *"dial a peer over the relay and bridge to a service on the home machine"*, already working and already tested |

So the mechanism is reusable and the **handler is product-bound**, sitting in `apps/node`. That is the
missing piece, and it is the cheapest possible shape of it: **extract, do not invent.** This is B4's
"relay registration" join, and the extraction is what §8.17 asks the second product to prove.

**This also removes the riskiest part of the design below.** The earlier sketch proposed a
`HostSocket` seam inside `WsServer` so a mesh stream could drive the host directly. With a
client-proxy bridge, the mesh stream is bridged to the daemon's **existing** WS endpoint instead, and
`WsServer` — its auth gate, its subscription bookkeeping, its liveness lease — is untouched. The
seam is a smaller and safer place: a package boundary, not a surgery on the transport.

### 4.1 What "extract" means here, measured rather than assumed

Having read the file, **`client-proxy-handler.ts` cannot simply move**: it imports `NodeServiceImpl`,
the node's `routeRpcMethod` router, `home-terminal-ws`, the caller-policy module
(`rpc-caller-context`) and `client-proxy-push`. It is 293 lines of which the product-bound part is the
middle.

What is generic is the **shape around it**, and it is worth stating precisely because it is the thing
to extract:

```
  handshake     client writes {token}                    ─┐
                server resolves it → session | reject     │  the same three ports
                server writes {type:"proxy-accept"}       │  `WsServer` already takes:
  requests      framed JSON-RPC in, replies out           │    sessionIdentity
  push          {event, data} written down the same       │    dispatch
                stream, from the product's event source   │    (event source)
  revocation    a device-scoped registry that closes      ─┘
                live streams when a token is revoked
```

Those four parts are `sessionIdentity` + `dispatch` + an event subscription, which is exactly the
host contract (`host-connect/src/ws-host-contract.ts`, `SessionIdentityResolver` and
`HostRpcDispatcher`). So the reusable extraction is **a proxy transport for the host contract**, not a
move of the node's handler: `EnvoyMesh`'s node keeps its router, its caller policy and its terminal
handling; a product supplies its own; and the plumbing between is shared.

**This makes P1 bigger than "extract a file" and it is worth saying so before it is estimated.** It is
also the version that pays: the family gets one mesh transport for every product host, and the node
is refactored onto it rather than left beside it.

### 4.2 The wire contract, read off the client — and the framing hazard

The client side already exists in Dart, and reading it changed the design. Two things a TS-only
reading would have got wrong:

**1. The handshake has a `type` the server ignores.** The phone sends
`{type: "proxy-connect", token}` and expects `{type: "proxy-accept"}` or
`{type: "proxy-reject", reason}` (`envoy-mesh-libp2p-dart/lib/src/libp2p_node.dart:758-800`). The
node's handler reads only `handshake.token` and never checks `type`, so the two agree today — by the
client being stricter than the server. An extracted transport must keep accepting the node's shape
*and* the client's, or every deployed phone breaks on the day it lands.

**2. The framing is implicit, and that is the real hazard.** Messages are written as raw UTF-8 JSON
with **no length prefix and no delimiter**; both sides rely on `one write = one read`
(`byteStream` on the TS side, `_stream.read()` on the Dart side). Nothing enforces it. It works today;
it is not a contract, it is a coincidence of the current implementations, and a proxy in the middle
that coalesced two frames would turn two RPCs into one unparseable message.

So the extraction has a decision that must be made deliberately rather than inherited:

* **(a) Preserve the implicit framing exactly.** Smallest change, no client release needed, and it
  carries the hazard forward into a second product.
* **(b) Introduce explicit framing — newline-delimited JSON — in the transport *and* in the Dart
  client in the same coordinated change.** Self-delimiting, trivially implemented on both sides, no
  dependency; costs a phone update, and the phone can be updated because the protocol version is ours
  to bump.

**(b) is the recommendation, and it is the one thing here that must not be decided by accident**:
doing (a) because it is smaller would bake a coincidence into a family contract. It is recorded as an
open decision rather than pre-empted, because it changes a wire format two products speak.

## 5. The design

### D1 — Bridge to the host that exists; do not build a second one

EnvoyDev needs one host, reachable two ways, with **one** implementation of auth, dispatch,
subscription and reply ordering. There are three ways to get that, and the first is cheapest and
safest:

1. **Extract the client-proxy bridge and point it at the daemon's own host endpoint** (chosen). The
   mesh stream carries bytes to a local address; the daemon's existing `WsServer` does the rest. Every
   rule the host already enforces — the auth gate, the per-connection subscription set, the liveness
   lease, the deferred-close bookkeeping — applies unchanged, because it is the same code path.
2. A `HostSocket` seam inside `WsServer`, so a mesh stream drives `handleMessage` directly. Rejected
   for now: it is a surgery on a 1,300-line transport whose connection state is entangled with the
   socket, and it buys nothing that (1) does not, at more risk. It stays the fallback if (1) turns out
   to cost more per-message than it is worth.
3. A second host for the mesh. Rejected outright: two hosts drift on auth and on subscription
   bookkeeping, which is the class of bug the family's H1–H5 split existed to end.

**What is reusable and what is not, decided by where the seam is:** the bridge is a *transport*
concern with no product knowledge in it — it moves bytes between a peer and a local endpoint. That is
exactly the kind of thing that belongs in a family package, which is why it is extracted first (P1)
rather than copied into EnvoyDev.

### D2 — EnvoyDev's peer has its own identity

EnvoyDev's mesh peer uses a key of **its own**, under `<home>/EnvoyDev/secrets/`, never the family
profile's key in `<home>/profile/`. Two processes with one identity is corruption, not sharing — the
same rule the design already applies to the daemon (`docs/envoydev-design.md` D4) and the node. The
phone therefore pairs with *EnvoyDev's peer id*, and a code from another app on the same machine names
a different peer.

**Rejected:** borrowing the profile identity when no EnvoyMesh node is running. It reads as a
convenience and is a trap: the moment the user starts EnvoyMesh, two peers hold one identity.

### D3 — The pairing payload carries the route, not a choice of routes

This is why "scan the QR" and "reach it over the relay" are **one artifact and not two methods**. The
family's payload already has the fields — `relayPeerId`, `relayWsUrls`, `bootstrapPeers` in
`PairingData` (`envoy-thin-client-dart/lib/services/pairing_uri.dart:100-148`) — and our
`CoderHostDescriptor` mirrors them. What changes is that they are **filled**: today our daemon passes
no `relay` at all (`apps/desktop/src/daemon/serve.ts`), so the code can only ever name a LAN address.

The payload must carry: the peer id, the LAN multiaddrs, the relay circuit hints, and the product
token. The compressed `pairing=<base64url-gzip-json>` form is preferred — it is what the family's
current mints produce and it keeps a code scannable when the hint list grows.

### D4 — Direct first, relay second, and the phone decides

Order: **same-LAN → direct libp2p (hole-punched) → relay (cn, then us, first that answers)**. This is
`RouteResolver`'s existing shape with the mesh inserted; `dial-budget.ts` in `@envoymesh/network` owns
the timeouts rather than a number invented here.

Relay is the *major* method in practice, not the fallback nobody reaches: a home machine has no public
address, so a direct dial often needs the relay for the rendezvous even when the data path ends up
direct. The UI must therefore report which one is in use, because "connected" hides a real difference
to a user on a metered or slow link.

### D5 — What does not change

The desktop window still uses loopback WS. A phone on the same network still uses LAN WS — the mesh is
not a tax on the easy case. `attachToMeshNode` stays as the optional "attach to a local EnvoyMesh as a
product" feature, and §6 below is where its distinctness is written down so it stops being conflated.

## 6. Plan

Upstream work comes first, because §7.4 of the family guide says a reusable change belongs in
EnvoyMesh and comes back as a consumed version — and because EnvoyDev would otherwise build a second
transport that the next product would have to copy.

| Phase | Repo | What | Prove it by |
|---|---|---|---|
| **P1a** | EnvoyMesh | **The reusable transport** — `packages/host-connect/src/mesh-host-transport.ts`: handshake, newline framing, request/reply, event push, revocation registry, over any duplex. **Done**; additive, exported, 8 tests | `npx tsc -p packages/host-connect/tsconfig.json` + `npx vitest run packages/host-connect` → **40 passing**. The classifier confirms it is product-free: `node scripts/classify-modules.mjs` → 574 reusable / 252 product-bound, this module classified `reusable` |
| **P1b** | EnvoyMesh | **Migrate** `apps/node/src/client-proxy-handler.ts` onto P1a, keeping the product-bound middle (token validation, caller binding, routing, terminals) as injected ports | **`RUN_E2E=1 npx vitest run apps/node/test/relay-bridge-e2e.test.ts`** — the existing end-to-end test, green *while importing the shared module*. **This test is excluded from the default suite** (`vitest.config.ts` excludes `**/test/**/*e2e*.test.ts`), so it must be invoked deliberately; the plan's first draft said "stays green" without saying how, which is how a gate becomes a claim |
| **P2** | EnvoyMesh | Make the bridge's *local* side configurable as an address rather than a node-shaped service, if it is not already; document the protocol | the same e2e test, plus one that bridges to a plain endpoint |
| **P3** | EnvoyDev desktop | Run an `EnvoyMesh` peer with EnvoyDev's own identity; reserve on the shared roster; bridge `CLIENT_PROXY_PROTOCOL` to the daemon's own host; publish peer id + hints in the pairing payload | a smoke leg: a second peer dials the daemon over the mesh and gets `coder.hello` — with **no EnvoyMesh node process running** |
| **P4** | EnvoyDev mobile | Dial direct, then cn, then us, using `envoy_mesh_libp2p` + `envoy_thin_client`; honest per-route state | Dart tests for candidate order + a recorded run on a real device |
| **P1c** | EnvoyMesh + EnvoyGo | **The framing moved everywhere at once** — the node's own handler (`writeFrame`/`readFrame`, 15 sites), the e2e client, and the Dart client (`mesh_framing.dart`). No backward compatibility is kept: the decision was (b), so the old implicit framing is gone rather than tolerated | **15/15** in `relay-bridge-e2e.test.ts` in **314 ms** — it was 9 failures and 547 s of handshake timeouts while one speaker still wrote unframed JSON, which is what proved the three halves have to move together |
| **P5** | both | Docs: this file's status, `envoydev-networking.md` §4, the roadmap; record the relay roster's provenance | `npm run gates`, `docs:check` |

**P1 and P2 are the reusable half and are worth doing even if EnvoyDev stopped tomorrow** — every
family product with a desktop app and a mobile app has this same hole.

## 7. What would make this design wrong

Written down so the next reader can check rather than trust:

1. **If `@envoymesh/network` cannot present a stream as a duplex** with backpressure, P2 becomes a
   rewrite of the framing. First thing to verify in P1, before the seam is fixed in place.
2. **If `WsServer`'s connection state is more entangled than `start()`'s ports suggest** — the
   subscription bookkeeping, the liveness lease, the per-socket queue — the seam may need to move
   those into the shared path first. That is a bigger P1 and should be discovered by *doing*, not by
   estimating.
3. **If a relay reservation cannot be held while the daemon also serves loopback WS**, the desktop's
   two roles need separating. Nothing read so far suggests it, and nothing has proven it either.
