/// Talking to an EnvoyCoder daemon from the phone.
///
/// The transport is plain WebSocket JSON-RPC on the daemon's own port, which is the family's shape
/// and needs no plugin: `dart:io` already has it. Two deliberate choices:
///
///   * **No SDK dependency.** The method catalogue lives in `@envoycoder/protocol` on the desktop,
///     and the phone only needs the handful of names it calls; a generated SDK would be a second
///     source of truth to keep in step.
///   * **Reconnect with backoff, and say so.** A phone that walks out of Wi-Fi range should show
///     "reconnecting", not an empty task list — an empty list reads as "my work is gone".
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import '../models/host.dart';

enum HostConnectionState { idle, connecting, connected, reconnecting, failed }

class HostClient {
  HostClient(this.host);

  final CoderHost host;
  WebSocket? _socket;
  int _nextId = 1;
  final Map<int, Completer<Map<String, dynamic>>> _pending = {};
  final _stateController = StreamController<HostConnectionState>.broadcast();
  final _eventController = StreamController<Map<String, dynamic>>.broadcast();
  StreamSubscription<dynamic>? _subscription;
  Timer? _retry;

  Stream<HostConnectionState> get states => _stateController.stream;

  /// Daemon-pushed events (`run.output`, `run.status`, `run.approval-requested`, …).
  Stream<Map<String, dynamic>> get events => _eventController.stream;

  Future<void> connect() async {
    _stateController.add(HostConnectionState.connecting);
    try {
      final socket = await WebSocket.connect(host.wsUri.toString());
      _socket = socket;
      _stateController.add(HostConnectionState.connected);
      _subscription = socket.listen(
        _onFrame,
        onDone: () => _scheduleReconnect('the host closed the connection'),
        onError: (Object error) => _scheduleReconnect('$error'),
        cancelOnError: true,
      );
      await call('coder.hello', {'client': 'mobile', 'protocol': 1});
    } catch (error) {
      _scheduleReconnect('$error');
    }
  }

  void _onFrame(dynamic frame) {
    if (frame is! String) return;
    final decoded = jsonDecode(frame);
    if (decoded is! Map<String, dynamic>) return;
    final id = decoded['id'];
    if (id is int && _pending.containsKey(id)) {
      final completer = _pending.remove(id)!;
      final error = decoded['error'];
      if (error != null) {
        completer.completeError(StateError('$error'));
      } else {
        final result = decoded['result'];
        completer.complete(result is Map<String, dynamic> ? result : <String, dynamic>{'value': result});
      }
      return;
    }
    _eventController.add(decoded);
  }

  /// One request, with a timeout so a wedged host cannot hang the UI forever.
  Future<Map<String, dynamic>> call(
    String method, [
    Map<String, dynamic> params = const {},
    Duration timeout = const Duration(seconds: 15),
  ]) {
    final socket = _socket;
    if (socket == null) {
      return Future.error(StateError('not connected to ${host.endpoint}'));
    }
    final id = _nextId++;
    final completer = Completer<Map<String, dynamic>>();
    _pending[id] = completer;
    socket.add(jsonEncode({'jsonrpc': '2.0', 'id': id, 'method': method, 'params': params}));
    Timer(timeout, () {
      if (_pending.remove(id) != null) {
        completer.completeError(TimeoutException('$method timed out after ${timeout.inSeconds}s'));
      }
    });
    return completer.future;
  }

  void _scheduleReconnect(String reason) {
    _socket = null;
    // Fail the in-flight calls rather than leaving the UI spinning.
    for (final entry in _pending.entries) {
      if (!entry.value.isCompleted) {
        entry.value.completeError(StateError('disconnected: $reason'));
      }
    }
    _pending.clear();
    _stateController.add(HostConnectionState.reconnecting);
    _retry?.cancel();
    _retry = Timer(const Duration(seconds: 3), () {
      unawaited(connect());
    });
  }

  Future<void> dispose() async {
    _retry?.cancel();
    await _subscription?.cancel();
    await _socket?.close();
    await _stateController.close();
    await _eventController.close();
  }
}
