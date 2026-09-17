/// An SSH local forward to a daemon that is not directly reachable.
///
/// A `ssh -N -L <local>:127.0.0.1:<remote> <hop>` in-process with `dartssh2`: the daemon sees the
/// connection arrive on its own loopback, which is why a token is optional on this route
/// (`add_host.dart` says so in the user's language). The forward is what makes the direct candidate
/// dialable — the candidate's address (`127.0.0.1:4770`) is only meaningful *from the far machine*,
/// so it is swapped for a loopback URL here rather than being dialled as written.
///
/// Extracted from `HostClient` so the client is a client: it holds a walk and a wire protocol, not a
/// socket, a `ServerSocket` and their teardown order.
library;

import 'dart:async';
import 'dart:io';

import 'package:dartssh2/dartssh2.dart';

import '../models/host.dart';

/// Opens an SSH local forward and returns `ws://127.0.0.1:<local>/ws?token=…`.
typedef SshTunnelOpener = Future<String> Function(CoderHost host, SshHop hop);

class SshTunnel {
  SSHClient? _client;
  ServerSocket? _server;
  StreamSubscription<Socket>? _accepts;

  /// Open the forward, replacing any previous one.
  Future<String> open(CoderHost host, SshHop hop) async {
    await close();
    final socket = await SSHSocket.connect(hop.host, hop.port);
    final client = SSHClient(
      socket,
      username: hop.user ?? 'root',
      onPasswordRequest: () => hop.password ?? '',
    );
    await client.authenticated;
    _client = client;

    final remotePort = remoteDaemonPort(host);
    // dartssh2's `forwardLocal` opens one channel; a local [ServerSocket] is the `-L` listener that
    // accepts a connection and then opens a channel per connection.
    final server = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
    _server = server;
    _accepts = server.listen((clientSocket) async {
      try {
        final forward = await client.forwardLocal('127.0.0.1', remotePort);
        unawaited(forward.stream.cast<List<int>>().pipe(clientSocket));
        unawaited(clientSocket.cast<List<int>>().pipe(forward.sink));
      } catch (_) {
        try {
          await clientSocket.close();
        } catch (_) {}
      }
    });
    return attachToken('ws://127.0.0.1:${server.port}/ws', host.token);
  }

  Future<void> close() async {
    await _accepts?.cancel();
    _accepts = null;
    try {
      await _server?.close();
    } catch (_) {}
    _server = null;
    try {
      _client?.close();
    } catch (_) {}
    _client = null;
  }

  /// Daemon port on the far side of the hop (from `endpoint`, else the product default).
  static int remoteDaemonPort(CoderHost host) {
    final parts = host.endpoint.split(':');
    if (parts.length >= 2) {
      final port = int.tryParse(parts.last);
      if (port != null && port > 0) return port;
    }
    return 4770;
  }

  /// Append `?token=` (or `&token=`) without duplicating an existing token param.
  static String attachToken(String url, String token) {
    final uri = Uri.tryParse(url);
    if (uri == null) return url;
    final params = Map<String, String>.from(uri.queryParameters);
    params['token'] = token;
    return uri.replace(queryParameters: params).toString();
  }
}
