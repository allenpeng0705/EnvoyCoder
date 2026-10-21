/// Whether this phone appears to sit on the same private LAN as a paired desktop.
///
/// Wi‑Fi alone is not enough: a cafe SSID still cannot reach `192.168.3.85`. Trying that address
/// off the home LAN is the same waste (and upgrade-sweep flap) as dialling it on 5G. Same-/24
/// (or same site prefix for 10./172.16–31.) is the cheap proof we have without a probe dial.
library;

import 'dart:io';

/// True when at least one of this device's IPv4 addresses shares a private site with [lanTarget].
///
/// [lanTarget] may be a `ws(s)://host:port/…` URL, `host:port`, or a bare host. Loopback targets
/// never count as a shared LAN from the phone's point of view (the phone's loopback is itself).
Future<bool> phoneSharesLanWith(
  String lanTarget, {
  Future<List<NetworkInterface>> Function()? listInterfaces,
}) async {
  final target = ipv4HostOf(lanTarget);
  if (target == null || _isLoopback(target)) return false;

  final interfaces = listInterfaces != null
      ? await listInterfaces()
      : await NetworkInterface.list(
          includeLinkLocal: false,
          type: InternetAddressType.IPv4,
        );
  for (final iface in interfaces) {
    for (final addr in iface.addresses) {
      if (addr.type != InternetAddressType.IPv4) continue;
      if (_isLoopback(addr.address)) continue;
      if (samePrivateSite(addr.address, target)) return true;
    }
  }
  return false;
}

/// Host part of a URL / `host:port` / bare host, when it is an IPv4 literal.
String? ipv4HostOf(String raw) {
  final trimmed = raw.trim();
  if (trimmed.isEmpty) return null;
  var host = trimmed;
  final uri = Uri.tryParse(trimmed.contains('://') ? trimmed : 'ws://$trimmed');
  if (uri != null && uri.host.isNotEmpty) host = uri.host;
  final m = RegExp(r'^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$').firstMatch(host);
  if (m == null) return null;
  for (var i = 1; i <= 4; i++) {
    final o = int.parse(m.group(i)!);
    if (o < 0 || o > 255) return null;
  }
  return host;
}

/// Same private "site" — /24 for `192.168.x`, /16 for `10.x` and `172.16–31.x`.
///
/// Deliberately coarse: home routers almost always put phone and desktop in one of these, and a
/// finer mask would need DHCP knowledge we do not have. Public / mismatched private → false.
bool samePrivateSite(String a, String b) {
  final pa = _parseV4(a);
  final pb = _parseV4(b);
  if (pa == null || pb == null) return false;
  if (!_isPrivate(pa) || !_isPrivate(pb)) return false;
  // 10.0.0.0/8 → compare first two octets (/16 site).
  if (pa[0] == 10 && pb[0] == 10) {
    return pa[0] == pb[0] && pa[1] == pb[1];
  }
  // 172.16.0.0/12 → /16 within the block.
  if (_is172Private(pa) && _is172Private(pb)) {
    return pa[0] == pb[0] && pa[1] == pb[1];
  }
  // 192.168.0.0/16 → /24 (typical home LAN).
  if (pa[0] == 192 && pa[1] == 168 && pb[0] == 192 && pb[1] == 168) {
    return pa[2] == pb[2];
  }
  return false;
}

List<int>? _parseV4(String host) {
  final parts = host.split('.');
  if (parts.length != 4) return null;
  final out = <int>[];
  for (final p in parts) {
    final n = int.tryParse(p);
    if (n == null || n < 0 || n > 255) return null;
    out.add(n);
  }
  return out;
}

bool _isLoopback(String host) => host.startsWith('127.');

bool _isPrivate(List<int> o) {
  if (o[0] == 10) return true;
  if (o[0] == 192 && o[1] == 168) return true;
  if (_is172Private(o)) return true;
  return false;
}

bool _is172Private(List<int> o) => o[0] == 172 && o[1] >= 16 && o[1] <= 31;
