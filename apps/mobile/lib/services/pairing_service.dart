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
const String kAppName = 'EnvoyDev';

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

  // The shared parser falls `relayWsUrl` back to `wsUrl` when the code omitted a relay. That is
  // useful for EnvoyMesh's candidate list; here a duplicate of the primary address would only burn
  // a dial attempt, so keep it only when it differs.
  final primaryWs = data.wsUrl;
  final relayWsUrl = data.relayWsUrl.trim().isEmpty || data.relayWsUrl == primaryWs
      ? null
      : data.relayWsUrl;
  final relayWsUrls = data.relayWsUrls
      ?.where((url) => url.trim().isNotEmpty && url != primaryWs && url != relayWsUrl)
      .toList();

  return PairingResult.accepted(
    CoderHost(
      id: '${data.ownerId ?? endpoint}::$endpoint',
      label: parsed.host,
      endpoint: endpoint,
      ownerId: data.ownerId ?? '',
      app: data.app ?? kAppName,
      token: data.token,
      secure: parsed.scheme == 'wss',
      lanWsUrl: data.lanWsUrl,
      // The desktop's own peer id, when the code carries one. The family parser has always exposed
      // it (`PairingData.homeNodePeerId`); this app stored only the *relay's* id, so the direct-libp2p
      // rung had nothing to dial even on a code that named the desktop. Optional and additive: a code
      // without the field leaves it null, and the rung is then dropped rather than guessed at.
      homePeerId: data.homeNodePeerId,
      // The addresses that make that peer id reachable. The family parser reads them from the code
      // (`bootstrapPeers`) and from the compact token's `bp` key; without them the id alone names the
      // desktop and cannot be dialled, so the rung stays out of the ladder instead of failing in it.
      bootstrapPeers: data.bootstrapPeers,
      // Carried through from the shared contract: the family's relay roster is how a phone that is
      // not on the LAN still reaches this machine, and a product does not invent its own.
      relayPeerId: data.relayPeerId,
      relayWsUrl: relayWsUrl,
      relayWsUrls: (relayWsUrls == null || relayWsUrls.isEmpty) ? null : relayWsUrls,
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
  String? lanWsUrl,
  String? homePeerId,
  List<String>? bootstrapPeers,
  String? relayWsUrl,
  List<String>? relayWsUrls,
}) {
  final query = <String, String>{
    'wsUrl': wsUrl,
    'token': token,
    'ownerId': ownerId,
    'app': app,
    if (lanWsUrl != null) 'lanWsUrl': lanWsUrl,
    if (homePeerId != null) 'homeNodePeerId': homePeerId,
    if (bootstrapPeers != null && bootstrapPeers.isNotEmpty)
      'bootstrapPeers': bootstrapPeers.join(','),
    if (relayWsUrl != null) 'relayWsUrl': relayWsUrl,
    if (relayWsUrls != null && relayWsUrls.isNotEmpty) 'rels': relayWsUrls.join(','),
  };
  return 'envoy://pair?${query.entries.map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}').join('&')}';
}

/// Host **metadata** for shared_preferences — never the token.
///
/// Tokens live only in flutter_secure_storage (`HostStore`). Keeping them out of this JSON is what
/// stops a prefs dump / backup from walking away with the credential.
String encodeHosts(List<CoderHost> hosts) => jsonEncode(
      hosts
          .map((host) => {
                'id': host.id,
                'label': host.label,
                'endpoint': host.endpoint,
                'ownerId': host.ownerId,
                'app': host.app,
                'secure': host.secure,
                if (host.lanWsUrl != null) 'lanWsUrl': host.lanWsUrl,
                if (host.homePeerId != null) 'homePeerId': host.homePeerId,
                if (host.bootstrapPeers != null && host.bootstrapPeers!.isNotEmpty)
                  'bootstrapPeers': host.bootstrapPeers,
                if (host.relayPeerId != null) 'relayPeerId': host.relayPeerId,
                if (host.relayWsUrl != null) 'relayWsUrl': host.relayWsUrl,
                if (host.relayWsUrls != null && host.relayWsUrls!.isNotEmpty)
                  'relayWsUrls': host.relayWsUrls,
                if (host.lastSeenAt != null) 'lastSeenAt': host.lastSeenAt!.toIso8601String(),
                if (host.ssh != null)
                  'ssh': {
                    'host': host.ssh!.host,
                    'port': host.ssh!.port,
                    if (host.ssh!.user != null) 'user': host.ssh!.user,
                  },
              })
          .toList(),
    );

/// Inverse of [encodeHosts]. Tokens are filled later by [HostStore].
List<CoderHost> decodeHosts(String json, {Map<String, String> tokens = const {}}) {
  final decoded = jsonDecode(json);
  if (decoded is! List) return const [];
  final hosts = <CoderHost>[];
  for (final entry in decoded) {
    if (entry is! Map) continue;
    final map = Map<String, dynamic>.from(entry);
    final id = map['id'] as String?;
    final endpoint = map['endpoint'] as String?;
    if (id == null || endpoint == null) continue;
    final sshMap = map['ssh'];
    SshHop? ssh;
    if (sshMap is Map) {
      final sshHost = sshMap['host'] as String?;
      if (sshHost != null && sshHost.isNotEmpty) {
        ssh = SshHop(
          host: sshHost,
          port: (sshMap['port'] as num?)?.toInt() ?? 22,
          user: sshMap['user'] as String?,
        );
      }
    }
    final relayList = map['relayWsUrls'];
    hosts.add(
      CoderHost(
        id: id,
        label: (map['label'] as String?) ?? endpoint,
        endpoint: endpoint,
        ownerId: (map['ownerId'] as String?) ?? '',
        app: (map['app'] as String?) ?? kAppName,
        token: tokens[id] ?? '',
        secure: map['secure'] == true,
        lanWsUrl: map['lanWsUrl'] as String?,
        homePeerId: map['homePeerId'] as String?,
        // Read back as a list, because that is what it is in the contract. Persisted hosts must keep
        // it: a phone that forgot the addresses on restart would silently lose the direct peer route
        // while still showing the peer id in its own record.
        bootstrapPeers: (map['bootstrapPeers'] as List?)?.whereType<String>().toList(),
        relayPeerId: map['relayPeerId'] as String?,
        relayWsUrl: map['relayWsUrl'] as String?,
        relayWsUrls: relayList is List
            ? relayList.whereType<String>().where((u) => u.isNotEmpty).toList()
            : null,
        ssh: ssh,
        lastSeenAt: map['lastSeenAt'] is String ? DateTime.tryParse(map['lastSeenAt'] as String) : null,
      ),
    );
  }
  return hosts;
}
