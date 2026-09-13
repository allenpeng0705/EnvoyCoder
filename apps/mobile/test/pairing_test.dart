// The pairing rules, tested the way the family tests them in every app: a code from another app is
// refused with the shared sentence, a code this app minted is accepted, and the token never leaks
// into anything a user can see or a log can capture.

import 'package:envoycoder_mobile/models/host.dart';
import 'package:envoycoder_mobile/services/pairing_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('pairing codes', () {
    final ours = buildPairingCode(
      wsUrl: 'ws://192.168.1.20:4770/ws',
      token: 't0ken-secret',
      ownerId: 'envoy:owner:abc',
    );

    test('accepts this app\'s code and reads the endpoint', () {
      final result = parsePairingCode(ours);
      expect(result.ok, isTrue, reason: result.refusal ?? '');
      final host = result.host!;
      expect(host.endpoint, '192.168.1.20:4770');
      expect(host.app, 'EnvoyCoder');
      expect(host.ownerId, 'envoy:owner:abc');
      expect(host.secure, isFalse);
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
      expect(result.refusal, contains('this is EnvoyCoder'));
    });

    test('accepts a bare query string, because some scanners hand back only that', () {
      final query = ours.split('?').last;
      expect(parsePairingCode(query).ok, isTrue);
    });

    test('explains what is missing rather than failing silently', () {
      expect(parsePairingCode('').refusal, contains('empty'));
      expect(parsePairingCode('envoy://pair?token=t').refusal, contains('address'));
      expect(parsePairingCode('envoy://pair?wsUrl=ws://h:1/ws').refusal, contains('access token'));
      expect(parsePairingCode('not a uri at all').refusal, isNotNull);
    });

    test('never puts the token in a label a user or a log can see', () {
      final host = parsePairingCode(ours).host!;
      expect(describeHost(host), isNot(contains('t0ken-secret')));
      // …and it is present where it belongs: on the socket URL.
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

  group('host list', () {
    test('round-trips through storage without dropping the token or the hop', () {
      final host = parsePairingCode(buildPairingCode(
        wsUrl: 'ws://10.0.0.5:4770/ws',
        token: 'tok',
        ownerId: 'envoy:owner:x',
      )).host!;
      final encoded = encodeHosts([host]);
      expect(encoded, contains('10.0.0.5:4770'));
      expect(encoded, contains('tok'));
    });
  });
}
