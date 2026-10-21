import 'package:envoydev_mobile/services/lan_reachability.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('ipv4HostOf reads URL, host:port, and bare host', () {
    expect(ipv4HostOf('ws://192.168.3.85:4770/ws'), '192.168.3.85');
    expect(ipv4HostOf('192.168.3.85:4770'), '192.168.3.85');
    expect(ipv4HostOf('10.0.0.2'), '10.0.0.2');
    expect(ipv4HostOf('desk.local'), isNull);
  });

  test('samePrivateSite matches home /24 and rejects a foreign Wi‑Fi', () {
    expect(samePrivateSite('192.168.3.10', '192.168.3.85'), isTrue);
    expect(samePrivateSite('192.168.1.10', '192.168.3.85'), isFalse);
    expect(samePrivateSite('10.1.2.3', '10.1.9.9'), isTrue);
    expect(samePrivateSite('10.1.2.3', '10.2.9.9'), isFalse);
    expect(samePrivateSite('8.8.8.8', '192.168.3.85'), isFalse);
  });

  test('loopback targets are never a shared LAN', () async {
    expect(await phoneSharesLanWith('ws://127.0.0.1:4770/ws'), isFalse);
  });
}
