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

import 'install_id.dart';

import '../l10n/l10n.dart';
import '../models/host.dart';
import 'libp2p_transport.dart';
import 'net_diagnostics.dart';
import 'pairing_credential.dart';
import 'pairing_store.dart';
import 'route_plan.dart';
import 'route_walk.dart';
import 'ssh_tunnel.dart';

// The wire detail and the refusal rule stay in one place (`pairing_credential.dart`); the public
// names this library has always exported are re-exported here so the screens and tests that import
// `host_client.dart` keep compiling and cannot end up with a second copy of either.
export 'pairing_credential.dart' show kUnauthorizedErrorCode, isCredentialRefusal;

enum HostConnectionState { idle, connecting, connected, reconnecting, failed }

/// The one place a connection state becomes end-user language.
///
/// Shared by the Connections sheet, the project list's status dot and the network-status screen, so
/// the three cannot describe the same state three different ways. The reconnecting line carries the
/// consequence ("your tasks are still running") because it is the one state a user is most likely to
/// read as a failure.
extension HostConnectionStateText on HostConnectionState {
  String get label => switch (this) {
        HostConnectionState.connected => 'Connected',
        HostConnectionState.connecting => 'Connecting',
        HostConnectionState.reconnecting => 'Reconnecting — your tasks are still running',
        HostConnectionState.failed => 'Unreachable',
        HostConnectionState.idle => 'Not connected yet',
      };

  /// The same five states in the user's language.
  ///
  /// [label] stays because the diagnostics report (a developer artifact that is copied into a bug
  /// report, not read on screen) and the tests read it; every screen renders [labelFor].
  String labelFor(AppLocalizations l10n) => switch (this) {
        HostConnectionState.connected => l10n.connectionStateConnected,
        HostConnectionState.connecting => l10n.connectionStateConnecting,
        HostConnectionState.reconnecting => l10n.connectionStateReconnecting,
        HostConnectionState.failed => l10n.connectionStateFailed,
        HostConnectionState.idle => l10n.connectionStateIdle,
      };
}

/// Opens one candidate's WebSocket transport.
///
/// Returns the family's [WebSocketLike] rather than a `dart:io` [WebSocket] so a test can supply any
/// duplex, and so the same seam covers `ws://` and `wss://` without this client knowing the
/// difference.
typedef WsDialer = Future<WebSocketLike> Function(String url);

/// What a [HostClient] knows about its pairing, for a screen: the record, the daemon it is filed
/// under, and whether that daemon has refused it.
///
/// [lastSeenAt] is the phone's own record (see `pairing_store.dart`); [instanceId] is what the daemon
/// reported, which is the one fact that proves *which* daemon answered. Both are null when the phone
/// is paired but has not reached the daemon since the pairing was recorded.
typedef PairingState = ({PairingRecord? record, String daemonKey, bool refused});

class HostClient {
  HostClient(
    this.host, {
    this.dialer,
    this.sshTunnelOpener,
    this.libp2pDialer,
    PairingStore? pairingStore,
    this.budget = const DialBudget(),
    this.minDelay = const Duration(seconds: 1),
    this.maxDelay = const Duration(seconds: 20),
  }) : pairing = PairingCredential(
          endpoint: host.endpoint,
          owner: host.ownerId,
          hostToken: host.token,
          store: pairingStore ?? PairingStore(),
        ) {
    _client = HomeRemoteClient(
      HomeRemoteClientOptions(
        resolveCandidates: _resolveCandidates,
        createTransport: _createTransport,
        onHomeOnlineChange: _onHomeOnlineChange,
        onActiveTransportChange: _onActiveTransportChange,
        onCandidateTrying: _onCandidateTrying,
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

  /// This daemon's credential: which token to present, and what to do when the daemon refuses it.
  ///
  /// Built here rather than passed in so exactly one credential exists per client, and keyed by the
  /// daemon's identity at construction — the host record is mutable in tests (`host` is reassigned by
  /// a caller that re-pairs), and a key that moved under a live connection would address a different
  /// machine's credential. See `pairing_credential.dart` for the rules it holds.
  final PairingCredential pairing;

  /// Asked once per client, not once per dial. A walk is retried on every reconnect, and a refused
  /// token must not send the user a re-pair prompt once a backoff.
  bool _pairingRefused = false;

  late final HomeRemoteClient _client;
  late final void Function() _eventUnsub;
  late final Libp2pTransport _defaultLibp2pDialer = Libp2pTransport();
  final SshTunnel _sshTunnel = SshTunnel();

  final _stateController = StreamController<HostConnectionState>.broadcast();
  final _eventController = StreamController<Map<String, dynamic>>.broadcast();

  Timer? _retry;
  Completer<void>? _handshakeDone;
  bool _disposed = false;
  int _attempt = 0;

  /// Set by [connect]: dial exactly this URL and do not walk the ladder.
  String? _pinnedUrl;

  /// Candidate names this client reached through the SSH forward, so the route can be named `ssh`
  /// rather than the family's name for the address that was tunnelled.
  final Set<String> _tunneledCandidates = <String>{};

  String? _activeRoute;
  HostConnectionState _state = HostConnectionState.idle;

  // -- What the network-status surface reads ----------------------------------
  //
  // The walk's own record, kept on the client rather than in the screen: the state a screen wants to
  // explain (`reconnecting` with no projects) outlives any one frame, and a screen that rebuilt the
  // ladder from a fresh resolve would be describing a walk the client never walked. The record itself
  // — the ladder, the per-rung timings, the dial budget — lives in `route_walk.dart`; what stays here
  // is the RPC and mesh snapshot, which belong to the link rather than to one walk.

  late final RouteWalkRecord _walk = RouteWalkRecord(budget);

  /// Why the most recent walk reached no rung, and when it ran. Kept here rather than in the walk
  /// record because they outlive one walk: the surface reads them while the next walk is dialling.
  String? _lastWalkError;
  DateTime? _lastWalkAt;

  RpcOutcome? _lastRpc;
  HomeMeshSnapshot? _homeMesh;
  String? _homeMeshError;
  DateTime? _homeMeshAt;

  Stream<HostConnectionState> get states => _stateController.stream;
  HostConnectionState get state => _state;

  /// Daemon-pushed events as `{event, data}` maps, whatever the event is called.
  Stream<Map<String, dynamic>> get events => _eventController.stream;

  /// Whether this daemon has refused the pairing this phone holds.
  ///
  /// True from the moment a stored token is refused until the daemon accepts one again. It is the
  /// honest half of "try the stored token first": a client that cleared the token and then kept
  /// dialling would be a re-pair loop wearing a retry's clothes. The connection surface reads it to
  /// offer the one action that fixes the state — pairing again with the code the desktop shows.
  bool get pairingRefused => _pairingRefused;

  /// The pairing this phone holds for the daemon behind this client, for the Settings surface.
  ///
  /// Reads the store rather than a cached field so a screen opened before the first hello still shows
  /// the pairing that was recorded on a previous launch. A null record means "this phone holds no
  /// token this daemon issued" — a sentence the screen words, not an error.
  Future<PairingState> pairingState() async => (
        record: await pairing.record(),
        daemonKey: pairing.daemonKey,
        refused: _pairingRefused,
      );

  /// The rung in use, for the screens.
  ///
  /// Null until a dial wins, null again when the connection drops (no rung is in play), and null for
  /// a [connect]-pinned URL, which was never a rung of the ladder — naming one there would be a
  /// guess dressed as information.
  String? get activeRoute => _activeRoute;

  /// The most recent walk's ladder, in the family's priority order. See [NetDiagnostics.ladder].
  List<RouteAttempt> get routeLadder => _walk.ladder;

  /// How many rungs one pass may dial before the tail waits for the next pass.
  int get ladderPlanLimit => _walk.planLimit;

  /// Why the most recent walk reached no rung, or null when it reached one.
  String? get lastWalkError => _lastWalkError;
  DateTime? get lastWalkAt => _lastWalkAt;

  /// The last JSON-RPC sent to the daemon (or the last `coder.meshStatus` probe), and how it ended.
  RpcOutcome? get lastRpc => _lastRpc;

  HomeMeshSnapshot? get homeMesh => _homeMesh;
  String? get homeMeshError => _homeMeshError;
  DateTime? get homeMeshAt => _homeMeshAt;

  /// One immutable snapshot of everything this client can say about its link.
  ///
  /// Built through the public getters rather than off the private fields so a subclass that answers
  /// them differently — a test stub, and nothing in the app — is reported as it answers. The node
  /// half comes from [libp2pNodeDiagnostics], a read-only peek at the process-wide host: no single
  /// client owns it, and asking it never starts one. [node] overrides that peek for a test, which
  /// cannot build the process-wide host; production never passes it.
  NetDiagnostics diagnostics({NodeDiagnostics? node}) => NetDiagnostics(
        host: host,
        stateLabel: state.label,
        activeRoute: activeRoute,
        ladder: routeLadder,
        planLimit: ladderPlanLimit,
        lastWalkError: lastWalkError,
        lastWalkAt: lastWalkAt,
        lastRpc: lastRpc,
        node: node ?? libp2pNodeDiagnostics(),
        homeMesh: homeMesh,
        homeMeshError: homeMeshError,
        homeMeshAt: homeMeshAt,
        reportedAt: DateTime.now(),
      );

  /// Ask the desktop what *it* thinks the mesh is, and record the answer.
  ///
  /// `coder.meshStatus` is the daemon's own answer (`apps/desktop/src/daemon/service.ts:820`) and the
  /// one RPC that is about the mesh rather than about work: a phone that cannot list projects can
  /// still learn whether the desktop's own peer is up, how many addresses it advertises and whether
  /// it holds relay hints. That is the difference between "the phone cannot reach it" and "the
  /// desktop has nothing to reach".
  ///
  /// Bounded twice on purpose. The family client's own timer covers the RPC once a transport is up;
  /// the outer [timeout] covers the *walk* `ensureConnected` runs first, which is bounded per
  /// candidate but not in total. A "Check again" button that can spin for a minute is not a check.
  Future<void> probeHomeMesh({Duration timeout = const Duration(seconds: 25)}) async {
    if (_disposed) return;
    final started = DateTime.now();
    try {
      final answer = await _callRaw('coder.meshStatus', const {}, timeout).timeout(timeout);
      _lastRpc = RpcOutcome(
        method: 'coder.meshStatus',
        ok: true,
        elapsedMs: DateTime.now().difference(started).inMilliseconds,
      );
      _homeMesh = HomeMeshSnapshot.fromRpc(answer['mesh']);
      // A 200 with an unreadable body is a real answer of the wrong shape, not a failure to ask.
      _homeMeshError = _homeMesh == null ? 'the daemon answered without a usable mesh field' : null;
    } on TimeoutException {
      _failHomeMesh('no answer within ${timeout.inSeconds} s', started);
    } catch (error) {
      _failHomeMesh(_redactError(error), started);
    }
    _homeMeshAt = DateTime.now();
    // Republish so a screen listening to `states` redraws on a fresh answer: the connection state
    // itself may not have changed, and `_publishState` is the client's existing way to say "read me
    // again" (the same trick `_onActiveTransportChange` uses for a route upgrade).
    _publishState();
  }

  void _failHomeMesh(String reason, DateTime started) {
    _lastRpc = RpcOutcome(
      method: 'coder.meshStatus',
      ok: false,
      elapsedMs: DateTime.now().difference(started).inMilliseconds,
      error: reason,
    );
    _homeMesh = null;
    _homeMeshError = reason;
  }

  /// Walk the family's candidates until one of them reaches the daemon.
  Future<void> connectBest() async {
    if (_disposed) return;
    _pinnedUrl = null;
    final now = DateTime.now();
    if (_walk.isDeferredAt(now)) {
      // The walk is **held**, not attempted and failed: the last few candidate dials failed inside
      // the pressure window, and the budget's whole point is that a bad network stops the radio for
      // a moment instead of spraying dials at every rung in turn. The caller is waiting for exactly
      // what the meter is waiting for, so the wait is scheduled rather than spun on.
      _setState(HostConnectionState.reconnecting);
      _scheduleRetry(_walk.deferralRemainingAt(now));
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
    _walk.begin();
    _setState(_attempt == 0 ? HostConnectionState.connecting : HostConnectionState.reconnecting);
    try {
      await _client.ensureConnected();
      // The transport is up; wait for the handshake `_announceOnline` started so the returned future
      // means what the old client's did — connected, with events live.
      await _handshakeDone?.future;
      _walk.recordSuccess();
      _attempt = 0;
      // The most recent walk reached the daemon, so there is no last walk *failure* to report.
      _lastWalkError = null;
      _lastWalkAt = null;
    } catch (error) {
      // The family's walk error is the one place all of its candidate failures are summarised
      // (`homeRemote.connectFailed — tried: […] — last error: …`). It used to be dropped here with a
      // bare `catch (_)`, which is why a phone stuck on "connecting" had nothing to show.
      _lastWalkError = _redactError(error);
      _lastWalkAt = DateTime.now();
      _walk.closeOpenAttempts();
      _walk.recordWalkFailure();
      _attempt += 1;
      _setState(HostConnectionState.reconnecting);
      _scheduleRetry(_backoffDelay());
    }
  }

  // -- The walk's record -------------------------------------------------------
  //
  // Everything below records what happens to each rung, for the network-status surface. It is
  // deliberately write-only from the walk's point of view: the walk's behaviour is unchanged by it,
  // and a rung's outcome is never a reason to take a different route. The record itself is
  // `route_walk.dart`; these are the two seams the client owns — the callback the family calls, and
  // the redaction rule for its error text.

  /// Every candidate the client is about to try is a dial this walk attempted.
  void _onCandidateTrying(HomeRemoteCandidate candidate) => _walk.trying(candidate);

  /// Exception text with every secret query value replaced.
  ///
  /// The walk's own failure text is built from candidate URLs
  /// (`…connectFailed — tried: [lan=ws://192.168.3.85:4770/ws?token=…]`), so an unredacted error
  /// string is a credential sitting in a bug report. `redactSecretQueryValues` is the family's
  /// implementation, shared with its own transport layer.
  String _redactError(Object error) => redactSecretQueryValues(error.toString());

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
    // The credential is resolved once per pass, **before** any candidate exists, and it is the token
    // this daemon issued when the phone holds one. That is the whole fix in one line: a phone that
    // still holds a grant presents the grant, so the daemon sees the same client it already recorded
    // instead of a stranger minting another pairing. The host's own token is the fallback for the
    // hosts that were never paired this way (a typed address, an SSH hop, a grant recorded before
    // this store existed) — never a replacement for one.
    final token = await pairing.offered();
    final pinned = _pinnedUrl;
    if (pinned != null) {
      // A pinned URL is not a walk: no budget, no deferral, one dial. The budget meters a ladder,
      // and there is no ladder here to meter.
      return <HomeRemoteCandidate>[
        HomeRemoteCandidate(name: 'direct', url: pinned, sessionToken: token),
      ];
    }
    // The record owns the plan: which rungs this pass may dial, and the ladder the panel shows. A
    // **held** walk plans nothing and leaves the ladder as it was — see `route_walk.dart`.
    return _walk.plan(candidatesFor(host, token: token));
  }

  /// The transport factory the walk calls, wrapped so a rung that never opens is recorded.
  ///
  /// The wrapping is why the ladder can name a *reason*: `HomeRemoteClient` reports candidate
  /// success and failure only in aggregate (its `connectFailed` message), and the per-candidate
  /// error object is dropped inside its own loop. This app supplies the transport, so this is the
  /// seam where the error still exists.
  Future<WebSocketLike> _createTransport(HomeRemoteCandidate candidate) async {
    try {
      final transport = await _createTransportFor(candidate);
      // Opened, but not yet the active rung: the home still has to answer `connected`, and whether
      // it does is the family's decision, not this factory's.
      _walk.mark(candidate, status: RouteAttemptStatus.opened);
      return transport;
    } catch (error) {
      _walk.mark(
        candidate,
        status: RouteAttemptStatus.failed,
        error: _redactError(error),
      );
      rethrow;
    }
  }

  Future<WebSocketLike> _createTransportFor(HomeRemoteCandidate candidate) async {
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
        // The transport closes its own socket when this fires. The family client's per-candidate
        // `.timeout` already ends the *walk*, but it cannot reach the channel, so without this the
        // socket the walk abandoned stays open — and one of the relay's capped slots with it.
        handshakeTimeout: budget.perCandidateTimeout,
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
    // Recorded like any other request, and for a diagnostic reason: a daemon that cannot answer
    // `coder.hello` still leaves the transport up, and `_announceOnline` deliberately reports
    // `connected` anyway. Without this, the one contradiction that explains "Connected, but nothing
    // loads" — a live transport and a refused handshake — is invisible on the device. The 30 s
    // budget is the family client's own default, kept so this stays a recording change and not a
    // new timeout.
    final Map<String, dynamic> hello;
    try {
      hello = await _recorded(
        'coder.hello',
        {
          'client': {
            'name': 'envoydev-mobile',
            'platform': Platform.operatingSystem,
            // **Who this phone is, stably.** Without it the daemon cannot tell a re-pairing from a new
            // device, so every pairing left another paired-device row — each a live token, all labelled
            // "Phone".
            'id': await installId(),
          },
        },
        const Duration(seconds: 30),
      );
    } catch (error) {
      // A refusal is not a connection failure: the daemon answered, and what it refused is the
      // credential this phone is holding. That is the one case where the stored pairing must go, and
      // the case the old client could not tell apart from a timeout.
      if (isCredentialRefusal(error)) await _onPairingRefused();
      rethrow;
    }
    // The daemon accepted the token, so this is the pairing — and a pairing that has been refused is
    // live again, because the user paired this phone to this daemon afresh.
    _pairingRefused = false;
    // `instanceId` is what proves which daemon answered. It is *recorded*, never used as the storage
    // key: the daemon mints a new one on every start, and keying on it would make every desktop
    // reboot look like a different machine.
    final instanceId = hello['instanceId'];
    await pairing.accept(
      instanceId: instanceId is String && instanceId.isNotEmpty ? instanceId : null,
      at: DateTime.now(),
    );
    // Subscribe before reporting connected so a refetch cannot land between list and events. The
    // daemon keeps one subscription per connection and replaces it on re-subscribe, so repeating
    // this after a reconnect is the intended way to get events back.
    await _recorded('coder.subscribe', const {}, const Duration(seconds: 30));
  }

  /// Retire the pairing this daemon has refused, and say so **once**.
  ///
  /// The single-shot guard is the difference between a fallback and a loop. The walk retries on a
  /// backoff, so without it a revoked token would clear-and-retry forever, and every retry is another
  /// refusal the user never sees. Once retired, the phone holds no token for this daemon: the next
  /// dial offers whatever the host row holds (usually the same dead credential, refused again) and
  /// the connection surface offers the one action that fixes it — pairing again. Nothing here mints a
  /// pairing: pairing is the user's act, performed with the code the desktop shows.
  Future<void> _onPairingRefused() async {
    if (_pairingRefused) return;
    _pairingRefused = true;
    // The store is the truth and it is cleared either way; the return value says whether *this* call
    // was the one that retired something, which is what decides if the surface needs to be told.
    await pairing.retire();
    _publishState();
  }

  void _onActiveTransportChange(HomeRemoteCandidate? candidate) {
    if (candidate == null || _pinnedUrl != null) {
      _activeRoute = null;
    } else {
      // A rung won, so every rung the walk had left mid-dial never became the connection. Closing
      // them here — not only when the walk fails — is what stops a successful walk from showing an
      // earlier candidate as "still being dialled" forever.
      _walk.closeOpenAttempts();
      _walk.mark(
        candidate,
        status: RouteAttemptStatus.connected,
        clearError: true,
      );
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
  ///
  /// Every call is recorded as the link's last RPC. That record is the whole answer to "the phone
  /// says connecting and shows no projects": a failed `coder.listProjects` and a `coder.subscribe`
  /// that never came back are different bugs, and neither is visible from the screen that renders
  /// neither.
  Future<Map<String, dynamic>> call(
    String method, [
    Map<String, dynamic> params = const {},
    Duration timeout = const Duration(seconds: 15),
  ]) =>
      _recorded(method, params, timeout);

  /// Send [method] and record it as the link's last RPC.
  ///
  /// One funnel for everything this app puts on the wire — the screens' calls and the handshake
  /// alike — so "last request" means the last request, not "the last one somebody remembered to
  /// instrument".
  Future<Map<String, dynamic>> _recorded(
    String method,
    Map<String, dynamic> params,
    Duration timeout,
  ) async {
    final started = DateTime.now();
    try {
      final result = await _callRaw(method, params, timeout);
      _lastRpc = RpcOutcome(
        method: method,
        ok: true,
        elapsedMs: DateTime.now().difference(started).inMilliseconds,
      );
      return result;
    } catch (error) {
      _lastRpc = RpcOutcome(
        method: method,
        ok: false,
        elapsedMs: DateTime.now().difference(started).inMilliseconds,
        error: _redactError(error),
      );
      rethrow;
    }
  }

  /// The RPC without the record, for [probeHomeMesh], which times the whole ask (walk included) and
  /// would otherwise be recorded twice for one button press.
  Future<Map<String, dynamic>> _callRaw(
    String method,
    Map<String, dynamic> params,
    Duration timeout,
  ) async {
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
    // The two controllers are closed **without waiting** for it to take effect.
    //
    // A broadcast `StreamController.close()` does not complete until every listener has cancelled its
    // subscription, so awaiting these made `dispose` hang whenever a screen was still listening —
    // and a caller that awaits dispose (forget a host from the Connections sheet, switch host while
    // the project list is up) then hung with it: the store changed and the UI never rebuilt.
    //
    // Nothing is lost by not waiting. Subscriptions are cancelled by the caller's own dispose in the
    // normal path, a late event on a closed controller is dropped, and the transports and timers are
    // already released above — the streams are the last thing, and they are only bookkeeping.
    unawaited(_stateController.close());
    unawaited(_eventController.close());
  }
}
