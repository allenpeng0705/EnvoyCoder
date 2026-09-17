// The two add-host forms, and the rule each one was getting wrong.
//
// Both dialogs used to end with a chain of `if (...isEmpty) return null;`, so pressing **Add** with a
// blank field closed the dialog and did nothing at all — no row, no sentence, nothing to read. And
// Direct TCP labelled its token "optional if already paired", which is true only for a host that is
// already in the list (editing does not go through this form), so in practice it was a required field
// labelled optional.
//
// The rules live in `services/add_host.dart` — pure, so this file can hold them — and the dialogs
// render whatever they say.

import 'package:envoydev_mobile/services/add_host.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('reading a host and port', () {
    test('accepts what a user actually types', () {
      expect(parseEndpoint('devbox.local:4770'), (host: 'devbox.local', port: 4770));
      expect(parseEndpoint('10.0.0.4:4770'), (host: '10.0.0.4', port: 4770));
      // Whitespace around the whole thing is a paste artefact, not a typo worth refusing.
      expect(parseEndpoint('  10.0.0.4:4770  '), (host: '10.0.0.4', port: 4770));
      // A bracketed literal is the only way to write an IPv6 address with a port.
      expect(parseEndpoint('[::1]:4770'), (host: '::1', port: 4770));
    });

    test('refuses what it cannot dial, rather than building a URL that fails later', () {
      for (final bad in ['', 'devbox', 'devbox:', ':4770', 'devbox:abc', 'devbox:0', 'devbox:70000']) {
        expect(parseEndpoint(bad), isNull, reason: '“$bad” should not parse');
      }
    });
  });

  group('Direct TCP', () {
    test('builds a host from an address and a token', () {
      final result = buildDirectHost(endpoint: 'devbox.local:4770', token: 'secret-token');
      expect(result, isA<HostDraftBuilt>());
      final host = (result as HostDraftBuilt).host;
      expect(host.endpoint, 'devbox.local:4770');
      expect(host.label, 'devbox.local');
      expect(host.token, 'secret-token');
      // The URL the dial path uses carries the token, which is what authenticates a non-loopback peer.
      expect(host.wsUri.queryParameters['token'], 'secret-token');
    });

    test('takes a label when the user gives one', () {
      final result = buildDirectHost(endpoint: '10.0.0.4:4770', token: 't', label: 'desk');
      expect((result as HostDraftBuilt).host.label, 'desk');
    });

    test('refuses a missing token, and says where to get one', () {
      final result = buildDirectHost(endpoint: 'devbox.local:4770', token: '  ');
      expect(result, isA<HostDraftRefused>());
      final message = (result as HostDraftRefused).message;
      // The point is not "required": it is *why* — the daemon answers the machine itself or a token
      // holder, and nothing else — and what to do instead.
      expect(message, contains('refuses'));
      expect(message, contains('pairing link'));
    });

    test('refuses a malformed address with the shape it wants', () {
      final result = buildDirectHost(endpoint: 'devbox', token: 't');
      expect(result, isA<HostDraftRefused>());
      expect((result as HostDraftRefused).message, contains('machine:4770'));
    });

    test('refuses a bad address before it complains about the token', () {
      // Two things wrong, and the one the user can see first is the one to name — a form that says
      // "you need a token" when the address is also unreadable sends them to fix the wrong field.
      final result = buildDirectHost(endpoint: 'nonsense', token: '');
      expect((result as HostDraftRefused).message, contains('machine:4770'));
    });
  });

  group('Remote SSH', () {
    test('builds a host with the hop, and does not require a token', () {
      final result = buildSshHost(
        sshHost: 'bastion.example',
        daemonEndpoint: '127.0.0.1:4770',
        user: 'dev',
        port: '2222',
        password: 'hunter2',
      );
      expect(result, isA<HostDraftBuilt>());
      final host = (result as HostDraftBuilt).host;
      // **No token, and that is correct rather than lenient.** The tunnel arrives on the remote
      // machine's own loopback, which the daemon trusts without one — so demanding a token here would
      // ask for something the route does not use.
      expect(host.token, '');
      expect(host.endpoint, '127.0.0.1:4770');
      expect(host.ssh?.host, 'bastion.example');
      expect(host.ssh?.port, 2222);
      expect(host.ssh?.user, 'dev');
      expect(host.ssh?.password, 'hunter2');
    });

    test('keeps a token when one is given, because the same host may later dial directly', () {
      final result = buildSshHost(
        sshHost: 'bastion.example',
        daemonEndpoint: '127.0.0.1:4770',
        token: 'from-a-pairing-link',
      );
      expect((result as HostDraftBuilt).host.token, 'from-a-pairing-link');
    });

    test('defaults the port to 22 and the user to none', () {
      final result = buildSshHost(sshHost: 'bastion.example', daemonEndpoint: '127.0.0.1:4770');
      final host = (result as HostDraftBuilt).host;
      expect(host.ssh?.port, 22);
      expect(host.ssh?.user, isNull);
    });

    test('refuses a missing hop, and asks for the thing it needs', () {
      final result = buildSshHost(sshHost: '  ', daemonEndpoint: '127.0.0.1:4770');
      expect(result, isA<HostDraftRefused>());
      expect((result as HostDraftRefused).message, contains('SSH host'));
    });

    test('refuses an unreadable daemon address with the value it expects', () {
      final result = buildSshHost(sshHost: 'bastion.example', daemonEndpoint: 'the daemon');
      expect((result as HostDraftRefused).message, contains('127.0.0.1:4770'));
    });

    test('refuses a nonsense SSH port', () {
      final result = buildSshHost(sshHost: 'b', daemonEndpoint: '127.0.0.1:4770', port: 'ssh');
      expect((result as HostDraftRefused).message, contains('1 and 65535'));
    });
  });
}
