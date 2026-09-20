// The Dart phone client reaching the **TypeScript** desktop peer through a community relay.
//
// ## Status: green — the deadlock below is fixed by the vendored `dart_libp2p` fork
//
// The Dart→TypeScript stream used to fail for a muxer reason, and this file is still the acceptance
// test that proves it does not. It reserves a real circuit on the shipped community relays (cn + us)
// and dials it, and the dial now succeeds.
//
// The fix is **not** in this repo: it is a one-hunk patch in the family's vendored fork of
// `dart_libp2p` 1.0.3 at `EnvoyMesh/vendor/dart_libp2p/`, reached through this app's
// `dependency_overrides` entry. `EnvoyMesh/vendor/dart_libp2p/PATCHES.md` records the exact hunk, the
// yamux semantics, and the rule that re-vendoring on the next upstream bump means re-applying it. The
// deadlock itself, kept here because it is the diagnosis this test guards:
//
//   * `dart_libp2p`'s `YamuxSession.openStream` sent a SYN and then **blocked until the peer ACKed
//     it** (`session.dart`, `await completer.future.timeout(...)`) before it would send the protocol
//     proposal;
//   * `@chainsafe/libp2p-yamux` does not ACK on stream acceptance — the ACK flag is emitted lazily by
//     `YamuxStream.getSendFlags()` on the receiver's **first write** (`stream.js`), and multistream-
//     select's *responder* reads the opener's proposal first (`stream.js`/`muxer.js`), so it writes
//     nothing until the proposal arrives.
//
// The fork removes the wait: the opener sends SYN and proceeds to the proposal, while the ACK is
// still observed for diagnostics. Deadlock, as it was observed from both ends before the fork: Dart
// logged `[OPEN-STREAM-DIAG] SYN sent for streamID=1, waiting for ACK` and never `ACK received`; the
// TypeScript peer logged `libp2p:...:yamux:inbound:1 start protocol negotiation, timing out after
// 10000ms`. Every libp2p protocol starts with an opener-written stream, so no Dart→TypeScript stream
// could open at all — the circuit was unreachable for the same reason a direct dial was.
//
// This file is the reproduction and the assertion that had to go green once the muxer was fixed. It
// is gated, so the ordinary suite neither pays for it nor goes red with it.
//
// ## What this test does assert about the relay path, whichever way the dial goes
//
//   1. The desktop peer — the harness's *default* `createCoderMeshPeer`, i.e. the product's own
//      `coderMeshOptions(identity)` — holds a real reservation on the shipped community relays and
//      advertises `/p2p-circuit/` addresses for it (the harness's JSON line).
//   2. The app's own route planner (`candidatesFor`) turns those addresses into a circuit candidate
//      and leaks no direct libp2p route for the desktop.
//   3. The dial target is asserted to be a `/p2p-circuit/` multiaddr, and the answer to
//      `coder.meshStatus` is required to carry the desktop's own `connections.circuitPeerIds`
//      containing *this Dart node's* peer id — a direct connection never appears there.
//
// ## Gated, and can be shown red
//
//   the real run:      RUN_E2E=1 flutter test test/libp2p_relay_e2e_test.dart
//   reservation red:   RUN_E2E=1 ENVOYDEV_E2E_RELAYS= flutter test test/libp2p_relay_e2e_test.dart
//   dialer red:        RUN_E2E=1 ENVOYDEV_E2E_DISABLE_RELAY=1 flutter test test/libp2p_relay_e2e_test.dart
//   deadlock red:      remove the `dart_libp2p` override from `pubspec.yaml` (falling back to the
//                      unforked pub.dev 1.0.3), `flutter pub get`, then the real run — it fails at
//                      the dial with the yamux ACK timeout described above.

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:envoy_mesh_libp2p/envoy_mesh_libp2p.dart';
import 'package:envoy_thin_client/envoy_thin_client.dart';
import 'package:envoydev_mobile/models/host.dart';
import 'package:envoydev_mobile/services/libp2p_transport.dart';
import 'package:envoydev_mobile/services/route_plan.dart';
import 'package:flutter_test/flutter_test.dart';

/// The one line `scripts/mesh-peer-harness.ts` prints for its parent to parse.
const _sentinel = '@@ENVOYDEV_MESH_HARNESS@@';

/// The whole file is gated: a real dial to shared public relays is not something the ordinary suite
/// may do, and a machine that is offline must not go red for it.
bool get _enabled => Platform.environment['RUN_E2E'] == '1';

/// The "show it can fail" switch. See the file header.
bool get _relayDisabled => Platform.environment['ENVOYDEV_E2E_DISABLE_RELAY'] == '1';

bool _isCircuit(String multiaddr) =>
    multiaddr.contains('/p2p-circuit/p2p/') && multiaddr.contains('/ip4/');

/// Walk up from the test's working directory to the repository root — the directory that holds both
/// `packages/host-bridge` and the harness. `flutter test` runs with the package as its cwd, so a
/// fixed `../..` would break the moment the runner changes that.
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

/// The running TypeScript peer: its identity, the addresses it advertised, and the token a paired
/// phone would present.
class _Harness {
  _Harness({
    required this.peerId,
    required this.circuitAddrs,
    required this.relayHints,
    required this.token,
    required this.probe,
  });

  final String peerId;
  final List<String> circuitAddrs;
  final List<String> relayHints;
  final String token;
  final String probe;

  /// The relay peer ids the desktop reserved on, parsed from the advertised circuit addresses.
  Set<String> get relayPeerIds => {
        for (final addr in circuitAddrs)
          RegExp(r'/p2p/([^/]+)/p2p-circuit/p2p/').firstMatch(addr)?.group(1) ?? '',
      }..remove('');
}

/// Start the harness, wait for its one sentinel line, and hand back the parsed contract.
///
/// Every diagnostic is kept: when the relay refuses a reservation the harness answers `ok:false` with
/// the reason, and a test that swallowed that would report "no address" instead of the real cause.
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
      // `ENVOYDEV_E2E_RELAYS=""` makes the harness reserve on nothing, which is the "point the
      // reservation at nothing" red run: the address assertion below must then fail.
      if (Platform.environment['ENVOYDEV_E2E_RELAYS'] != null)
        'ENVOYDEV_HARNESS_RELAYS': Platform.environment['ENVOYDEV_E2E_RELAYS']!,
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
      probe: payload['probe'] as String,
    ),
    process: process,
    stderr: stderrLines,
  );
}

void main() {
  if (!_enabled) {
    // A skipped test that says what it skipped, rather than a silent green.
    test('Dart → TypeScript over a community relay (not run)', () {
      // ignore: avoid_print
      print('· libp2p-relay-e2e: not run — set RUN_E2E=1 to dial the desktop peer through a '
          'community relay. The cross-language relay claim is unverified by this run.');
    }, skip: true);
    return;
  }

  test(
    'the TypeScript peer, reached from Dart through a community-relay circuit, answers coder.*',
    () async {
      final repoRoot = _repoRoot();
      final home = await Directory.systemTemp.createTemp('envoydev-dart-relay-e2e-');
      Process? harnessProcess;
      Libp2pNode? phone;

      try {
        final started = await _startHarness(repoRoot, home);
        harnessProcess = started.process;
        final harness = started.harness;
        // ignore: avoid_print
        print('· desktop peer ${harness.peerId} on ${harness.circuitAddrs.join(", ")}');

        // 1. The address itself. This is the assertion that stops a direct dial passing as a relay
        //    dial: the desktop advertised this path, and it is a `/p2p-circuit/` one.
        expect(harness.circuitAddrs, isNotEmpty);
        for (final addr in harness.circuitAddrs) {
          expect(_isCircuit(addr), isTrue, reason: 'not a circuit address: $addr');
          expect(addr, contains('/p2p/${harness.peerId}'));
        }

        // 2. The phone is given *only* what a pairing payload carries (`meshMultiaddrs` /
        //    `meshRelayHints`). No direct address for the desktop exists in this test, so there is no
        //    direct route it could take.
        final host = CoderHost(
          id: 'ts-peer-under-test',
          label: 'desktop',
          // A dead direct address on purpose: the WebSocket rung cannot win by accident.
          endpoint: '127.0.0.1:1',
          ownerId: 'envoy:owner:under-test',
          app: 'EnvoyDev',
          token: harness.token,
          homePeerId: harness.peerId,
          bootstrapPeers: harness.circuitAddrs,
        );
        final candidates = candidatesFor(host);
        final circuitCandidates =
            candidates.where((c) => c.url.contains('/p2p-circuit/')).toList();
        expect(
          circuitCandidates,
          isNotEmpty,
          reason: 'the app\'s own route plan built no circuit candidate from ${harness.circuitAddrs}',
        );
        // A libp2p candidate that is *not* a circuit path would be a direct dial at the desktop.
        final directP2p = candidates.where((c) =>
            c.libp2pRelayAddr != null && !c.url.contains('/p2p-circuit/'));
        expect(directP2p, isEmpty,
            reason: 'the payload leaked a direct libp2p route: ${directP2p.map((c) => c.url)}');

        // 3. Dial it with this app's own transport. `enableRelay` is the whole point: without the
        //    circuit-relay transport libp2p has no way to dial a `/p2p-circuit/` address at all.
        phone = Libp2pNode(seedStore: MemoryLibp2pSeedStore());
        await phone.start(enableRelay: !_relayDisabled);
        final phonePeerId = phone.peerId.toString();

        final dialed = <String>[];
        final transport = Libp2pTransport(node: () async => phone!).dial;
        final candidate =
            circuitCandidates.firstWhere((c) => harness.circuitAddrs.any((a) => a.endsWith(c.url)),
                orElse: () => circuitCandidates.first);

        final WebSocketLike wire;
        try {
          dialed.add(candidate.url);
          // ignore: avoid_print
          print('· dialling ${candidate.url} with enableRelay=${! _relayDisabled}');
          wire = await transport(candidate);
        } catch (error) {
          // The message keeps the failure and its cause in one place, so a red run reads as the known
          // blocker rather than as a flake. The blocker was fixed by the `dart_libp2p` fork (see the
          // file header and `EnvoyMesh/vendor/dart_libp2p/PATCHES.md`); if this fires again, check
          // that the override in `pubspec.yaml` still resolves to the fork.
          fail(
            'the Dart client could not dial the TypeScript peer over the circuit: $error\n'
            'Known blocker (see this file\'s header): dart_libp2p\'s yamux `openStream` waits for an '
            'ACK that @chainsafe/libp2p-yamux only sends on its first write, while multistream-select '
            'has the responder read first — so the stream never opens. The same failure occurs on a '
            'loopback direct dial, which is what makes this a muxer blocker rather than a relay one.',
          );
        }
        expect(dialed.single, contains('/p2p-circuit/'));
        // The handshake already ran inside `dial` (a `proxy-reject` throws there); a transport that
        // reached this line is authenticated with the harness's token.
        expect(wire.readyState, wsOpen);

        // 4. A real `coder.*` call, and the desktop's own answer about *this* connection.
        final replies = StreamController<Map<String, dynamic>>.broadcast();
        wire.onMessage = (event) {
          final decoded = jsonDecode(event.data);
          if (decoded is Map<String, dynamic>) replies.add(decoded);
        };
        wire.send(jsonEncode({
          'id': 'relay-e2e-1',
          'method': 'coder.meshStatus',
          'params': {'probe': harness.probe},
        }));

        final Map<String, dynamic> reply;
        try {
          reply = await replies.stream
              .firstWhere((m) => m['id'] == 'relay-e2e-1')
              .timeout(const Duration(seconds: 30));
        } on TimeoutException {
          fail('no coder.* answer came back over the circuit '
              '(harness stderr: ${started.stderr.join(" | ")})');
        }

        expect(reply['error'], isNull, reason: 'the desktop refused the call: ${reply['error']}');
        final result = reply['result'] as Map<String, dynamic>;
        final mesh = result['mesh'] as Map<String, dynamic>;
        expect(mesh['kind'], 'hosting');
        // The identity that answered is the identity the circuit address names.
        expect(mesh['peerId'], harness.peerId);

        // 5. The desktop's own view of the connection *is* the evidence that it arrived over a
        //    circuit: a peer reached directly never appears in `circuitPeerIds`.
        final connections = result['connections'] as Map<String, dynamic>;
        final circuitPeerIds = (connections['circuitPeerIds'] as List).cast<String>();
        expect(
          circuitPeerIds,
          contains(phonePeerId),
          reason: 'the desktop does not see $phonePeerId on a circuit connection '
              '(connected=${connections['connectedPeerIds']}) — the call did not arrive over the '
              'relay',
        );

        wire.close();
        await replies.close();

        // 6. The same relay, dialled the way a **relay-hint** payload makes this app dial it.
        //
        //    `candidatesFor` builds a circuit from a bare relay hint as the family's short form
        //    (`/p2p/<relay>/p2p-circuit/p2p/<home>`) with the relay's own address kept separately in
        //    `libp2pRelayAddr`. Reproducing that shape against a real relay is what pins the fix:
        //    without it the dial dies at `newStream(relayId)` with `No addresses found for peer:
        //    <relay>`, so the off-LAN rung every hint-carrying QR offers could never open.
        final advertised = harness.circuitAddrs.first;
        final relayBase = advertised.substring(0, advertised.indexOf('/p2p-circuit'));
        final relayPeer = advertised.substring(
          advertised.lastIndexOf('/p2p/', advertised.indexOf('/p2p-circuit')) + 5,
          advertised.indexOf('/p2p-circuit'),
        );
        final builtPath = '/p2p/$relayPeer/p2p-circuit/p2p/${harness.peerId}';
        final builtWire = await Libp2pTransport(node: () async => phone!).dial(
          HomeRemoteCandidate(
            name: 'p2p-cn-relay',
            url: builtPath,
            homePeerId: harness.peerId,
            sessionToken: harness.token,
            libp2pRelayAddr: relayBase,
          ),
        );
        expect(builtWire.readyState, wsOpen,
            reason: 'the built circuit $builtPath did not dial through $relayBase');
        builtWire.close();
      } finally {
        await phone?.stop();
        final process = harnessProcess;
        if (process != null) {
          process.kill(ProcessSignal.sigterm);
          await process.exitCode.timeout(const Duration(seconds: 15), onTimeout: () {
            process.kill(ProcessSignal.sigkill);
            return -1;
          });
        }
        if (home.existsSync()) await home.delete(recursive: true);
      }
    },
    timeout: const Timeout(Duration(minutes: 5)),
  );
}
