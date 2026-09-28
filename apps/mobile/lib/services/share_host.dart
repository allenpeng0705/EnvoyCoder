/// Text another EnvoyDev can paste to join the same home — **only** the method this phone used.
///
/// ## Why this exists
///
/// A laptop away from home cannot open Settings → Pair devices on the home machine. The phone
/// already holds the credential and the dial path. Sharing invents no second trust model: it
/// re-exports what this install stored when it paired (link → rebuilt `envoy://pair` URI;
/// direct → host:port + token; ssh → hop + daemon + token). Never invent a method the phone did
/// not use — that would claim reachability the user never proved.
///
/// The payload is a secret (it contains the token). Copy / share only to a device the owner trusts.
library;

import '../models/host.dart';
import 'pairing_service.dart';

/// Human-readable share text for [host], shaped for the laptop’s matching join tab.
String sharePayloadFor(CoderHost host) {
  switch (host.effectiveJoinMethod) {
    case HostJoinMethod.link:
      return _linkPayload(host);
    case HostJoinMethod.direct:
      return _directPayload(host);
    case HostJoinMethod.ssh:
      return _sshPayload(host);
  }
}

String _linkPayload(CoderHost host) {
  final wsUrl = host.lanWsUrl ?? host.directWsUrl;
  return buildPairingCode(
    wsUrl: wsUrl,
    token: host.token,
    ownerId: host.ownerId.isEmpty ? 'envoy:owner:shared' : host.ownerId,
    app: host.app,
    lanWsUrl: host.lanWsUrl,
    homePeerId: host.homePeerId,
    bootstrapPeers: host.bootstrapPeers,
    relayWsUrl: host.relayWsUrl,
    relayWsUrls: host.relayWsUrls,
  );
}

String _directPayload(CoderHost host) {
  return 'endpoint: ${host.endpoint}\ntoken: ${host.token}';
}

String _sshPayload(CoderHost host) {
  final hop = host.ssh;
  // Never include sshPassword: the laptop join form does not consume it, and a clipboard share is
  // too easy to paste into chat. The owner types the password on the machine that opens the hop.
  final lines = <String>[
    if (hop != null) ...[
      'sshHost: ${hop.host}',
      if (hop.user != null && hop.user!.isNotEmpty) 'sshUser: ${hop.user}',
      'sshPort: ${hop.port}',
    ],
    'daemon: ${host.endpoint}',
    if (host.token.isNotEmpty) 'token: ${host.token}',
  ];
  return lines.join('\n');
}
