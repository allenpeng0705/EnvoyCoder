/// Turning a stream of run events into a transcript.
///
/// ## Why the phone has a model and not just a list of lines
///
/// The first version of `run_screen.dart` appended one `Text` per event. That is the bug this file
/// exists to fix, and it has two halves:
///
///   * **the daemon streams fragments.** `run.output` arrives as many small pieces, so one answer
///     became a column of one-word rows — the failure the desktop's `buildTranscript` was written to
///     prevent, and the reason that projection exists at all;
///   * **a reconnect re-delivers.** `coder.tailRun` answers with everything since `sinceSeq`, and the
///     live subscription can hand over the same event again. Appending blindly duplicates lines.
///
/// The desktop answered both in one pure projection (`apps/desktop/src/state/transcript.ts`), and
/// this is its twin: the same four folding rules, applied incrementally because a phone cannot afford
/// to re-fold the whole tail on every frame.
///
/// ## The rules, and what each one is for
///
///   1. **Chunks join by `messageId`.** Consecutive fragments of one message become one row. There is
///      no "append to the last row if it happens to match" heuristic: the id is the identity, and an
///      agent that omits it gets a bucket that survives until a row of another kind interrupts it.
///   2. **A repeated `seq` is dropped.** The daemon numbers events monotonically per run, so anything
///      at or below the high-water mark has been seen — that is what makes a reconnect idempotent.
///   3. **A tool call is one row built from two events**, keyed by the agent's `callId`, so a
///      `tool_call` and its later `tool_call_update` do not render as a start and an orphan.
///   4. **A gap is reported, not hidden.** A missing `seq` means a frame was lost; rendering a
///      transcript that silently skips the sentence explaining a change is worse than saying so.
library;

/// One row of a transcript. `kind` is a string rather than an enum so a new server-side kind does not
/// crash an older app: an unrecognised event is dropped, and never renders as a blank row.
class TranscriptEntry {
  TranscriptEntry({
    required this.kind,
    required this.id,
    this.text = '',
    this.tone = 'quiet',
    this.callId,
    this.status,
    this.delivered,
    this.toolInput,
    this.toolOutput,
    this.approval,
    this.noteKind,
    this.noteCount,
    this.notePercent,
    this.noteStatus,
  });

  /// `user` | `assistant` | `thought` | `tool` | `approval` | `note`.
  final String kind;

  /// Identity within the transcript: a message id, a call id, a request id, or `kind:seq`.
  final String id;

  String text;

  /// For notes only: `quiet` | `warn` | `error`.
  String tone;

  /// For a note the **app** generated rather than one the daemon sent — `diff`, `usage` or `ended`.
  ///
  /// This model has no `BuildContext` and must not grow one, so a generated note travels as its
  /// kind plus its numbers and `transcript_row.dart` words it. That is also what makes the note
  /// translate when the phone's language changes mid-run.
  final String? noteKind;
  final int? noteCount;
  final int? notePercent;
  final String? noteStatus;

  final String? callId;
  String? status;

  /// For a user message: whether it waited for the turn or joined it.
  final String? delivered;

  /// Tool call payload, when the daemon included it (desktop shows these in a `<pre>`).
  String? toolInput;
  String? toolOutput;

  TranscriptApproval? approval;
}

/// An approval the agent is blocked on, as the transcript holds it.
class TranscriptApproval {
  TranscriptApproval({
    required this.requestId,
    required this.question,
    this.detail,
    required this.options,
    this.selection,
  });

  final String requestId;
  final String question;
  final String? detail;
  final List<TranscriptOption> options;

  /// `many` is checkboxes, `text` is a typed answer. Absent is one exclusive choice.
  final String? selection;

  /// The option the user chose, once they have. Null while the question is still open.
  String? resolvedWith;

  /// Every id chosen, when the card asked for more than one.
  List<String>? resolvedWithIds;

  /// True when the question went away without an answer — the run ended, or was cancelled, while the
  /// card was on screen. Distinct from `resolvedWith`, because "Stopped" and "you allowed it" are
  /// different sentences and a card that confused them would claim a decision nobody made.
  bool closed = false;

  /// True while the run is genuinely waiting on this answer.
  bool get isOpen => !closed && resolvedWith == null;
}

class TranscriptOption {
  const TranscriptOption({required this.id, required this.label, required this.destructive});

  final String id;
  final String label;
  final bool destructive;
}

/// The transcript, built as events arrive.
class Transcript {
  final List<TranscriptEntry> entries = [];

  /// The highest `seq` applied. Also the watermark that makes a re-delivered event a no-op.
  int lastSeq = 0;

  /// Start folding a different run without dropping the rows already on screen.
  ///
  /// Sequence numbers start over at 1 for each run. Leaving the watermark where the previous run
  /// finished would throw away the new run's first events.
  void beginRun() {
    lastSeq = 0;
    _byMessage.clear();
    _byCall.clear();
    _byRequest.clear();
    _breakAnonymous();
  }

  /// True once a sequence number has been seen to be missing.
  bool hasGap = false;

  /// Index by identity, so a later event can update a row that is already on screen.
  final Map<String, int> _byMessage = {};
  final Map<String, int> _byCall = {};
  final Map<String, int> _byRequest = {};

  /// The bucket for fragments that carry no `messageId`, cleared by any other row.
  String _anonymousKey = '';
  int _anonymousCount = 0;

  /// The approval the run is waiting on, if any. Derived from the rows, so the composer and the card
  /// cannot disagree about whether a question is open.
  TranscriptApproval? get pendingApproval {
    for (final entry in entries.reversed) {
      final approval = entry.approval;
      if (approval != null && approval.isOpen) return approval;
    }
    return null;
  }

  /// Apply one event. Safe to call twice with the same event.
  void apply(Map<String, dynamic> event) {
    final seq = (event['seq'] as num?)?.toInt();
    // Rule 2. Anything at or below the watermark has already been folded, and folding it twice is how
    // a reconnect makes the agent look like it repeated itself.
    if (seq != null) {
      if (seq <= lastSeq) return;
      // A run attached mid-flight starts at whatever number the daemon is on; that is not a gap.
      if (lastSeq != 0 && seq > lastSeq + 1) hasGap = true;
      lastSeq = seq;
    }

    switch (event['kind'] as String? ?? '') {
      case 'run.message':
        _breakAnonymous();
        entries.add(
          TranscriptEntry(
            kind: 'user',
            id: 'u${seq ?? entries.length}',
            text: (event['text'] as String?) ?? '',
            delivered: event['delivered'] as String?,
          ),
        );
        return;

      case 'run.output':
        _appendChunk(
          event,
          kind: 'assistant',
          // The id is namespaced per kind: one message id could in principle be reused for reasoning
          // and for the answer, and joining them would splice the thinking into the reply.
          key: event['messageId'] as String?,
        );
        return;

      case 'run.thought':
        final messageId = event['messageId'] as String?;
        _appendChunk(
          event,
          kind: 'thought',
          key: messageId == null ? null : 'thought-$messageId',
        );
        return;

      case 'run.tool':
        _breakAnonymous();
        _applyTool(event, seq);
        return;

      case 'run.approval-requested':
        _breakAnonymous();
        _applyApprovalRequested(event, seq);
        return;

      case 'run.approval-resolved':
        final requestId = event['requestId'] as String? ?? '';
        final at = _byRequest[requestId];
        if (at != null) {
          final approval = entries[at].approval;
          approval?.resolvedWith = event['optionId'] as String?;
          final ids = event['optionIds'];
          if (ids is List) {
            approval?.resolvedWithIds = [for (final id in ids) if (id is String) id];
          }
        }
        return;

      case 'run.status':
        _breakAnonymous();
        // A status that is no longer "waiting on a human" closes whatever card was open — including
        // the case where the run was cancelled while the question was on screen.
        if (event['status'] != 'needs-attention') _closeOpenApprovals();
        final note = event['note'] as String?;
        if (note != null && note.isNotEmpty) {
          entries.add(TranscriptEntry(kind: 'note', id: 's${seq ?? entries.length}', text: note));
        }
        return;

      case 'run.ended':
        _breakAnonymous();
        _closeOpenApprovals();
        entries.add(
          TranscriptEntry(
            kind: 'note',
            id: 'e${seq ?? entries.length}',
            // The sentence is chosen at render time from the status, so it speaks the user's
            // language and no English lives in the model.
            noteKind: 'ended',
            noteStatus: event['status'] as String?,
            tone: event['status'] == 'failed'
                ? 'error'
                : event['status'] == 'cancelled'
                    ? 'warn'
                    : 'quiet',
          ),
        );
        return;

      case 'run.diff':
        _breakAnonymous();
        final files = event['files'];
        final count = files is List ? files.length : 0;
        entries.add(
          TranscriptEntry(
            kind: 'note',
            id: 'd${seq ?? entries.length}',
            // A headline about files, not a list of paths: "3 files changed" is what a user reads.
            // The sentence is built at render time from `noteKind` so it is pluralised and
            // translated by that language's rules.
            noteKind: 'diff',
            noteCount: count,
          ),
        );
        return;

      case 'run.usage':
        _breakAnonymous();
        final used = (event['contextUsed'] as num?)?.toInt();
        final size = (event['contextSize'] as num?)?.toInt();
        if (used != null && size != null && size > 0) {
          final percent = ((used / size) * 100).round();
          entries.add(
            TranscriptEntry(
              kind: 'note',
              id: 'h${seq ?? entries.length}',
              noteKind: 'usage',
              notePercent: percent,
              tone: percent >= 90 ? 'warn' : 'quiet',
            ),
          );
        }
        return;

      // `run.started` and `run.session` are facts about the run, not lines in it: the header shows
      // them, and a transcript that opened with "the run started" would be narrating the furniture.
      default:
        return;
    }
  }

  /// Rule 1: join a fragment into its message's row, or start one.
  void _appendChunk(Map<String, dynamic> event, {required String kind, required String? key}) {
    final text = (event['text'] as String?) ?? '';
    if (text.isEmpty) return;
    final identity = key ?? _nextAnonymousKey();
    final at = _byMessage[identity];
    if (at != null && entries[at].kind == kind) {
      entries[at].text += text;
      return;
    }
    _byMessage[identity] = entries.length;
    entries.add(TranscriptEntry(kind: kind, id: identity, text: text));
  }

  void _applyTool(Map<String, dynamic> event, int? seq) {
    final callId = (event['callId'] as String?) ?? '';
    final name = (event['name'] as String?) ?? '';
    final status = (event['status'] as String?) ?? '';
    final input = _summarizePayload(event['input']);
    final output = _summarizePayload(event['output']);
    final at = _byCall[callId];
    if (at != null) {
      // Rule 3: the result event carries no title, so an empty name must not erase the one the start
      // already gave us — that is how a finished row loses its label.
      if (name.isNotEmpty) entries[at].text = name;
      entries[at].status = status;
      if (input != null) entries[at].toolInput = input;
      if (output != null) entries[at].toolOutput = output;
      return;
    }
    _byCall[callId] = entries.length;
    entries.add(
      TranscriptEntry(
        kind: 'tool',
        id: callId.isEmpty ? 't${seq ?? entries.length}' : callId,
        // Empty when the agent named no tool; the row renders its own fallback word rather than
        // storing English here.
        text: name,
        callId: callId,
        status: status,
        toolInput: input,
        toolOutput: output,
      ),
    );
  }

  /// A few readable lines for the phone — same idea as desktop's 400-char `summarize`.
  static String? _summarizePayload(Object? value) {
    if (value == null) return null;
    final raw = value is String ? value : value.toString();
    final trimmed = raw.trim();
    if (trimmed.isEmpty) return null;
    return trimmed.length > 400 ? '${trimmed.substring(0, 400)}…' : trimmed;
  }

  void _applyApprovalRequested(Map<String, dynamic> event, int? seq) {
    final requestId = (event['requestId'] as String?) ?? '';
    final rawOptions = event['options'];
    final options = <TranscriptOption>[];
    if (rawOptions is List) {
      for (final raw in rawOptions) {
        if (raw is! Map) continue;
        final id = raw['id'] as String?;
        if (id == null || id.isEmpty) continue;
        options.add(
          TranscriptOption(
            id: id,
            label: (raw['label'] as String?) ?? id,
            // The protocol's own `destructive` flag, never a guess from the label: a "Deny" that is
            // worded differently by one agent would otherwise be painted as a neutral button.
            destructive: raw['destructive'] == true,
          ),
        );
      }
    }

    final entry = TranscriptEntry(
      kind: 'approval',
      id: requestId.isEmpty ? 'a${seq ?? entries.length}' : requestId,
      approval: TranscriptApproval(
        requestId: requestId,
        // Empty when the daemon sent no question; the card renders only a non-empty question and
        // keeps its own localized title, rather than storing an English fallback sentence here.
        question: (event['question'] as String?) ?? '',
        detail: event['detail'] as String?,
        options: options,
        selection: event['selection'] as String?,
      ),
    );
    if (requestId.isNotEmpty) _byRequest[requestId] = entries.length;
    entries.add(entry);
  }

  /// Close every open question without answering it.
  void _closeOpenApprovals() {
    for (final entry in entries) {
      final approval = entry.approval;
      if (approval != null && approval.isOpen) approval.closed = true;
    }
  }

  /// Any row of another kind ends the run of anonymous fragments, so two consecutive answers do not
  /// merge into one bubble while the pieces of a single answer still do.
  void _breakAnonymous() => _anonymousKey = '';

  String _nextAnonymousKey() {
    if (_anonymousKey.isEmpty) {
      _anonymousCount += 1;
      _anonymousKey = 'anon-$_anonymousCount';
    }
    return _anonymousKey;
  }
}
