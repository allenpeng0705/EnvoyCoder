// The pairing rules, tested the way the family tests them in every app: a code from another app is
// refused with the shared sentence, a code this app minted is accepted, and the token never leaks
// into anything a user can see or a log can capture.

import 'package:envoydev_mobile/models/host.dart';
import 'package:envoydev_mobile/services/pairing_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('pairing codes', () {
    final ours = buildPairingCode(
      wsUrl: 'ws://192.168.1.20:4770/ws',
      token: 't0ken-secret',
      ownerId: 'envoy:owner:abc',
      lanWsUrl: 'ws://192.168.1.20:4770/ws',
      relayWsUrl: 'wss://relay.example/ws',
      relayWsUrls: ['wss://relay-b.example/ws'],
    );

    test('accepts this app\'s code and reads the endpoint', () {
      final result = parsePairingCode(ours);
      expect(result.ok, isTrue, reason: result.refusal ?? '');
      final host = result.host!;
      expect(host.endpoint, '192.168.1.20:4770');
      expect(host.app, 'EnvoyDev');
      expect(host.ownerId, 'envoy:owner:abc');
      expect(host.secure, isFalse);
      expect(host.lanWsUrl, 'ws://192.168.1.20:4770/ws');
      expect(host.relayWsUrl, 'wss://relay.example/ws');
      expect(host.relayWsUrls, ['wss://relay-b.example/ws']);
    });

    test('drops a relay that is just a copy of the primary wsUrl', () {
      final code = buildPairingCode(
        wsUrl: 'ws://10.0.0.1:4770/ws',
        token: 't',
        ownerId: 'o',
      );
      final host = parsePairingCode(code).host!;
      expect(host.relayWsUrl, isNull);
    });

    test('refuses another app\'s code in the family\'s words', () {
      final theirs = buildPairingCode(
        wsUrl: 'ws://192.168.1.20:3030/ws',
        token: 'x',
        ownerId: 'envoy:owner:abc',
        app: 'EnvoyMesh',
      );
      final result = parsePairingCode(theirs);
      expect(result.ok, isFalse);
      expect(result.refusal, contains('made by EnvoyMesh'));
      expect(result.refusal, contains('this is EnvoyDev'));
    });

    test('accepts the shared contract\'s paste-friendly forms', () {
      expect(parsePairingCode(ours).ok, isTrue);
      expect(parsePairingCode(ours.split('?').last).ok, isFalse);
    });

    test('refuses an unreadable code with something a user can act on', () {
      for (final bad in ['', 'envoy://pair?token=t', 'envoy://pair?wsUrl=ws://h:1/ws', 'nonsense']) {
        final result = parsePairingCode(bad);
        expect(result.ok, isFalse, reason: bad);
        expect(result.refusal, isNotNull, reason: bad);
        expect(result.refusal!.length, greaterThan(10), reason: bad);
      }
      expect(parsePairingCode('').refusal, contains('empty'));
    });

    test('never puts the token in a label a user or a log can see', () {
      final host = parsePairingCode(ours).host!;
      expect(describeHost(host), isNot(contains('t0ken-secret')));
      expect(host.wsUri.toString(), contains('t0ken-secret'));
    });
  });

  group('ssh hop', () {
    test('plans a tunnel that fails loudly instead of silently connecting to nothing', () {
      const hop = SshHop(host: 'workstation.local', port: 2222, user: 'dev');
      final args = hop.tunnelArgs(localPort: 4770, remotePort: 4770);
      expect(args, contains('ExitOnForwardFailure=yes'));
      expect(args, containsAllInOrder(['-p', '2222']));
      expect(args.last, 'dev@workstation.local');
    });
  });

  group('host list metadata', () {
    test('round-trips metadata without writing the token into prefs JSON', () {
      final host = parsePairingCode(buildPairingCode(
        wsUrl: 'ws://10.0.0.5:4770/ws',
        token: 'tok',
        ownerId: 'envoy:owner:x',
        lanWsUrl: 'ws://10.0.0.5:4770/ws',
      )).host!;
      final encoded = encodeHosts([host]);
      expect(encoded, contains('10.0.0.5:4770'));
      expect(encoded, isNot(contains('tok')));
      expect(encoded, contains('lanWsUrl'));
      final decoded = decodeHosts(encoded, tokens: {host.id: 'tok'});
      expect(decoded.single.token, 'tok');
      expect(decoded.single.lanWsUrl, 'ws://10.0.0.5:4770/ws');
    });
  });
}
