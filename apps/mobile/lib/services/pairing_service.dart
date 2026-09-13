/// Reading a pairing code, the same way every app in the family reads one.
///
/// A QR code is a URI minted by `@envoymesh/protocol` (`envoy://pair?…`). Two rules matter here,
/// and both are the family's rather than this app's invention:
///
///   1. **The `app` claim decides.** A code made by EnvoyMesh, EnvoyAgent or anything else must be
///      refused with the shared sentence — not tried and failed, which reads as "the app is broken".
///   2. **The token stays a secret.** It is the whole credential, so it is never logged, never put
///      in a deep link, and never rendered.
library;

import 'dart:convert';

import '../models/host.dart';

/// The name this app claims in every code it mints or accepts.
const String kAppName = 'EnvoyCoder';

class PairingResult {
  const PairingResult.accepted(this.host) : refusal = null;
  const PairingResult.refused(this.refusal) : host = null;

  final CoderHost? host;
  final String? refusal;

  bool get ok => host != null;
}

/// Refuse a code minted by another app, in the words the whole family uses.
///
/// Kept byte-for-byte aligned with `pairingAppMismatch` in `@envoymesh/protocol` and with the Dart
/// twin in EnvoyMesh's thin client: a user who tries the wrong code in three apps should read the
/// same sentence three times, not three different explanations.
String? pairingAppMismatch(String? codeApp, [String nodeApp = kAppName]) {
  final claimed = codeApp?.trim() ?? '';
  if (claimed.isEmpty) return null;
  if (claimed == nodeApp.trim()) return null;
  return 'That code was made by $claimed, and this is $nodeApp. '
      'Open $claimed and show its pairing code, or install $claimed here.';
}

/// Parse `envoy://pair?…` into a host, or explain why not.
PairingResult parsePairingCode(String input) {
  final trimmed = input.trim();
  if (trimmed.isEmpty) return const PairingResult.refused('That pairing code is empty.');

  final Uri uri;
  try {
    uri = Uri.parse(trimmed);
  } on FormatException {
    return const PairingResult.refused('That does not look like a pairing code.');
  }

  // Accept both a full `envoy://pair?...` URI and a bare query string, because some scanners hand
  // back only the query and a user should not have to care which.
  final params = uri.scheme.isEmpty
      ? Uri.splitQueryString(trimmed.startsWith('?') ? trimmed.substring(1) : trimmed)
      : (uri.scheme == 'envoy' ? uri.queryParameters : const <String, String>{});

  final wsUrl = params['wsUrl'];
  final token = params['token'];
  final ownerId = params['ownerId'];
  if (wsUrl == null || wsUrl.isEmpty) {
    return const PairingResult.refused('That pairing code is missing the address of the host.');
  }
  if (token == null || token.isEmpty) {
    return const PairingResult.refused('That pairing code is missing its access token.');
  }

  final mismatch = pairingAppMismatch(params['app']);
  if (mismatch != null) return PairingResult.refused(mismatch);

  final parsed = Uri.tryParse(wsUrl);
  if (parsed == null || parsed.host.isEmpty) {
    return const PairingResult.refused('That pairing code has an address this app cannot read.');
  }

  final endpoint = parsed.hasPort ? '${parsed.host}:${parsed.port}' : parsed.host;
  return PairingResult.accepted(
    CoderHost(
      id: '${ownerId ?? endpoint}::$endpoint',
      label: parsed.host,
      endpoint: endpoint,
      ownerId: ownerId ?? '',
      app: params['app'] ?? kAppName,
      token: token,
      secure: parsed.scheme == 'wss',
    ),
  );
}

/// A readable summary for the host list — never the token.
String describeHost(CoderHost host) {
  final base = '${host.label} (${host.endpoint})';
  return host.ssh == null ? base : '$base via ${host.ssh!.host}';
}

/// Encode a code, for tests and for the desktop's "show this as a QR" path.
String buildPairingCode({
  required String wsUrl,
  required String token,
  required String ownerId,
  String app = kAppName,
}) {
  final query = {
    'wsUrl': wsUrl,
    'token': token,
    'ownerId': ownerId,
    'app': app,
  };
  return 'envoy://pair?${query.entries.map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}').join('&')}';
}

/// Base64-free JSON of the host list, so a stored profile survives a restart without a plugin.
String encodeHosts(List<CoderHost> hosts) => jsonEncode(
      hosts
          .map((host) => {
                'id': host.id,
                'label': host.label,
                'endpoint': host.endpoint,
                'ownerId': host.ownerId,
                'app': host.app,
                'token': host.token,
                'secure': host.secure,
                if (host.ssh != null)
                  'ssh': {'host': host.ssh!.host, 'port': host.ssh!.port, if (host.ssh!.user != null) 'user': host.ssh!.user},
              })
          .toList(),
    );
