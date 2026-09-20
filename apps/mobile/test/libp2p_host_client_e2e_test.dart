// The off-LAN routes, walked by the **app's own client**, in the shape the owner's QR actually has.
//
// ## Why this test exists next to `libp2p_relay_e2e_test.dart`
//
// That test proves the *dial* at the SDK level: it hands `Libp2pTransport` a candidate the test built
// itself, over a circuit address the desktop advertised whole. It does not prove the app's client can
// get there on its own. The owner's pairing code carries **bare relay hints**, not a pre-built
// `/p2p-circuit/` address, and it also carries the desktop's loopback and LAN addresses — which on 5G
// are dead. The claim under test is exactly the reported bug:
//
//   > a phone on cellular, holding a hint-only code, reaches `coder.listProjects` off-LAN.
//
// So these tests use nothing but the production path:
//
//   * `candidatesFor(host)` (the app's only routing knowledge: field mapping, no ordering);
//   * `HostClient` with **no injected WebSocket dialer**, so it uses `PlatformWebSocket` as the phone
//     does, and the real `Libp2pTransport`/`_sharedLibp2pNode()` for the circuit case;
//   * a host whose `bootstrapPeers` are the harness's `relayHints` **only** — no circuit — and whose
//     LAN/direct address is a non-routable RFC1918 host, so the LAN rung fails and only an off-LAN
//     rung can win.
//
// Two rungs are covered, and they are two different mechanisms:
//
//   1. the **libp2p circuit** — planned from a hint and dialled by `Libp2pTransport`. This is the
//      rung that must be green, and the one the owner's hint-only code needs;
//   2. the relay's **WebSocket client-proxy** (`ws://<relay>:15432/ws?target=<home>`) — the rung the
//      desktop never published. It is *known-broken* against this daemon for a concrete framing
//      reason recorded on the test itself, so it stays as a skipped probe rather than a green tick.
//
// ## Gated
//
//   the real run: RUN_E2E=1 flutter test test/libp2p_host_client_e2e_test.dart
//
// It reserves a circuit on the shipped community relays and needs the network. Like the other e2e
// file it is gated so an offline machine does not go red for a route it never dialled.

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:envoy_thin_client/envoy_thin_client.dart';
import 'package:envoydev_mobile/models/host.dart';
import 'package:envoydev_mobile/services/host_client.dart';
import 'package:envoydev_mobile/services/libp2p_transport.dart';
import 'package:envoydev_mobile/services/route_plan.dart';
import 'package:flutter_test/flutter_test.dart';

/// The one line `scripts/mesh-peer-harness.ts` prints for its parent to parse.
const _sentinel = '@@ENVOYDEV_MESH_HARNESS@@';

bool get _enabled => Platform.environment['RUN_E2E'] == '1';

/// The dead LAN/direct address.
///
/// `10.0.0.0/8` is RFC1918, so the family's classifier puts it in the same "same network only" class
/// as the owner's `192.168.3.85` and demotes it behind the circuit — but nothing answers, so the LAN
/// rung fails exactly as the owner's does on 5G. Deliberately **not** the owner's address: this
/// machine *is* `192.168.3.85`, and their live daemon listens there on 4770. A test must not dial it.
const _deadLanEndpoint = '10.255.255.1:4770';

Directory _repoRoot() {
  var dir = Directory.current.absolute;
  for (var i = 0; i < 8; i += 1) {
    if (File('${dir.path}/scripts/mesh-peer-harness.ts').existsSync() &&
        Directory('${dir.path}/packages/host-bridge').existsSync()) {
      return dir;
    }
    final parent = dir.parent;
    if (parent.path == dir.path) break;
    dir = parent;
  }
  throw StateError('could not find the EnvoyCoder root from ${Directory.current.path}');
}

class _Harness {
  _Harness({
    required this.peerId,
    required this.circuitAddrs,
    required this.relayHints,
    required this.token,
  });

  final String peerId;
  final List<String> circuitAddrs;

  /// The bare relay multiaddrs a pairing payload carries as hints (`/ip4/…/p2p/<relay>`).
  final List<String> relayHints;
  final String token;

  /// The relay WebSocket client-proxy URLs the desktop *should* publish as `relayWsUrls`.
  ///
  /// Derived the same way the desktop's `coderCommunityRelayWsUrls()` does: the relay's host from its
  /// multiaddr, the family's documented client-proxy port, the `/ws` path.
  List<String> get relayWsUrls => [
        for (final addr in relayHints)
          if (_hostOf(addr) != null) 'ws://${_hostOf(addr)}:15432/ws',
      ];
}

String? _hostOf(String multiaddr) {
  final match = RegExp(r'/ip4/([^/]+)').firstMatch(multiaddr) ??
      RegExp(r'/dns[46]/([^/]+)').firstMatch(multiaddr);
  return match?.group(1);
}

/// Start the harness and wait for its sentinel line. Same contract as the other e2e file: the
/// harness serves the real `createCoderMeshPeer` with its default `EnvoyMesh` node.
Future<({_Harness harness, Process process, List<String> stderr})> _startHarness(
  Directory repoRoot,
  Directory home,
) async {
  final tsx = File('${repoRoot.path}/node_modules/.bin/tsx');
  final launcher = tsx.existsSync() ? tsx.path : 'npx';
  final launcherArgs = tsx.existsSync()
      ? <String>['${repoRoot.path}/scripts/mesh-peer-harness.ts']
      : <String>['tsx', '${repoRoot.path}/scripts/mesh-peer-harness.ts'];

  final process = await Process.start(
    launcher,
    launcherArgs,
    workingDirectory: repoRoot.path,
    environment: {
      ...Platform.environment,
      'ENVOYDEV_HARNESS_HOME': home.path,
      'ENVOYDEV_HARNESS_WAIT_MS':
          Platform.environment['ENVOYDEV_E2E_HARNESS_WAIT_MS'] ?? '150000',
    },
  );

  final stderrLines = <String>[];
  process.stderr.transform(utf8.decoder).transform(const LineSplitter()).listen(stderrLines.add);

  final sentinel = Completer<Map<String, dynamic>>();
  process.stdout.transform(utf8.decoder).transform(const LineSplitter()).listen((line) {
    if (!line.startsWith(_sentinel) || sentinel.isCompleted) return;
    sentinel.complete(jsonDecode(line.substring(_sentinel.length)) as Map<String, dynamic>);
  });
  unawaited(process.exitCode.then((code) {
    if (!sentinel.isCompleted) {
      sentinel.completeError(StateError(
        'the harness exited ($code) before reporting an address.\n${stderrLines.join('\n')}',
      ));
    }
  }));

  final payload = await sentinel.future.timeout(
    const Duration(minutes: 4),
    onTimeout: () => throw TimeoutException(
      'the harness never reported a circuit address.\n${stderrLines.join('\n')}',
    ),
  );

  if (payload['ok'] != true) {
    process.kill(ProcessSignal.sigterm);
    fail('the desktop peer holds no community-relay circuit: ${payload['reason']}');
  }

  return (
    harness: _Harness(
      peerId: payload['peerId'] as String,
      circuitAddrs: (payload['circuitAddrs'] as List).cast<String>(),
      relayHints: (payload['relayHints'] as List).cast<String>(),
      token: payload['token'] as String,
    ),
    process: process,
    stderr: stderrLines,
  );
}

void _printLadder(HostClient client) {
  for (final rung in client.routeLadder) {
    // ignore: avoid_print
    print('· ladder ${rung.name} status=${rung.status.name} '
        'elapsed=${rung.elapsedMs}ms error=${rung.error} url=${rung.redactedUrl}');
  }
  // ignore: avoid_print
  print('· state=${client.state.label} route=${client.activeRoute}');
}

void main() {
  if (!_enabled) {
    test('HostClient off-LAN walk (not run)', () {
      // ignore: avoid_print
      print('· libp2p-host-client-e2e: not run — set RUN_E2E=1 to walk the app\'s own client over a '
          'community relay with a hint-only pairing payload. The off-LAN client claim is unverified '
          'by this run.');
    }, skip: true);
    return;
  }

  Directory? home;
  Process? harnessProcess;
  _Harness? harness;
  final stderr = <String>[];

  setUpAll(() async {
    home = await Directory.systemTemp.createTemp('envoydev-hostclient-relay-e2e-');
    final started = await _startHarness(_repoRoot(), home!);
    harnessProcess = started.process;
    harness = started.harness;
    stderr.addAll(started.stderr);
    // ignore: avoid_print
    print('· desktop peer ${harness!.peerId}');
    // ignore: avoid_print
    print('· desktop circuit addrs (NOT given to the phone): ${harness!.circuitAddrs.join(", ")}');
    // ignore: avoid_print
    print('· pairing payload bootstrapPeers = relay HINTS only: ${harness!.relayHints.join(", ")}');
    // ignore: avoid_print
    print('· relay WebSocket bases derived from those hints: ${harness!.relayWsUrls.join(", ")}');
  });

  tearDownAll(() async {
    await stopSharedLibp2pNode();
    final process = harnessProcess;
    if (process != null) {
      process.kill(ProcessSignal.sigterm);
      await process.exitCode.timeout(const Duration(seconds: 15), onTimeout: () {
        process.kill(ProcessSignal.sigkill);
        return -1;
      });
    }
    final dir = home;
    if (dir != null && dir.existsSync()) await dir.delete(recursive: true);
  });

  test(
    'the circuit rung: a hint-only payload reaches coder.listProjects over /p2p-circuit/',
    () async {
      final h = harness!;
      // The owner's shape has no pre-built circuit. Assert the test really is testing that: if the
      // harness ever published its circuits as hints, the circuit could be dialled as advertised and
      // this test would stop covering the built-from-hint path.
      expect(h.relayHints.any((a) => a.contains('/p2p-circuit/')), isFalse);

      final host = CoderHost(
        id: 'desktop-circuit-under-test',
        label: 'desktop',
        endpoint: _deadLanEndpoint,
        ownerId: 'envoy:owner:under-test',
        app: 'EnvoyDev',
        token: h.token,
        // A LAN URL that is present (so the resolver plans the LAN rung first) but unreachable.
        lanWsUrl: 'ws://$_deadLanEndpoint/ws',
        homePeerId: h.peerId,
        bootstrapPeers: h.relayHints,
      );

      // What the family plans, printed before the walk so the ordering claim has raw evidence.
      for (final candidate in candidatesFor(host)) {
        // ignore: avoid_print
        print('· planned ${candidate.name}  url=${candidate.url}  '
            'relay=${candidate.libp2pRelayAddr}');
      }

      // The production client: no `dialer`, no `libp2pDialer`, default budget. `minDelay` is only
      // raised so a failure does not spin a retry loop while this test reports it.
      final client = HostClient(
        host,
        minDelay: const Duration(seconds: 30),
        maxDelay: const Duration(seconds: 30),
      );
      addTearDown(client.dispose);

      await client.connectBest();
      _printLadder(client);

      expect(client.state, HostConnectionState.connected,
          reason: 'the walk never reached the daemon. lastWalkError=${client.lastWalkError}');
      // The route must be a peer rung, not the dead LAN socket and not a direct dial that would have
      // to exist on the phone (a loopback `p2p-direct` is the phone itself).
      expect(client.activeRoute, isNotNull);
      expect(client.activeRoute!.startsWith('p2p-'), isTrue,
          reason: 'off-LAN must win on a peer rung, got ${client.activeRoute}');
      expect(client.activeRoute, isNot('p2p-direct'),
          reason: 'a direct rung has no address that is reachable off-LAN');

      final projects =
          await client.call('coder.listProjects', const {}, const Duration(seconds: 30));
      // ignore: avoid_print
      print('· coder.listProjects -> ${jsonEncode(projects)}');
      final list = (projects['projects'] as List).cast<Map<String, dynamic>>();
      expect(list, isNotEmpty, reason: 'the daemon answered with no projects over the circuit');
      expect(list.first['label'], 'Relay-proof project');
    },
    timeout: const Timeout(Duration(minutes: 6)),
  );

  // The desktop's WebSocket-relay route (`relayWsUrls`), which the pairing payload never carries.
  //
  // **Known-broken against this product's daemon, and left un-wired for that reason.** The value is
  // derivable and legitimate — the family's own node derives `ws://<relay-host>:15432/ws` from a
  // relay multiaddr (`EnvoyMesh/apps/node/src/node-service-impl-service-deps.ts:63`), and the relay
  // answers the upgrade (`curl … /ws` → `400 Missing target peer ID` with no target). What fails is
  // the handshake inside: `apps/relay/src/index.ts:1738` writes the `proxy-connect` frame as bare
  // JSON with **no trailing newline**, while EnvoyDev's mesh transport reads
  // newline-delimited frames (`EnvoyMesh/packages/host-connect/src/mesh-host-transport.ts:81` — the
  // same rule as the Dart `frameMessage`, `'$data\n'`). `readOneFrame` therefore never sees a
  // complete frame, the home never answers, and the relay waits forever for `proxy-accept`: the
  // probe below hung for 45 s, and the cn relay closed with `unable to reach home node` when the
  // home was reserved on the us relay instead.
  //
  // Publishing `relayWsUrls` would put a rung in every QR that hangs on this daemon, so the desktop
  // stays as it is until the relay's handshake framing (or this app's read side) is reconciled. The
  // file keeps the probe, skipped and with the reason, rather than deleting the evidence.
  test(
    'the WebSocket-relay rung: with libp2p disabled, the relay client-proxy still answers',
    () async {
      final h = harness!;
      final relayWsUrls = h.relayWsUrls;
      expect(relayWsUrls, isNotEmpty, reason: 'no relay host could be derived from the hints');
      // ignore: avoid_print
      print('· deriving relayWsUrls: $relayWsUrls');

      final host = CoderHost(
        id: 'desktop-ws-relay-under-test',
        label: 'desktop',
        endpoint: _deadLanEndpoint,
        ownerId: 'envoy:owner:under-test',
        app: 'EnvoyDev',
        token: h.token,
        lanWsUrl: 'ws://$_deadLanEndpoint/ws',
        homePeerId: h.peerId,
        bootstrapPeers: h.relayHints,
        relayWsUrls: relayWsUrls,
      );

      // The libp2p rungs are made to fail on purpose: a green run here must have come from the
      // WebSocket relay, and this is the only way to say so without trusting the rung order.
      final client = HostClient(
        host,
        libp2pDialer: (_) async => throw const SocketException('libp2p disabled for this case'),
        budget: const DialBudget(
          perCandidateTimeout: Duration(seconds: 15),
          maxAttemptsPerWalk: 8,
        ),
        minDelay: const Duration(seconds: 30),
        maxDelay: const Duration(seconds: 30),
      );
      addTearDown(client.dispose);

      await client.connectBest();
      _printLadder(client);

      expect(client.state, HostConnectionState.connected,
          reason: 'no WebSocket relay rung reached the daemon. lastWalkError=${client.lastWalkError}');
      expect(client.activeRoute, anyOf('relay', startsWith('relay-'), 'community-relay'),
          reason: 'the rung that won is not a relay WebSocket: ${client.activeRoute}');
    },
    skip: 'known-broken: the relay writes an unframed proxy-connect (apps/relay/src/index.ts:1738) '
        'while this app reads newline-delimited frames, so the relay WS route hangs. See the '
        'comment above; the desktop deliberately does not publish relayWsUrls until that is fixed.',
    timeout: const Timeout(Duration(minutes: 6)),
  );
}
