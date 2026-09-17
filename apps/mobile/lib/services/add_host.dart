/// Turning what a user typed into a host, or a sentence saying why it cannot be one.
///
/// ## Why the parsing is out of the dialog
///
/// Both add-host dialogs used to end with `if (ok != true) return null;` followed by a chain of
/// `if (...isEmpty) return null;`. A user who left a field blank pressed **Add**, the dialog closed,
/// and nothing happened — no row, no message, nothing to read. That is the failure this repository
/// already named on the desktop side ("a failure is read where the press was"): a refusal belongs
/// where the press happened, in words, not in a silent early return.
///
/// It is also the reason this is a function rather than four `if`s inside a `showDialog` builder: the
/// rules below are the part a test can hold, and the dialog becomes a form that renders them.
///
/// ## The rule both forms were getting wrong
///
/// **A token is a credential, not an option.** The daemon answers a caller that is on the machine
/// itself *or* holds a token it minted; anyone else is refused with `UNAUTHORIZED`. So:
///
///   * **Direct TCP** — the phone is on the network, not on the machine, so a token is **required**.
///     The field said "optional if already paired", which is true only for a host already in the list
///     (and editing an existing host does not go through this form), so in practice it was a required
///     field labelled optional, and leaving it blank produced silence.
///   * **SSH** — the phone opens a tunnel and the daemon sees the connection arrive on its **own
///     loopback**, which it trusts without a token. A token is therefore genuinely optional here, and
///     one is still used when given: it survives the day the tunnel is replaced by a direct route.
///
/// Saying which is which is the whole point. A form that demanded a token for SSH would be asking for
/// something the route does not need; one that shrugged at a missing token for Direct TCP would
/// produce a host row that can never connect.
library;

import '../models/host.dart';
import 'pairing_service.dart';

/// Either a host the user can be shown, or why not — in the user's language, headline first.
sealed class HostDraft {
  const HostDraft();
}

class HostDraftBuilt extends HostDraft {
  const HostDraftBuilt(this.host);
  final CoderHost host;
}

class HostDraftRefused extends HostDraft {
  const HostDraftRefused(this.message);
  final String message;
}

/// Host and port, exactly as a user types them: `devbox.local:4770`, `10.0.0.4:4770`, `[::1]:4770`.
///
/// Returns null when the text is not a `host:port` at all, so the caller can say so rather than
/// building a URL that fails at dial time with something opaque.
({String host, int port})? parseEndpoint(String raw) {
  final text = raw.trim();
  if (text.isEmpty) return null;

  // A bracketed IPv6 literal, which is the only way to write one with a port.
  final bracketed = RegExp(r'^\[([^\]]+)\]:(\d{1,5})$').firstMatch(text);
  if (bracketed != null) {
    final port = int.tryParse(bracketed.group(2)!);
    if (port == null || port < 1 || port > 65535) return null;
    return (host: bracketed.group(1)!, port: port);
  }

  final at = text.lastIndexOf(':');
  if (at <= 0 || at == text.length - 1) return null;
  final host = text.substring(0, at).trim();
  final port = int.tryParse(text.substring(at + 1).trim());
  if (host.isEmpty || port == null || port < 1 || port > 65535) return null;
  return (host: host, port: port);
}

/// The Direct TCP form: a machine on this network, and the token that proves the ask.
HostDraft buildDirectHost({
  required String endpoint,
  required String token,
  String label = '',
}) {
  final parsed = parseEndpoint(endpoint);
  if (parsed == null) {
    return const HostDraftRefused(
      'That is not a host and port. Write it as “machine:4770” — the address and the port the '
      'daemon listens on.',
    );
  }
  final trimmedToken = token.trim();
  if (trimmedToken.isEmpty) {
    // Not "the token is required" — that tells a user nothing about where to get one.
    return const HostDraftRefused(
      'EnvoyDev refuses anyone who is not on the machine itself, so this route needs the token from '
      'a pairing link. Use Scan QR or Paste link, or paste the token here as well.',
    );
  }
  final where = '${parsed.host}:${parsed.port}';
  return HostDraftBuilt(
    CoderHost(
      id: 'tcp::$where',
      label: label.trim().isEmpty ? parsed.host : label.trim(),
      endpoint: where,
      ownerId: '',
      app: kAppName,
      token: trimmedToken,
    ),
  );
}

/// The SSH form: a hop to a machine that is not directly reachable.
///
/// The daemon sees the tunnelled connection arrive on its own loopback, so **the token is optional**;
/// supplying one is allowed and is kept, because it is what makes the same host work if the hop is
/// ever dropped in favour of a direct address.
HostDraft buildSshHost({
  required String sshHost,
  required String daemonEndpoint,
  String user = '',
  String port = '22',
  String password = '',
  String token = '',
  String label = '',
}) {
  final hop = sshHost.trim();
  if (hop.isEmpty) {
    return const HostDraftRefused('Which machine should the tunnel go through? Enter its SSH host.');
  }
  final parsedPort = int.tryParse(port.trim());
  if (parsedPort == null || parsedPort < 1 || parsedPort > 65535) {
    return const HostDraftRefused('The SSH port has to be a number between 1 and 65535. It is 22 by default.');
  }
  final daemon = parseEndpoint(daemonEndpoint);
  if (daemon == null) {
    return const HostDraftRefused(
      'The daemon on that machine is named as “host:port”. Write it as “127.0.0.1:4770” — that is '
      'what it is for almost every machine, and it is the address as seen *from* the machine.',
    );
  }

  return HostDraftBuilt(
    CoderHost(
      id: 'ssh::$hop::${daemon.host}:${daemon.port}',
      label: label.trim().isEmpty ? hop : label.trim(),
      endpoint: '${daemon.host}:${daemon.port}',
      ownerId: '',
      app: kAppName,
      token: token.trim(),
      ssh: SshHop(
        host: hop,
        port: parsedPort,
        user: user.trim().isEmpty ? null : user.trim(),
        password: password,
      ),
    ),
  );
}
