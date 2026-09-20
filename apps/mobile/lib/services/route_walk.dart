/// The walk's own record: which rungs were produced, what happened to each, and how hard the dial
/// budget has been pressed.
///
/// ## Why this is a file
///
/// It was the middle third of `host_client.dart`, which is over the family's hard cap (~800 lines,
/// `AGENTS.md`). The seam is real: the client is about *reaching* a machine — dialling, handshaking,
/// events — while this is the **write-only record** the network-status surface reads. Nothing here
/// changes what the client dials; it exists so a failed walk can be explained after the fact.
///
/// ## The one rule this module keeps
///
/// A rung's outcome is recorded as **what was observed**, never as a cause this app did not see: a
/// transport that opened and never saw the home's `connected` says exactly that, and a rung the budget
/// left out is `skipped` rather than `failed`, because a cap is not a network fault. The surface's
/// whole value is that its labels can be trusted.
library;

import 'package:envoy_thin_client/envoy_thin_client.dart';

import 'net_diagnostics.dart';

/// One walk's ladder, its per-rung timings, and the meter that decides which rungs get dialled.
class RouteWalkRecord {
  RouteWalkRecord(this.budget) : _meter = DialBudgetMeter(budget);

  /// How many rungs one pass may dial and how long a rung gets (`DialBudget`).
  final DialBudget budget;

  final DialBudgetMeter _meter;

  /// The ladder of the most recent walk, in the family's order, with what happened to each rung.
  final List<RouteAttempt> _ladder = <RouteAttempt>[];

  /// The rung the walk was dialling, so a failure can be timed. Keyed by [keyFor].
  final Map<String, DateTime> _attemptStartedAt = <String, DateTime>{};

  /// How many rungs one pass may dial (`DialBudget.maxAttemptsPerWalk`).
  int _planLimit = 0;

  /// How many candidates the walk in progress has tried, so a failed walk can be metered by *dials*
  /// rather than by walks.
  int _attemptsInWalk = 0;

  /// The most recent walk's ladder, in the family's priority order. See [NetDiagnostics.ladder].
  List<RouteAttempt> get ladder => List.unmodifiable(_ladder);

  /// How many rungs one pass may dial before the tail waits for the next pass.
  int get planLimit => _planLimit;

  static String keyFor(HomeRemoteCandidate candidate) =>
      '${candidate.name}|${candidate.url}';

  /// Whether the budget is holding the walk back at [now], and for how much longer.
  bool isDeferredAt(DateTime now) => _meter.isDeferredAt(now);
  Duration deferralRemainingAt(DateTime now) => _meter.deferralRemainingAt(now);

  /// Note that a dial won, which clears the budget's pressure.
  void recordSuccess() => _meter.recordSuccess();

  /// A new walk: clear the record rather than appending.
  ///
  /// The surface's job is to explain the connection as it is now, and a stale failure shown beside a
  /// fresh attempt reads as a failure of that attempt.
  void begin() {
    _attemptsInWalk = 0;
    _ladder.clear();
    _attemptStartedAt.clear();
  }

  /// Choose the rungs this pass may dial, and rebuild the ladder around them.
  ///
  /// Returns the planned candidates in the family's order. A **held** walk returns nothing and leaves
  /// the ladder as it was: that is not a cap, and it is what lets the panel say "held back under dial
  /// pressure" instead of labelling every rung "not tried — past this walk's limit", which would
  /// blame a budget for a decision the budget makes elsewhere.
  List<HomeRemoteCandidate> plan(List<HomeRemoteCandidate> produced) {
    final planned = _meter.plan(produced);
    _planLimit = budget.maxAttemptsPerWalk;
    if (planned.isNotEmpty) _syncLadder(produced, planned);
    return planned;
  }

  /// Every candidate the client is about to try is a dial this walk attempted, and one rung of the
  /// record the network-status surface shows.
  void trying(HomeRemoteCandidate candidate) {
    _attemptsInWalk += 1;
    _attemptStartedAt[keyFor(candidate)] = DateTime.now();
    mark(candidate, status: RouteAttemptStatus.trying);
  }

  /// Record what happened to one rung.
  void mark(
    HomeRemoteCandidate candidate, {
    required RouteAttemptStatus status,
    String? error,
    int? elapsedMs,
    bool clearError = false,
  }) {
    final redacted = redactSecretQueryValues(candidate.url);
    for (var i = 0; i < _ladder.length; i++) {
      if (_ladder[i].name != candidate.name || _ladder[i].redactedUrl != redacted) continue;
      _ladder[i] = _ladder[i].copyWith(
        status: status,
        error: error,
        clearError: clearError,
        elapsedMs: elapsedMs ?? _elapsedFor(candidate),
      );
      return;
    }
  }

  int? _elapsedFor(HomeRemoteCandidate candidate) {
    final started = _attemptStartedAt[keyFor(candidate)];
    return started == null ? null : DateTime.now().difference(started).inMilliseconds;
  }

  /// Any rung that was being dialled or had opened a transport but never became the active one.
  ///
  /// Called when the walk ends and whenever a rung wins, so the record cannot be left saying "still
  /// being dialled" about a rung the walk has already moved past. The reason is stated as what was
  /// observed — no `connected` arrived — and never as a cause this app did not see.
  void closeOpenAttempts() {
    for (var i = 0; i < _ladder.length; i++) {
      final attempt = _ladder[i];
      if (attempt.status != RouteAttemptStatus.trying &&
          attempt.status != RouteAttemptStatus.opened) {
        continue;
      }
      _ladder[i] = attempt.copyWith(
        status: RouteAttemptStatus.failed,
        error: attempt.error ??
            (attempt.status == RouteAttemptStatus.opened
                ? 'a transport opened, but the home never reported connected'
                : 'the dial did not finish before the walk moved on'),
      );
    }
  }

  /// Every candidate the failed walk attempted, as a failure of its own.
  ///
  /// The budget counts *dials*, and a walk that burned four candidates burned four. Recording one
  /// per walk would let a store with a long tail of dead addresses look like a healthy network.
  void recordWalkFailure() {
    final attempted = _attemptsInWalk;
    _attemptsInWalk = 0;
    for (var i = 0; i < attempted; i++) {
      _meter.recordFailure();
    }
  }

  /// Rebuild the produced ladder without discarding what this walk already learned.
  ///
  /// Preserving by candidate rather than starting over is not an optimisation: the family's upgrade
  /// sweep calls `resolveCandidates` again mid-connection, and a rebuild that dropped the record
  /// would erase the reasons the connection is on a fallback rung the moment it found one.
  ///
  /// Rungs the budget left out are [RouteAttemptStatus.skipped], which is the honest label: they
  /// were produced and not dialled, and showing them as "failed" would blame a network for a cap.
  void _syncLadder(
    List<HomeRemoteCandidate> produced,
    List<HomeRemoteCandidate> planned,
  ) {
    final plannedKeys = <String>{for (final c in planned) keyFor(c)};
    final previous = <String, RouteAttempt>{
      for (final attempt in _ladder)
        '${attempt.name}|${attempt.redactedUrl}': attempt,
    };
    final next = <RouteAttempt>[];
    for (final candidate in produced) {
      final redacted = redactSecretQueryValues(candidate.url);
      final prior = previous['${candidate.name}|$redacted'];
      next.add(prior ??
          RouteAttempt(
            name: candidate.name,
            redactedUrl: redacted,
            status: plannedKeys.contains(keyFor(candidate))
                ? RouteAttemptStatus.planned
                : RouteAttemptStatus.skipped,
          ));
    }
    _ladder
      ..clear()
      ..addAll(next);
  }
}
