// The app's half of the ladder: how a paired host maps onto the family's candidates.
//
// The *order* is the family's and is asserted in `envoy_thin_client`'s own
// `candidate_resolver_test.dart`; what is checked here is the mapping this app owns — which field of
// the pairing payload becomes which slot, and which payloads produce no P2P rung at all.

import 'package:envoydev_mobile/models/host.dart';
import 'package:envoydev_mobile/services/route_plan.dart';
import 'package:flutter_test/flutter_test.dart';

const home = '12D3KooWhome';
const directAddr = '/ip4/192.168.1.9/tcp/4001/p2p/$home';

CoderHost host({
  String endpoint = '192.168.1.9:4770',
  bool secure = false,
  String token = 'tok',
  String? lanWsUrl,
  String? homePeerId,
  List<String>? bootstrapPeers,
  String? relayWsUrl,
  List<String>? relayWsUrls,
  SshHop? ssh,
}) =>
    CoderHost(
      id: 'h',
      label: 'desk',
      endpoint: endpoint,
      ownerId: 'o',
      app: 'EnvoyDev',
      token: token,
      secure: secure,
      lanWsUrl: lanWsUrl,
      homePeerId: homePeerId,
      bootstrapPeers: bootstrapPeers,
      relayWsUrl: relayWsUrl,
      relayWsUrls: relayWsUrls,
      ssh: ssh,
    );

List<String> namesFor(CoderHost h) => candidatesFor(h).map((c) => c.name).toList();

void main() {
  test('a QR host walks the family order, relay last', () {
    final names = namesFor(host(
      lanWsUrl: 'ws://192.168.1.9:4770/ws',
      homePeerId: home,
      bootstrapPeers: [directAddr, 'ws://relay-b.example/ws'],
      relayWsUrl: 'wss://relay.example/ws',
      relayWsUrls: ['wss://relay-c.example/ws'],
    ));

    expect(names, [
      'lan',
      // The P2P cap is 1 without a connectivity observer, and the direct address takes it — the
      // circuit hop through the community relay is not offered on this walk.
      'p2p-direct',
      'relay',
      'relay-1',
      'relay-2',
      'community-relay',
    ]);
  });

  test('the primary address becomes the LAN rung when the code carried no LAN URL', () {
    final candidates = candidatesFor(host());
    expect(candidates.first.name, 'lan');
    expect(candidates.first.url, 'ws://192.168.1.9:4770/ws?token=tok');
  });

  test('a secure primary address is not downgraded to ws', () {
    // `publicHost` hardcodes `ws://`; the mapping must not route a `wss://` host through it.
    final candidates = candidatesFor(host(endpoint: 'desk.example:4770', secure: true));
    expect(candidates.first.url, startsWith('wss://desk.example:4770/ws'));
  });

  test('the token is attached once per WebSocket candidate', () {
    final candidates = candidatesFor(host(
      lanWsUrl: 'ws://192.168.1.9:4770/ws',
      relayWsUrl: 'wss://relay.example/ws',
      relayWsUrls: ['wss://relay-c.example/ws'],
    ));
    for (final candidate in candidates.where((c) => c.url.startsWith('ws'))) {
      expect('token='.allMatches(candidate.url).length, 1, reason: candidate.url);
    }
  });

  test('a peer id with no address yields no P2P rung', () {
    // The family would reach a known peer id through the built-in community relay. This app does not
    // send a dial at shared infrastructure on a desktop's behalf when the code named no address, so
    // the id is dropped at the mapping and no `p2p-*` candidate exists.
    final names = namesFor(host(homePeerId: home, bootstrapPeers: const []));
    expect(names.where((n) => n.startsWith('p2p-')), isEmpty);
    expect(names.contains('community-relay'), isFalse);
  });

  test('addresses with no peer id yield no P2P rung', () {
    final names = namesFor(host(bootstrapPeers: [directAddr]));
    expect(names.where((n) => n.startsWith('p2p-')), isEmpty);
  });

  test('the direct address is dialled as-is, not as its own relay', () {
    final p2p = candidatesFor(host(homePeerId: home, bootstrapPeers: [directAddr]))
        .firstWhere((c) => c.name == 'p2p-direct');
    expect(p2p.url, directAddr);
    expect(p2p.libp2pRelayAddr, directAddr);
    expect(p2p.sessionToken, 'tok');
  });

  test('the host identity does not leak into the next host’s relay candidate', () {
    // `setCommunityHomePeerId` is process-wide family state; resolving host B after host A must not
    // build B's candidate out of A's peer id.
    candidatesFor(host(homePeerId: home, bootstrapPeers: [directAddr]));
    final other = candidatesFor(host(endpoint: '10.0.0.5:4770'))
        .where((c) => c.name == 'community-relay');
    expect(other, isEmpty);
  });
}
