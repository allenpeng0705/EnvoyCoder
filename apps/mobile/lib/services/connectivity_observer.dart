/// Wi‑Fi vs cellular for the dial ladder — same seam EnvoyGo uses.
///
/// Off Wi‑Fi the phone must not spend the walk (or the upgrade sweep) on private LAN
/// addresses: they cannot answer, and a successful circuit that is later "upgraded" to a
/// doomed LAN dial is exactly the green→orange flap on 5G. This observer is how the walk
/// knows which world it is in.
library;

import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';

abstract class ConnectivityObserver {
  /// Offline → online.
  Stream<void> get onBecameOnline;

  /// Wi‑Fi ↔ cellular while still online — reconnect so candidates reorder.
  Stream<void> get onNetworkTypeChanged;

  Future<void> start();

  Future<void> dispose();

  /// True on Wi‑Fi, false on cellular / offline, null before the first reading.
  bool? get isOnWifi;
}

class RealConnectivityObserver implements ConnectivityObserver {
  RealConnectivityObserver({Connectivity? connectivity})
      : _connectivity = connectivity ?? Connectivity();

  final Connectivity _connectivity;
  final StreamController<void> _onlineController = StreamController<void>.broadcast();
  final StreamController<void> _typeController = StreamController<void>.broadcast();
  StreamSubscription<List<ConnectivityResult>>? _sub;
  bool _wasOnline = false;
  bool _started = false;
  bool? _isOnWifi;

  @override
  Stream<void> get onBecameOnline => _onlineController.stream;

  @override
  Stream<void> get onNetworkTypeChanged => _typeController.stream;

  @override
  bool? get isOnWifi => _isOnWifi;

  @override
  Future<void> start() async {
    if (_started) return;
    _started = true;
    try {
      final initial = await _connectivity.checkConnectivity();
      _wasOnline = _isOnline(initial);
      _isOnWifi = _checkIsOnWifi(initial);
    } catch (_) {
      _wasOnline = true;
    }
    _sub = _connectivity.onConnectivityChanged.listen(_onChange);
  }

  @override
  Future<void> dispose() async {
    await _sub?.cancel();
    _sub = null;
    if (!_onlineController.isClosed) await _onlineController.close();
    if (!_typeController.isClosed) await _typeController.close();
  }

  void _onChange(List<ConnectivityResult> results) {
    final online = _isOnline(results);
    if (online && !_wasOnline && !_onlineController.isClosed) {
      _onlineController.add(null);
    }
    final nextWifi = _checkIsOnWifi(results);
    if (online &&
        _wasOnline &&
        _isOnWifi != null &&
        nextWifi != _isOnWifi &&
        !_typeController.isClosed) {
      _typeController.add(null);
    }
    _wasOnline = online;
    _isOnWifi = nextWifi;
  }

  static bool _isOnline(List<ConnectivityResult> results) {
    if (results.isEmpty) return false;
    return results.any((r) => r != ConnectivityResult.none);
  }

  static bool _checkIsOnWifi(List<ConnectivityResult> results) {
    return results.any((r) => r == ConnectivityResult.wifi);
  }
}
