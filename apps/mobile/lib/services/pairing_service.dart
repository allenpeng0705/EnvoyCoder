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

// Prefixed: the shared contract exports `pairingAppMismatch` too, and this file keeps the same name
// for its own callers while delegating the *wording* to the one implementation.
import 'package:envoy_thin_client/envoy_thin_client.dart' as thin;

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
/// **Delegated, not re-implemented.** The sentence comes from `envoy_thin_client`, which is the
/// Dart twin of `@envoymesh/protocol`'s `pairingAppMismatch`. A user who tries the wrong code in
/// three apps reads the same sentence three times because there is one implementation, not three
/// careful copies.
String? pairingAppMismatch(String? codeApp, [String nodeApp = kAppName]) =>
    thin.pairingAppMismatch(codeApp, nodeApp);

/// Parse a pairing code with the family's parser, and map it to this app's host model.
///
/// The parser accepts both the compact code a QR carries and the legacy query form, and both expose
/// `app` — the field step 1 of the guide's flow (§5.2) turns on. Refusals are returned rather than
/// thrown, because "that code is for another app" is a normal outcome a screen renders.
PairingResult parsePairingCode(String input) {
  final trimmed = input.trim();
  if (trimmed.isEmpty) return const PairingResult.refused('That pairing code is empty.');

  final thin.PairingData? data;
  try {
    data = thin.parsePairingUri(trimmed);
  } on FormatException {
    return const PairingResult.refused('That does not look like a pairing code.');
  }
  if (data == null) {
    return const PairingResult.refused(
      'That pairing code could not be read. Ask the desktop to show it again.',
    );
  }

  // Step 1 of the guide's flow, and the phone's job alone: the node cannot refuse a cross-app code,
  // because the token inside it is opaque and app-local.
  final mismatch = pairingAppMismatch(data.app, kAppName);
  if (mismatch != null) return PairingResult.refused(mismatch);

  final parsed = Uri.tryParse(data.wsUrl);
  if (parsed == null || parsed.host.isEmpty) {
    return const PairingResult.refused('That pairing code has an address this app cannot read.');
  }
  final endpoint = parsed.hasPort ? '${parsed.host}:${parsed.port}' : parsed.host;

  return PairingResult.accepted(
    CoderHost(
      id: '${data.ownerId ?? endpoint}::$endpoint',
      label: parsed.host,
      endpoint: endpoint,
      ownerId: data.ownerId ?? '',
      app: data.app ?? kAppName,
      token: data.token,
      secure: parsed.scheme == 'wss',
      // Carried through from the shared contract: the family's relay roster is how a phone that is
      // not on the LAN still reaches this machine, and a product does not invent its own.
      relayPeerId: data.relayPeerId,
      relayWsUrl: data.relayWsUrl,
    ),
  );
}

/// A readable summary for the host list — never the token.
String describeHost(CoderHost host) {
  final base = '${host.label} (${host.endpoint})';
  return host.ssh == null ? base : '$base via ${host.ssh!.host}';
}

/// Encode a code, **for tests only**.
///
/// Minting is the desktop's job, and it uses the shared TypeScript builder so that the family has
/// exactly one encoder. This helper exists so a test can produce a code to parse, and it deliberately
/// mirrors the shared field names rather than inventing its own.
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
                if (host.relayPeerId != null) 'relayPeerId': host.relayPeerId,
                if (host.relayWsUrl != null) 'relayWsUrl': host.relayWsUrl,
                if (host.ssh != null)
                  'ssh': {'host': host.ssh!.host, 'port': host.ssh!.port, if (host.ssh!.user != null) 'user': host.ssh!.user},
              })
          .toList(),
    );
