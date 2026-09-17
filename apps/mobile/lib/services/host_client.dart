/// Talking to an EnvoyDev daemon from the phone.
///
/// ## One ladder, and it is the family's
///
/// This client owns no route order. It asks the family's `CandidateResolver` for candidates
/// (LAN → public → P2P → bootstrap → relay last), hands them to the family's `HomeRemoteClient`,
/// and adapts the two transports the app must supply — a libp2p dial and an SSH-forwarded WebSocket
/// — where the family leaves a seam. The app used to keep its own ladder (`RouteResolver`); two
/// ladders meant two answers to "how is this host reached", and the one the phone walked was the one
/// the family's fixes never reached. `route_plan.dart` is all that is left of the app's routing
/// knowledge: which field of the pairing payload goes where.
///
/// ## What the app still decides, and why that is not a second ladder
///
///   * **Which SSH-host candidates go through the forward.** The family has no SSH concept. Rather
///     than adding a rung for it, the hop is a *transport* for the candidate whose address is the
///     daemon's own — the tunnel is what makes that address reachable from the phone at all. The
///     ordering, the names and the fallbacks stay the family's.
///   * **The dial budget** ([DialBudget]): per-candidate timeout, attempts per walk, and deferral
///     under pressure. It shapes the list the ladder walks; it does not reorder it.
///
/// ## Wire protocol
///
/// JSON-RPC in the family's shape — `{id, method, params}` with **no** `jsonrpc:"2.0"` — over
/// whichever transport won, plus `coder.subscribe`, which this daemon needs per connection to deliver
/// a single event (`apps/desktop/src/daemon/events.ts`).
library;

import 'dart:async';
import 'dart:io';

import 'package:envoy_thin_client/envoy_thin_client.dart';
import 'package:envoy_thin_client/services/platform_web_socket.dart';

import '../models/host.dart';
import 'libp2p_transport.dart';
import 'route_plan.dart';
import 'ssh_tunnel.dart';

enum HostConnectionState { idle, connecting, connected, reconnecting, failed }

/// Opens one candidate's WebSocket transport.
///
/// Returns the family's [WebSocketLike] rather than a `dart:io` [WebSocket] so a test can supply any
/// duplex, and so the same seam covers `ws://` and `wss://` without this client knowing the
/// difference.
typedef WsDialer = Future<WebSocketLike> Function(String url);

class HostClient {
  HostClient(
    this.host, {
    this.dialer,
    this.sshTunnelOpener,
    this.libp2pDialer,
    this.budget = const DialBudget(),
    this.minDelay = const Duration(seconds: 1),
    this.maxDelay = const Duration(seconds: 20),
  }) {
    _client = HomeRemoteClient(
      HomeRemoteClientOptions(
        resolveCandidates: _resolveCandidates,
        createTransport: _createTransport,
        onHomeOnlineChange: _onHomeOnlineChange,
        onActiveTransportChange: _onActiveTransportChange,
        // Every candidate the client is about to try is a dial this walk attempted; the count is
        // what a failed walk reports to the budget as failures.
        onCandidateTrying: (_) => _attemptsInWalk += 1,
        perCandidateTimeoutMs: budget.perCandidateTimeoutMs,
        initialReconnectDelayMs: minDelay.inMilliseconds,
      ),
    );
    _eventUnsub = _client.onAny(
      (event, data) => _eventController.add(<String, dynamic>{'event': event, 'data': data}),
    );
  }

  CoderHost host;
  final WsDialer? dialer;
  final SshTunnelOpener? sshTunnelOpener;
  final Libp2pDialer? libp2pDialer;
  final DialBudget budget;
  final Duration minDelay;
  final Duration maxDelay;

  late final HomeRemoteClient _client;
  late final void Function() _eventUnsub;
  late final DialBudgetMeter _meter = DialBudgetMeter(budget);
  late final Libp2pTransport _defaultLibp2pDialer = Libp2pTransport();
  final SshTunnel _sshTunnel = SshTunnel();

  final _stateController = StreamController<HostConnectionState>.broadcast();
  final _eventController = StreamController<Map<String, dynamic>>.broadcast();

  Timer? _retry;
  Completer<void>? _handshakeDone;
  bool _disposed = false;
  int _attempt = 0;
  int _attemptsInWalk = 0;

  /// Set by [connect]: dial exactly this URL and do not walk the ladder.
  String? _pinnedUrl;

  /// Candidate names this client reached through the SSH forward, so the route can be named `ssh`
  /// rather than the family's name for the address that was tunnelled.
  final Set<String> _tunneledCandidates = <String>{};

  String? _activeRoute;
  HostConnectionState _state = HostConnectionState.idle;

  Stream<HostConnectionState> get states => _stateController.stream;
  HostConnectionState get state => _state;

  /// Daemon-pushed events as `{event, data}` maps, whatever the event is called.
  Stream<Map<String, dynamic>> get events => _eventController.stream;

  /// The rung in use, for the screens.
  ///
  /// Null until a dial wins, null again when the connection drops (no rung is in play), and null for
  /// a [connect]-pinned URL, which was never a rung of the ladder — naming one there would be a
  /// guess dressed as information.
  String? get activeRoute => _activeRoute;

  /// Walk the family's candidates until one of them reaches the daemon.
  Future<void> connectBest() async {
    if (_disposed) return;
    _pinnedUrl = null;
    final now = DateTime.now();
    if (_meter.isDeferredAt(now)) {
      // The walk is **held**, not attempted and failed: the last few candidate dials failed inside
      // the pressure window, and the budget's whole point is that a bad network stops the radio for
      // a moment instead of spraying dials at every rung in turn. The caller is waiting for exactly
      // what the meter is waiting for, so the wait is scheduled rather than spun on.
      _setState(HostConnectionState.reconnecting);
      _scheduleRetry(_meter.deferralRemainingAt(now));
      return;
    }
    await _connect();
  }

  /// Dial exactly one URL — a caller that already knows the address, not a walk.
  Future<void> connect({String? url}) async {
    if (_disposed) return;
    _pinnedUrl = url ?? host.wsUri.toString();
    await _connect();
  }

  Future<void> _connect() async {
    if (_disposed) return;
    _attemptsInWalk = 0;
    _setState(_attempt == 0 ? HostConnectionState.connecting : HostConnectionState.reconnecting);
    try {
      await _client.ensureConnected();
      // The transport is up; wait for the handshake `_announceOnline` started so the returned future
      // means what the old client's did — connected, with events live.
      await _handshakeDone?.future;
      _meter.recordSuccess();
      _attempt = 0;
    } catch (_) {
      _recordWalkFailure();
      _attempt += 1;
      _setState(HostConnectionState.reconnecting);
      _scheduleRetry(_backoffDelay());
    }
  }

  /// Every candidate the failed walk attempted, as a failure of its own.
  ///
  /// The budget counts *dials*, and a walk that burned four candidates burned four. Recording one
  /// per walk would let a store with a long tail of dead addresses look like a healthy network.
  void _recordWalkFailure() {
    final attempted = _attemptsInWalk;
    _attemptsInWalk = 0;
    for (var i = 0; i < attempted; i++) {
      _meter.recordFailure();
    }
  }

  Duration _backoffDelay() {
    final ms = (minDelay.inMilliseconds * (1 << (_attempt - 1).clamp(0, 4)))
        .clamp(minDelay.inMilliseconds, maxDelay.inMilliseconds);
    return Duration(milliseconds: ms);
  }

  void _scheduleRetry(Duration delay) {
    if (_disposed) return;
    _retry?.cancel();
    _retry = Timer(delay, () {
      if (_disposed) return;
      unawaited(_pinnedUrl == null ? connectBest() : _connect());
    });
  }

  // -- Candidates and transports --

  Future<List<HomeRemoteCandidate>> _resolveCandidates() async {
    final pinned = _pinnedUrl;
    if (pinned != null) {
      // A pinned URL is not a walk: no budget, no deferral, one dial. The budget meters a ladder,
      // and there is no ladder here to meter.
      return <HomeRemoteCandidate>[
        HomeRemoteCandidate(name: 'direct', url: pinned, sessionToken: host.token),
      ];
    }
    return _meter.plan(candidatesFor(host));
  }

  Future<WebSocketLike> _createTransport(HomeRemoteCandidate candidate) async {
    // 1. libp2p. The candidate carries a multiaddr instead of a URL, which is the family's own signal
    //    for "this rung is a peer dial".
    if (candidate.libp2pRelayAddr != null) {
      return (libp2pDialer ?? _defaultLibp2pDialer.dial)(candidate);
    }

    // 2. The relay's peer-routed WebSocket: the relay speaks the client-proxy handshake and forwards
    //    to the home by peer id.
    final homePeerId = candidate.homePeerId;
    if (homePeerId != null && homePeerId.isNotEmpty && candidate.url.contains('?target=')) {
      final target = candidate.url.indexOf('?target=');
      return ClientProxyTransport.connect(
        relayWsUrl: candidate.url.substring(0, target),
        homePeerId: homePeerId,
        sessionToken: candidate.sessionToken ?? '',
      );
    }

    // 3. An SSH hop, when one is configured for the address this candidate names. The candidate's
    //    address is meaningful only from the far machine, so the tunnel's loopback URL replaces it.
    if (_reachesTheHostThroughTheTunnel(candidate)) {
      final opener = sshTunnelOpener ?? _sshTunnel.open;
      final localUrl = await opener(host, host.ssh!);
      _tunneledCandidates.add(candidate.name);
      return _openWebSocket(localUrl);
    }

    // 4. A plain WebSocket.
    return _openWebSocket(candidate.url);
  }

  Future<WebSocketLike> _openWebSocket(String url) {
    final WsDialer dial = dialer ?? PlatformWebSocket.connect;
    return dial(url);
  }

  /// Whether [candidate] names the daemon's own address, which is the address an SSH hop forwards to.
  ///
  /// Compared by authority rather than by candidate name: the family owns the names (`lan`, `public`,
  /// …) and may add one, but "this URL is the host's own endpoint" is a fact about the host record.
  bool _reachesTheHostThroughTheTunnel(HomeRemoteCandidate candidate) {
    if (host.ssh == null) return false;
    if (!candidate.url.startsWith('ws://') && !candidate.url.startsWith('wss://')) return false;
    final uri = Uri.tryParse(candidate.url);
    if (uri == null) return false;
    return uri.authority == host.endpoint;
  }

  // -- Connection state and events --

  void _onHomeOnlineChange(bool online) {
    if (!online) {
      // No rung is in play while the transport is down; leaving the last one on screen would be the
      // one place the route label lied.
      _activeRoute = null;
      _setState(HostConnectionState.reconnecting);
      return;
    }
    unawaited(_announceOnline());
  }

  /// Handshake and subscribe, then report connected.
  ///
  /// The order matters and is the old client's: a screen that refetches on "connected" must not be
  /// able to fetch the task list before the subscription that carries the events that follow it.
  Future<void> _announceOnline() async {
    final done = _handshakeDone = Completer<void>();
    try {
      await _handshake();
    } catch (_) {
      // The transport is up even if the daemon did not answer: `call` reports a real failure to
      // whoever asked, and the next reconnect re-subscribes. Refusing to report the connection at
      // all would make a daemon that cannot serve `coder.hello` look like an unreachable machine.
    } finally {
      if (!done.isCompleted) done.complete();
      if (identical(_handshakeDone, done)) _handshakeDone = null;
    }
    if (!_disposed) _setState(HostConnectionState.connected);
  }

  Future<void> _handshake() async {
    await _client.call('coder.hello', {
      'client': {
        'name': 'envoydev-mobile',
        'platform': Platform.operatingSystem,
      },
    });
    // Subscribe before reporting connected so a refetch cannot land between list and events. The
    // daemon keeps one subscription per connection and replaces it on re-subscribe, so repeating
    // this after a reconnect is the intended way to get events back.
    await _client.call('coder.subscribe', {});
  }

  void _onActiveTransportChange(HomeRemoteCandidate? candidate) {
    if (candidate == null || _pinnedUrl != null) {
      _activeRoute = null;
    } else {
      _activeRoute =
          _tunneledCandidates.contains(candidate.name) ? 'ssh' : candidate.name;
    }
    // The screens read `activeRoute` when they rebuild, and the family's upgrade sweep can move the
    // connection to a better rung **without** the connection state changing. Re-publishing the
    // current state is what redraws the row with the new name instead of leaving the old one up
    // until something unrelated happens.
    _publishState();
  }

  void _setState(HostConnectionState next) {
    _state = next;
    _publishState();
  }

  void _publishState() {
    if (!_stateController.isClosed) _stateController.add(_state);
  }

  // -- RPC --

  /// One request, with a timeout so a wedged host cannot hang the UI forever.
  Future<Map<String, dynamic>> call(
    String method, [
    Map<String, dynamic> params = const {},
    Duration timeout = const Duration(seconds: 15),
  ]) async {
    final result = await _client.call(method, params, timeout);
    if (result is Map) return Map<String, dynamic>.from(result);
    // The family client returns the raw JSON value; the screens expect a map. Wrapping a scalar keeps
    // that promise without inventing a shape for it.
    return <String, dynamic>{'value': result};
  }

  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    _retry?.cancel();
    _eventUnsub();
    _client.dispose();
    await _sshTunnel.close();
    await _stateController.close();
    await _eventController.close();
  }
}
