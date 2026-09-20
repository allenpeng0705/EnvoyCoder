/// The credential that proves this phone is already paired to a daemon — and its two failure exits.
///
/// ## Why this is its own file
///
/// It used to live in `host_client.dart`, which crossed the family's ~800-line cap when the pairing
/// store landed (`AGENTS.md`: "past ~800, split it"). The seam is real rather than mechanical: the
/// client is about *reaching* a machine — candidates, transports, budgets, the walk's record — while
/// everything here is about *who the phone is to that machine*: which token to present, when the
/// grant may be written down, and when it must be retired.
///
/// ## The three rules this file exists to hold in one place
///
///   1. **A pairing is keyed by daemon identity.** [daemonKey] is derived from the connection the
///      phone holds and the owner the code claimed (see `pairing_store.dart` for why `instanceId` is
///      recorded but never the key). A display name is never part of it.
///   2. **The grant is offered before anything else.** [offered] is what a dial puts on the wire, so a
///      phone that still holds a grant presents it instead of being treated as a stranger — which is
///      the half of the owner's "many paired devices" bug that belongs to the phone.
///   3. **A refusal retires it, exactly once.** [retire] deletes the grant and answers whether *this*
///      call was the one that did it, so the client publishes a re-pair prompt once per refusal rather
///      than once per reconnect. Nothing here ever mints a pairing: pairing is the user's act, and it
///      is the code they already have that performs it.
///
/// The refusal itself is detected by [isCredentialRefusal], kept beside the code it matches because
/// the wire form is subtle enough to be worth one comment in one place.
library;

import 'package:envoy_thin_client/envoy_thin_client.dart';

import 'pairing_store.dart';

/// The code a daemon puts in a JSON-RPC error when it will not accept the credential it was offered.
///
/// The catalogue literal (`packages/protocol/src/domain.ts`), **not** the transport's `"UNAUTHORIZED"`
/// token. A token that fails to resolve at the socket is refused by the family's transport before any
/// product method runs, and that refusal arrives as `code: "UNAUTHORIZED"`; a refusal raised by a
/// product handler arrives as this code **inside the message** — the family's transport derives
/// `error.code` from a closed catalogue of its own tokens, so an `envoydev.*` code cannot ride there
/// (`packages/protocol/src/rpc.ts`, "Errors are code-prefixed messages"). Both mean the same thing to
/// a client, so both are recognised.
const String kUnauthorizedErrorCode = 'envoydev.unauthorized';

/// Whether [error] is the daemon refusing the credential it was handed, rather than a failure to
/// reach it at all.
///
/// The distinction is the whole reason a rejected pairing may be retired and a timeout may not: a
/// network fault says nothing about the token, and clearing a working pairing on one flaky dial would
/// force a re-pair for a machine that was merely asleep.
bool isCredentialRefusal(Object error) {
  final text = error.toString();
  if (text.contains(kUnauthorizedErrorCode)) return true;
  // The family client's typed refusal, and the sentence its own transport pairs with
  // `code: "UNAUTHORIZED"` (`EnvoyMesh/packages/host-connect/src/ws-server.ts`). The typed one covers
  // the case where the family client recognised the shape; the sentence covers the daemon's own
  // `envoydev.unauthorized` wording arriving at a transport that did not.
  if (error is UnauthorizedException) return true;
  return text.contains('Authentication required');
}

/// One daemon's credential, as this phone holds it.
class PairingCredential {
  PairingCredential({
    required this.endpoint,
    required this.owner,
    required String hostToken,
    required PairingStore store,
  })  : _hostToken = hostToken,
        _store = store;

  /// The address the daemon is reached at. With [owner], this is its identity.
  final String endpoint;

  /// The owner the pairing code claimed, or empty for an address typed by hand.
  final String owner;

  /// The token the host row carries — the credential for a pairing made outside this store (a typed
  /// address, an SSH hop, a pairing recorded before the store existed). It is a **fallback**, never a
  /// replacement for a grant this store holds.
  final String _hostToken;

  final PairingStore _store;

  /// This daemon's stable identity, as a storage key. See [daemonKeyFor].
  late final String daemonKey = daemonKeyFor(endpoint: endpoint, owner: owner);

  /// The token to put on the wire: the daemon-issued grant when this phone holds one, else the host
  /// row's own token.
  ///
  /// Read fresh on every dial rather than cached, because a refusal clears the grant mid-life of the
  /// client and the very next dial must notice.
  Future<String> offered() async => (await _store.tokenFor(daemonKey)) ?? _hostToken;

  /// The pairing this phone holds with the daemon, for a surface that reports it.
  Future<PairingRecord?> record() => _store.pairingFor(daemonKey);

  /// Write down the grant the daemon just accepted, with the identity it reported.
  ///
  /// Called only after an accepted hello: until the daemon has answered, "the token it issued" is
  /// only a claim this phone is making.
  Future<void> accept({String? instanceId, DateTime? at}) async {
    await _store.record(daemonKey, await offered(), instanceId: instanceId, at: at);
  }

  /// Retire the grant this daemon has refused.
  ///
  /// Answers true only for the first refusal since the last accepted pairing — the caller's cue to
  /// publish "pair again". The grant is deleted either way, so it can never be presented twice, and
  /// with nothing left to present the flow cannot loop.
  Future<bool> retire() async {
    if (await _store.pairingFor(daemonKey) == null) return false;
    await _store.clear(daemonKey);
    return true;
  }
}
