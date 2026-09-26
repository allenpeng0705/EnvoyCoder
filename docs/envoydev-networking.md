# Networking: the mesh, multi-window, distributed runs, and the phone

**Code:** `packages/host-bridge` · **Depends on:** EnvoyMesh's `node-core`, `host-connect`,
`reuse-host`, `protocol` · **Rule:** we join the family's network; we do not build a second one.

---

## 1. Two directions that must not be confused

| | EnvoyDev as a **host** | EnvoyDev as a **client of the mesh** |
|---|---|---|
| Serves | its own windows and the paired phone | nothing |
| Protocol | EnvoyDev's own (`@envoydev/protocol`) | EnvoyMesh's product RPC, as granted |
| Credential | a token *we* issue | a session token **the node** issues, scoped to `product:EnvoyDev` |
| Lifetime | as long as the desktop app runs | as long as the node lets it |

Direction one is Paseo's architecture. Direction two is the family's, and it is the reason a phone
paired with EnvoyDev can also reach the mesh without EnvoyDev inventing identity, discovery or
NAT traversal.

## 2. Attaching to the local node

```
resolveRunningNode(home)        → "running" only for a *verified* node (endpoint answers AND
                                  names the owner the descriptor claims)
endpointFromWsUrl(node.wsUrl)   → { port, path } taken from the URL the node published
requestProductSession(...)      → → { token, scopeKey: "product:EnvoyDev", ownerId, wsUrl }
```

Four rules, each with a reason:

1. **Only a verified node.** `status === "running"` means the endpoint answered *and* the identity it
   claims matches the profile on disk. "Something answers on that port" is a different question, and
   the attach call is the one that hands out a credential.
2. **The endpoint comes from the node's own `wsUrl`.** Not rebuilt from a port number: a product that
   reassembles the URL is one config change away from dialling somewhere the node is not.
3. **The session must be product-scoped.** A token without a `product:` scope is the *owner's* token;
   holding one would mean EnvoyDev can do anything the owner can. `attachToMeshNode` refuses it
   loudly rather than using it — `test/host-bridge.test.ts` asserts this.
4. **Refusal is a normal outcome.** No node, an unverified node, or a node whose owner has not granted
   the product anything all produce a typed outcome with end-user wording; the app keeps working
   locally. Nothing is escalated, and nothing is retried in a loop.

What the node grants is the node owner's decision (`NodeConfig.productGrants`, default none,
fail-closed). EnvoyDev asks for what it needs when it needs it and works without it.

### The daemon's boot, and the two exit codes it must not invent

`npm run daemon` starts it (`apps/desktop/src/daemon/main.ts`, port 4770 or `ENVOYDEV_DAEMON_PORT`,
`0` for "let the OS choose"). The order is deliberate, and each step's failure mode is reported rather
than thrown:

| Step | What it does | If it fails |
|---|---|---|
| read the shared home | `coderPaths()` — the family's resolution, so `ENVOYMESH_HOME` means here what it means everywhere | — |
| describe the home | the family's own `describeProfileSituation` wording, shown as-is | **damaged profile → exit 4**, saying so and changing nothing. Writing into a half-readable profile is how a user loses contacts and bonds without being told |
| attach to the mesh | `attachToMeshNode` as `product:EnvoyDev` | a refusal is reported and the daemon serves on: "not granted" is a state, not an error |
| serve our surface | `createCoderDaemonHost` + `coderSessionIdentity()` | a **taken port is exit 0**, not an error: one daemon serves a machine, and a second one starting is a window that has not noticed yet |

Two codes are reserved and `boot.ts` never returns them: **`2`** belongs to the family's supervisor
handshake (a supervisor respawns on it, so reusing it makes the loop run forever on a state no restart
fixes) and **`1`** means an unclassified failure. A test asserts the reserved pair across every profile
state, which is cheaper than hoping.

**Who may call it.** A loopback window is trusted and carries no token — the family's own model for a
desktop UI. A remote caller must present a token, resolved against the paired-device store under
`<home>/EnvoyDev/paired-devices.json` (Settings → This machine → Pair a phone). Unknown /
expired / revoked tokens are refused. The port still binds `0.0.0.0` (the transport's choice),
and the smoke's LAN leg still holds the tokenless case honest: a call from the local network
without a token must come back `UNAUTHORIZED`, while loopback is answered.

## 3. Multi-window

One daemon, many windows, **first window wins**. A second window attaches to the existing daemon
instead of starting a competing one, discovered through the daemon's own **claim file** — the same
"one owner at a time" rule the family applies to the node, for the same reason: two processes owning
one set of tasks is corruption, not sharing. A competing daemon would also mean two agents on
one file, which is worse.

The daemon publishes `<home>/EnvoyDev/daemon.json` **after** its socket is listening
(`apps/desktop/src/daemon/lock.ts`), carrying the pid, the bound port, the path and an
`instanceId`; the shell reads it to decide between attaching and starting, and the daemon reads it
at boot to notice that a previous run left a claim behind. The port being bound is *not* the
evidence, and the file alone is not either:

| Question | Who answers it | Why the other half cannot |
|---|---|---|
| is a daemon there? | the shell, from the claim file | a file cannot tell you whether the process behind it is still alive, or whether it is *ours* — a stale claim and a squatter's port look identical from disk |
| is it **our** daemon? | the window, from `coder.hello`'s `instanceId` | only the window speaks the protocol, and the shell has no way to ask |

That split is the second rule of the family's shell, kept rather than skipped: `/health` returning
`200` proves a server exists, not which one. A claim whose pid is gone is stale and replaced; pid
reuse is exactly why the identity is verified over the wire as well (`lock.ts` says so, and
`apps/desktop/src-tauri/src/main.rs` says which half it performs).

The daemon outlives any window. Closing the last window does not kill a running agent — the entire
point of a control plane is that you can walk away. The shell stops its daemon on exit **only if it
started it**; a daemon that was already running belongs to whatever started it, and killing it would
take every other window's tasks with it.

### The one event mechanism the reusable host does not forward

A product's events are supposed to be registered with the transport as a disposition table
(`WsServerOptions.eventDispositions`), which `nodeService.on(name, …)` then feeds into a broadcast
loop. `@envoymesh/reuse-host`'s `createReuseHost` does not forward that option
(`packages/reuse-host/src/index.ts:242-252`), so a product built on the documented surface gets the
transport's own 25 event names wired, starts normally, serves every RPC, and silently drops its own
events. It is worth raising upstream — forwarding `eventDispositions` (and `loopbackOnlyMethods`) is
a two-line change, and §7.4 of the family guide says contract changes go upstream rather than into a
workaround.

EnvoyDev publishes through the port that **is** forwarded: `socketMethods`, whose context hands a
product method the live connection and a `send(event, data)` for it (`ws-server.ts:1086-1097`).
`coder.subscribe` registers that connection against the daemon's bus and pushes to it alone — which
is also the behaviour a phone on metered data wants, since it never receives a desktop's transcript
traffic. The full reasoning, with citations, is in `packages/protocol/src/rpc.ts`.

## 4. Pairing, and why ours is not Paseo's

**Pairing in EnvoyDev is *owner* pairing.** There is one owner — the person at the machine — and a
pairing code attaches another of *their* devices to *their* daemon. There is no family-member concept
in this product: no member identity, no per-member grants, and no "join the family" step. A paired
phone is the owner's own device and stands where the desktop window stands
(`PairedSession` in `apps/desktop/src/daemon/paired-devices.ts` says so, and says why the earlier
`isOwnerScope: false` was the family's model leaking in).

What we borrow is the **format**, not the relationship: the family's pairing code
(`envoy://pair?…`, minted by `@envoymesh/protocol`) and the family's **`app` claim**, so one camera
path works for every app and a code minted by *another app* is refused with the shared sentence —
byte-for-byte the wording `pairingAppMismatch()` produces, on every platform and in every language of
the app. That is a claim about **which program** the code belongs to, never about which person.

What the code carries: the endpoint, a token, the owner identity, and the app name. What it is
**not**: authority to run anything. And what a paired device still cannot do is decided by *where the
call is made*, not by who makes it: a pairing code is minted at the machine that will be paired, so
minting is refused from anywhere else — a rule that applies to a second desktop window on another
machine just as much as to a phone.

That distinction is the design's sharpest disagreement with the reference product. Paseo's pairing
link is an unsigned, unexpiring bearer capability — whoever holds it can connect, and on the relay
path the socket is admitted with owner permissions by default (`websocket-server.ts:966-975` vs the
Hub path, which passes a narrower admission). Their own security doc calls the link "a password";
it is closer to an all-access key. Ours leaks, and the worst case is **a refused connection**:
the token is scoped to a product, the node decides what a product may call, and both are revocable.

Three things we owe on top of that, and the roadmap holds them:

* **expiry and single use** for the code itself (the family's contract allows it; our flow should use
  it);
* **secure storage on the phone** for the token (Keychain/Keystore — not plain storage, which is
  where the reference product keeps its password);
* **a visible list of paired devices**, so "who can reach this machine" has an answer a user can act
  on.

## 5. The phone

Three routes, in the order the phone tries them:

| Route | When | How |
|---|---|---|
| **Direct** | same network, or a tailnet/VPN address | `ws://host:port/ws?token=…` from the pairing code |
| **SSH** | the machine is not directly reachable but is reachable by SSH | the desktop opens `ssh -N -L <local>:127.0.0.1:<remote>` (`buildSshArgs`), and the phone talks to the local port. `ExitOnForwardFailure=yes` is not decoration: a tunnel that silently fails to bind leaves the client talking to nothing |
| **Mesh** | neither of the above | reachability through EnvoyMesh's relay, which is what the family's mesh exists for |

The phone never holds a provider key, never runs an agent, and never writes to a project directory.
It starts runs, watches them, answers approvals and reads diffs — which is exactly the set of
operations the daemon's protocol gives it.

## 6. Collaborative work (and remote runs as substrate)

M5 is **team → job → steps** under an **orchestrator** (the origin EnvoyDev): one copyable team
token, members join and stay online, jobs are split into `JobStep`s and assigned (parallel/async with
writer locks), results merge on the origin, failures follow retry → reassign → fail. Offers carry
`cwdHint`; accept is manual by default; stall automation ships only after the status board.

Normative design (incl. error/exception matrix): [`envoydev-collaboration.md`](envoydev-collaboration.md).

D2 still fixes *where* work runs: on the machine with the code. Member channels use **LAN first,
then EnvoyMesh, then SSH** (`member-dial.ts`). Mesh hints that embed a WebSocket hop
(`mesh:ws://…` or multiaddr `/ws` / `/wss`) are probed like LAN; pure `/p2p/…` multiaddrs dial
through the daemon's own mesh peer (`CLIENT_PROXY_PROTOCOL`). SSH hints (`ssh:user@host[/port]`)
open a local-forward tunnel (`buildSshArgs` / `ssh-member-tunnel.ts`) and probe the local
`ws://127.0.0.1:…`. Peer RPC (`member-peer-call.ts`) reuses the same routes so offers and
heartbeats follow the channel dial chose. The EnvoyMesh node is transport only — not
the orchestrator.

Invariants for every remote leg: **origin can always cancel**, **events stream as `run.*`**,
**peer may refuse with a named policy**. Collaboration adds: **one writer per worktree key**,
**team before job**, and the §7 failure machine.

## 7. Ports and paths

| Purpose | Default | Override |
|---|---|---|
| EnvoyDev daemon WS | 4770 (`DEFAULT_DAEMON_PORT`) | `ENVOYDEV_DAEMON_PORT`, or `port: 0` for the OS to choose |
| Endpoint path | `/ws` | `DEFAULT_DAEMON_PATH` |
| SSH | 22 | per-host `SshHop.port` |
| EnvoyMesh node | whatever the node published | `resolveRunningNode`, never assumed |

The daemon binds loopback. Exposing it to a network is a deliberate act (a tailnet address, a tunnel,
or the mesh), and the shell — not the window — decides what it may dial.
