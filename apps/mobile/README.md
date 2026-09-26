# EnvoyDev mobile

Check on coding agents running on your machines — from the phone, without moving the work.

The phone is a **thin client**, and the three rules in `docs/envoydev-networking.md` §5 are what that
means concretely:

* it **never runs an agent** and never holds a provider key — the daemon on the machine that has the
  code does that, and the phone asks it;
* it **never writes to a project directory** — it starts runs, watches them, answers approvals and
  reads the transcript, which is exactly the set of operations the daemon's protocol gives it;
* it reaches the daemon by whichever route is open, walking the **family's** candidate ladder —
  LAN → public → P2P → bootstrap → relay last — from `envoy_thin_client`'s `CandidateResolver`
  (`lib/services/route_plan.dart` is the app's whole contribution: which pairing field goes where).

Bundle ID on both platforms: **`com.envoymesh.envoydev`**. Version: `0.1.0+1` in `pubspec.yaml`.

## What it does today

| Screen | What it is for |
|---|---|
| `no_hosts_screen.dart` / `connections_sheet.dart` | paired machines, switch host, add another |
| `add_host_sheet.dart` | paste or scan a pairing code |
| `qr_scan_screen.dart` | the camera path onto the same code |
| `project_list_screen.dart` | projects → tasks, search, agent picker, New task |
| `add_project_sheet.dart` | add a folder the daemon already knows |
| `new_task_sheet.dart` | createTask + startRun with agent / model / mode / thinking |
| `run_screen.dart` | markdown (+ highlight), Queue / Steer, Stop, composer controls |
| `explorer_screen.dart` | browse the project tree on the daemon |
| `settings_screen.dart` | daemon settings + Envoy Harness LLM |
| `network_status_screen.dart` | how this phone is reaching the daemon |

Git on the phone matches the desktop for the flows that matter away from the desk: branches, stash,
and resolving a conflicted merge (including handing the conflict to an agent).

## Pairing

1. On the desktop: Settings → **Mobile Pairing** (or the rail / palette *Pair a phone*).
2. On the phone: scan the QR, paste the URI, or enter `host:port` + token / SSH hop.
3. Tokens live in `flutter_secure_storage`. The phone sends a stable install id with `coder.hello` so
   reinstalls of the same app do not leave a pile of live pairing rows on the desktop.

Store listing copy and icons: `store-release/` and `play-store-assets/` (screenshots are still
manual). Review notes for App Store / Play: `store-release/apple_google_reviewing.md`.

## Running it

```bash
# from the EnvoyCoder repo root — the daemon the phone talks to
npm run daemon

# in another terminal
cd apps/mobile
flutter pub get
flutter test
flutter run          # a device or emulator, with that daemon reachable
```

The phone reaches a daemon on the same machine, over LAN / mesh, or over an SSH hop. Pairing is the
M4 contract in `docs/roadmap.md` — tokens, QR, and product RPC for a paired device are landed; a live
recording of the phone answering an approval remains a manual check.

## How it is built, and the decisions worth knowing

**It does not re-implement the family's pairing contract.** `pairing_service.dart` delegates to
`envoy_thin_client`, the Dart twin of `@envoymesh/protocol`, so the sentence a user reads when they scan
the wrong app's code is the one every other app in the group produces. A second implementation would
work today and drift the first time the format changed (family guide §5.2).

**It does not keep a second ladder either.** `host_client.dart` holds no route order: it asks
`CandidateResolver` for candidates and hands them to `HomeRemoteClient`, both from `envoy_thin_client`.
The app used to own a `RouteResolver` alongside them, which meant a family fix to the relay/circuit
ordering reached EnvoyGo and not this app. Two things the app still decides, and neither is an order:
which candidates an SSH hop forwards (the hop is a *transport* for the daemon's own address, not a
rung), and the dial budget — per-candidate timeout, attempts per walk, and deferral once recent dials
have failed. The direct libp2p rung is dialled by `libp2p_transport.dart` over the family's
`Libp2pNode`, and because it can dial, it is offered (`test/libp2p_route_test.dart` brings up a real
host and connects to it).

**Tokens live in the platform's secure storage.** `host_store.dart` keeps a host's *metadata* in
`shared_preferences` and its token in `flutter_secure_storage`, and a test asserts the token never
appears in the preferences JSON. The install id prefers the keychain so an iOS uninstall/reinstall
does not look like a brand-new phone to the desktop. The token is the whole credential, so where it
sits is a security decision rather than a storage detail — and it is one of the places this product
deliberately differs from the reference implementation (`docs/envoydev-paseo-inheritance.md` §4).

**The transcript is folded, not appended.** `models/transcript.dart` owns the four rules that make a
streaming run readable on a small screen — join fragments by message, drop a repeated sequence number,
pair a tool call with its result, and report a gap rather than skipping it in silence — and
`test/transcript_test.dart` asserts each of them. Rendering one row per event is what turns a streamed
answer into a column of one-word lines, which is the bug this model exists to prevent.
