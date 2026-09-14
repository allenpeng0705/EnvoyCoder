# Networking: the mesh, multi-window, distributed runs, and the phone

**Code:** `packages/host-bridge` · **Depends on:** EnvoyMesh's `node-core`, `host-connect`,
`reuse-host`, `protocol` · **Rule:** we join the family's network; we do not build a second one.

---

## 1. Two directions that must not be confused

| | EnvoyCoder as a **host** | EnvoyCoder as a **client of the mesh** |
|---|---|---|
| Serves | its own windows and the paired phone | nothing |
| Protocol | EnvoyCoder's own (`@envoycoder/protocol`) | EnvoyMesh's product RPC, as granted |
| Credential | a token *we* issue | a session token **the node** issues, scoped to `product:EnvoyCoder` |
| Lifetime | as long as the desktop app runs | as long as the node lets it |

Direction one is Paseo's architecture. Direction two is the family's, and it is the reason a phone
paired with EnvoyCoder can also reach the mesh without EnvoyCoder inventing identity, discovery or
NAT traversal.

## 2. Attaching to the local node

```
resolveRunningNode(home)        → "running" only for a *verified* node (endpoint answers AND
                                  names the owner the descriptor claims)
endpointFromWsUrl(node.wsUrl)   → { port, path } taken from the URL the node published
requestProductSession(...)      → → { token, scopeKey: "product:EnvoyCoder", ownerId, wsUrl }
```

Four rules, each with a reason:

1. **Only a verified node.** `status === "running"` means the endpoint answered *and* the identity it
   claims matches the profile on disk. "Something answers on that port" is a different question, and
   the attach call is the one that hands out a credential.
2. **The endpoint comes from the node's own `wsUrl`.** Not rebuilt from a port number: a product that
   reassembles the URL is one config change away from dialling somewhere the node is not.
3. **The session must be product-scoped.** A token without a `product:` scope is the *owner's* token;
   holding one would mean EnvoyCoder can do anything the owner can. `attachToMeshNode` refuses it
   loudly rather than using it — `test/host-bridge.test.ts` asserts this.
4. **Refusal is a normal outcome.** No node, an unverified node, or a node whose owner has not granted
   the product anything all produce a typed outcome with end-user wording; the app keeps working
   locally. Nothing is escalated, and nothing is retried in a loop.

What the node grants is the node owner's decision (`NodeConfig.productGrants`, default none,
fail-closed). EnvoyCoder asks for what it needs when it needs it and works without it.

### The daemon's boot, and the two exit codes it must not invent

`npm run daemon` starts it (`apps/desktop/src/daemon/main.ts`, port 4770 or `ENVOYCODER_DAEMON_PORT`,
`0` for "let the OS choose"). The order is deliberate, and each step's failure mode is reported rather
than thrown:

| Step | What it does | If it fails |
|---|---|---|
| read the shared home | `coderPaths()` — the family's resolution, so `ENVOYMESH_HOME` means here what it means everywhere | — |
| describe the home | the family's own `describeProfileSituation` wording, shown as-is | **damaged profile → exit 4**, saying so and changing nothing. Writing into a half-readable profile is how a user loses contacts and bonds without being told |
| attach to the mesh | `attachToMeshNode` as `product:EnvoyCoder` | a refusal is reported and the daemon serves on: "not granted" is a state, not an error |
| serve our surface | `createCoderDaemonHost` + `coderSessionIdentity()` | a **taken port is exit 0**, not an error: one daemon serves a machine, and a second one starting is a window that has not noticed yet |

Two codes are reserved and `boot.ts` never returns them: **`2`** belongs to the family's supervisor
handshake (a supervisor respawns on it, so reusing it makes the loop run forever on a state no restart
fixes) and **`1`** means an unclassified failure. A test asserts the reserved pair across every profile
state, which is cheaper than hoping.

**Who may call it.** A loopback window is trusted and carries no token — the family's own model for a
desktop UI. A remote caller must present one, and today the resolver answers `null` (no session store
yet, roadmap M1), so the transport refuses; the daemon prints that at boot rather than implying a
security property it does not have. The port still binds `0.0.0.0` (the transport's choice), and the
smoke's LAN leg is what holds that honest: a tokenless call from the local network must come back
`UNAUTHORIZED`, while loopback is answered.

## 3. Multi-window

One daemon, many windows, **first window wins**. A second window attaches to the existing daemon
instead of starting a competing one, discovered through the daemon's own **claim file** — the same
"one owner at a time" rule the family applies to the node, for the same reason: two processes owning
one set of tasks is corruption, not sharing. A competing daemon would also mean two agents on
one file, which is worse.

The daemon publishes `<home>/EnvoyCoder/daemon.json` **after** its socket is listening
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

EnvoyCoder publishes through the port that **is** forwarded: `socketMethods`, whose context hands a
product method the live connection and a `send(event, data)` for it (`ws-server.ts:1086-1097`).
`coder.subscribe` registers that connection against the daemon's bus and pushes to it alone — which
is also the behaviour a phone on metered data wants, since it never receives a desktop's transcript
traffic. The full reasoning, with citations, is in `packages/protocol/src/rpc.ts`.

## 4. Pairing, and why ours is not Paseo's

EnvoyCoder uses the family's pairing code (`envoy://pair?…`, minted by `@envoymesh/protocol`) and the
family's **`app` claim**, so one camera path works for every app and a code from another member is
refused with the shared sentence — byte-for-byte the wording `pairingAppMismatch()` produces, on
every platform and in every language of the app.

What the code carries: the endpoint, a token, the owner identity, and the app name. What it is
**not**: authority to run anything.

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

## 6. Distributed runs

D2 fixes *where* work runs: on the machine with the code. What is still open is **who brokers it**,
and the design doc lists that as an open decision. The two candidate shapes:

* **daemon-to-daemon** — EnvoyCoder on machine A offers a run to EnvoyCoder on machine B over the
  mesh; each daemon is sovereign, and the node is only a transport;
* **through the node** — the run is a product RPC on B's node, which A calls with its product
  session. Simpler, and it inherits the node's policy, but it makes the node a broker of workloads
  rather than a transport.

Either way, three invariants hold from day one: **the origin can always cancel** (a run you cannot
stop is not a run you started), **events stream back in the same shape as local runs** (a remote run
is a run), and **a peer may always refuse** with a reason that names the policy, not the network.

## 7. Ports and paths

| Purpose | Default | Override |
|---|---|---|
| EnvoyCoder daemon WS | 4770 (`DEFAULT_DAEMON_PORT`) | `ENVOYCODER_DAEMON_PORT`, or `port: 0` for the OS to choose |
| Endpoint path | `/ws` | `DEFAULT_DAEMON_PATH` |
| SSH | 22 | per-host `SshHop.port` |
| EnvoyMesh node | whatever the node published | `resolveRunningNode`, never assumed |

The daemon binds loopback. Exposing it to a network is a deliberate act (a tailnet address, a tunnel,
or the mesh), and the shell — not the window — decides what it may dial.
