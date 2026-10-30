/// Transcript rows styled to match the desktop `TranscriptRow` + `MessageMarkdown` path.
library;

import 'package:flutter/material.dart';

import '../l10n/daemon_text.dart';
import '../l10n/l10n.dart';
import '../models/tool_buckets.dart';
import '../models/tool_group_summary.dart';
import '../models/transcript.dart';
import '../models/transcript_steps.dart';
import '../theme/tokens.dart';
import 'assistant_markdown.dart';

class TranscriptRow extends StatelessWidget {
  const TranscriptRow({
    super.key,
    required this.entry,
    required this.colors,
    this.onAnswer,
    this.streaming = false,
    this.actionsDeferred = false,
    this.canStopAsking = false,
  });

  final TranscriptEntry entry;
  final CoderColors colors;
  final Future<void> Function(
    String requestId, {
    String? optionId,
    List<String>? optionIds,
    String? text,
    bool stopAsking,
  })? onAnswer;
  final bool streaming;
  /// Pending — choices live in the sticky chrome above the composer.
  final bool actionsDeferred;
  final bool canStopAsking;

  @override
  Widget build(BuildContext context) {
    switch (entry.kind) {
      case 'user':
        return _UserBubble(entry: entry, colors: colors);
      case 'assistant':
        return AssistantMarkdown(text: entry.text, colors: colors, streaming: streaming);
      case 'thought':
        return _ThoughtTile(text: entry.text, colors: colors);
      case 'tool':
        return _ToolCard(entry: entry, colors: colors);
      case 'tools':
        return _ToolsGroupCard(entry: entry, colors: colors, nestedInSteps: false);
      case 'approval':
        if (entry.approval == null) return const SizedBox.shrink();
        return ApprovalCard(
          approval: entry.approval!,
          colors: colors,
          onAnswer: onAnswer,
          actionsDeferred: actionsDeferred,
          canStopAsking: canStopAsking,
        );
      case 'plan':
        return PlanChecklistCard(entry: entry, colors: colors);
      case 'note':
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 2),
          child: Text(
            _noteText(context.l10n, entry),
            style: TextStyle(
              color: entry.tone == 'error'
                  ? colors.statusDanger
                  : entry.tone == 'warn'
                      ? colors.statusWarning
                      : colors.foregroundMuted,
              fontSize: 12,
            ),
          ),
        );
      default:
        return const SizedBox.shrink();
    }
  }
}

class _UserBubble extends StatelessWidget {
  const _UserBubble({required this.entry, required this.colors});

  final TranscriptEntry entry;
  final CoderColors colors;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final delivered = entry.delivered;
    // Same composition as the window: "You · Sent now" / "You · Queued".
    final meta = delivered == 'steered'
        ? '${l10n.runYou} · ${l10n.runYouSteered}'
        : delivered == 'queued'
            ? '${l10n.runYou} · ${l10n.runYouQueued}'
            : l10n.runYou;
    return Align(
      alignment: Alignment.centerRight,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.82),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: colors.surface2,
                border: Border.all(color: colors.border),
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(12),
                  topRight: Radius.circular(12),
                  bottomLeft: Radius.circular(12),
                  bottomRight: Radius.circular(4),
                ),
              ),
              child: Text(entry.text, style: TextStyle(color: colors.foreground, height: 1.4)),
            ),
            const SizedBox(height: 4),
            Text(meta, style: TextStyle(color: colors.foregroundMuted, fontSize: 12)),
          ],
        ),
      ),
    );
  }
}

/// Steps disclosure wrapping thought / tool / interim assistant rows.
///
/// Matches desktop: stays **closed** by default so the chat is user + answer
/// history. Expand for the live Working… stream, tools, and nested thoughts.
class TranscriptStepsBlock extends StatefulWidget {
  const TranscriptStepsBlock({
    super.key,
    required this.storageId,
    required this.entries,
    required this.live,
    required this.colors,
    required this.counts,
    required this.thoughtCount,
  });

  /// Stable id for [PageStorageKey] so expand/collapse survives list recycling.
  final String storageId;
  final List<TranscriptEntry> entries;
  final bool live;
  final CoderColors colors;
  final ToolCounts counts;
  final int thoughtCount;

  @override
  State<TranscriptStepsBlock> createState() => _TranscriptStepsBlockState();
}

class _TranscriptStepsBlockState extends State<TranscriptStepsBlock>
    with AutomaticKeepAliveClientMixin {
  final ScrollController _streamScroll = ScrollController();

  /// Bumped on live edges so a remount resets to collapsed (chat stays the focus).
  var _liveEpoch = 0;

  @override
  bool get wantKeepAlive => true;

  @override
  void didUpdateWidget(TranscriptStepsBlock oldWidget) {
    super.didUpdateWidget(oldWidget);
    // No setState — build runs right after didUpdateWidget in the same frame.
    if (widget.live != oldWidget.live) {
      _liveEpoch++;
    }

    final stream = stepsLiveStreamText(widget.entries);
    final oldStream = stepsLiveStreamText(oldWidget.entries);
    if (widget.live && stream != oldStream) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _scrollStreamToEnd());
    }
  }

  void _scrollStreamToEnd() {
    if (!mounted || !_streamScroll.hasClients) return;
    _streamScroll.jumpTo(_streamScroll.position.maxScrollExtent);
  }

  @override
  void dispose() {
    _streamScroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final l10n = context.l10n;
    final live = widget.live;
    final streamText = live ? stepsLiveStreamText(widget.entries) : '';
    final title = live
        ? l10n.runStepsWorking
        : widget.counts.total > 0
            ? toolGroupSummary(l10n, widget.counts)
            : widget.thoughtCount > 0
                ? l10n.runThoughtTitle
                : l10n.runStepsSummary;
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: widget.colors.surface1,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: live ? widget.colors.accent : widget.colors.border),
      ),
      child: Material(
        type: MaterialType.transparency,
        child: Theme(
          data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
          child: ExpansionTile(
            // Epoch remounts on live edges; always start collapsed so history stays readable.
            key: ValueKey<String>('${widget.storageId}-$_liveEpoch'),
            initiallyExpanded: false,
            tilePadding: const EdgeInsets.symmetric(horizontal: 12),
            childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
            title: Row(
              children: [
                Icon(
                  Icons.circle,
                  size: 8,
                  color: live
                      ? widget.colors.statusDotRunning
                      : widget.colors.foregroundMuted,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    title,
                    style: TextStyle(color: widget.colors.foregroundMuted, fontSize: 13),
                  ),
                ),
              ],
            ),
            children: [
              if (live && streamText.isNotEmpty)
                _LiveStreamPane(
                  text: streamText,
                  colors: widget.colors,
                  scrollController: _streamScroll,
                ),
              for (final entry in _coalesceThoughts(widget.entries)) ...[
                // Live stream already shows thought / interim assistant text.
                if (live && (entry.kind == 'thought' || entry.kind == 'assistant'))
                  const SizedBox.shrink()
                else if (entry.kind == 'thought')
                  _ThoughtTile(text: entry.text, colors: widget.colors)
                else if (entry.kind == 'assistant')
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Opacity(
                      opacity: 0.85,
                      child: AssistantMarkdown(
                        text: entry.text,
                        colors: widget.colors,
                        streaming: false,
                      ),
                    ),
                  )
                else if (entry.kind == 'tool')
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: _ToolCard(entry: entry, colors: widget.colors),
                  )
                else if (entry.kind == 'tools')
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: _ToolsGroupCard(
                      entry: entry,
                      colors: widget.colors,
                      nestedInSteps: true,
                    ),
                  )
                else if (entry.kind == 'note')
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      _noteText(context.l10n, entry),
                      style: TextStyle(
                        color: widget.colors.foregroundMuted,
                        fontSize: 12,
                      ),
                    ),
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _LiveStreamPane extends StatelessWidget {
  const _LiveStreamPane({
    required this.text,
    required this.colors,
    required this.scrollController,
  });

  final String text;
  final CoderColors colors;
  final ScrollController scrollController;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 4, bottom: 4),
      child: Container(
        width: double.infinity,
        constraints: const BoxConstraints(maxHeight: 192),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: Color.lerp(colors.surface1, colors.accent, 0.06),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: Color.lerp(colors.border, colors.accent, 0.28)!),
        ),
        child: Scrollbar(
          controller: scrollController,
          thumbVisibility: true,
          child: SingleChildScrollView(
            controller: scrollController,
            child: Text(
              text,
              style: TextStyle(
                color: colors.foregroundMuted,
                fontSize: 13,
                height: 1.45,
                fontFamily: 'monospace',
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Nested Thought disclosure — closed until the reader asks (desktop twin).
class _ThoughtTile extends StatelessWidget {
  const _ThoughtTile({required this.text, required this.colors});

  final String text;
  final CoderColors colors;

  @override
  Widget build(BuildContext context) {
    return Theme(
      data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
      child: ExpansionTile(
        initiallyExpanded: false,
        tilePadding: EdgeInsets.zero,
        childrenPadding: const EdgeInsets.only(bottom: 4),
        title: Text(
          context.l10n.runThoughtTitle,
          style: TextStyle(color: colors.foregroundMuted, fontSize: 13),
        ),
        children: [
          Align(
            alignment: Alignment.centerLeft,
            child: Text(
              text,
              style: TextStyle(color: colors.foregroundMuted, fontSize: 13, height: 1.4),
            ),
          ),
        ],
      ),
    );
  }
}

/// Consecutive thought chunks → one disclosure (desktop `coalesceStepsEntries`).
List<TranscriptEntry> _coalesceThoughts(List<TranscriptEntry> entries) {
  final out = <TranscriptEntry>[];
  for (final entry in entries) {
    final prev = out.isEmpty ? null : out.last;
    if (entry.kind == 'thought' && prev?.kind == 'thought') {
      final gap = prev!.text.endsWith('\n') || entry.text.startsWith('\n') ? '' : '\n\n';
      out[out.length - 1] = TranscriptEntry(
        kind: 'thought',
        id: prev.id,
        text: '${prev.text}$gap${entry.text}',
      );
      continue;
    }
    out.add(entry);
  }
  return out;
}
/// Consecutive tools collapsed under a bucket summary (desktop `ToolsGroupRow` twin).
class _ToolsGroupCard extends StatelessWidget {
  const _ToolsGroupCard({
    required this.entry,
    required this.colors,
    required this.nestedInSteps,
  });

  final TranscriptEntry entry;
  final CoderColors colors;
  final bool nestedInSteps;

  @override
  Widget build(BuildContext context) {
    final tools = entry.tools ?? const <TranscriptEntry>[];
    final summary = toolGroupSummary(context.l10n, entry.toolCounts);
    final anyRunning = tools.any((t) => t.status == 'running');
    final anyFailed = tools.any((t) => t.status == 'failed');
    final tone = anyRunning
        ? colors.statusDotRunning
        : anyFailed
            ? colors.statusDotDanger
            : colors.foregroundMuted;

    final head = Row(
      children: [
        Icon(Icons.circle, size: 8, color: tone),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            summary,
            style: TextStyle(color: colors.foregroundMuted, fontSize: 13),
          ),
        ),
      ],
    );

    final list = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final tool in tools)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: _ToolCard(entry: tool, colors: colors),
          ),
      ],
    );

    // Inside Steps the outer disclosure owns collapse — flat list under the summary.
    if (nestedInSteps) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          head,
          list,
        ],
      );
    }

    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: colors.surface1,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: anyRunning ? colors.accent : colors.border),
      ),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          initiallyExpanded: anyRunning,
          tilePadding: const EdgeInsets.symmetric(horizontal: 12),
          childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
          title: head,
          children: [list],
        ),
      ),
    );
  }
}

class _ToolCard extends StatefulWidget {
  const _ToolCard({required this.entry, required this.colors});

  final TranscriptEntry entry;
  final CoderColors colors;

  @override
  State<_ToolCard> createState() => _ToolCardState();
}

class _ToolCardState extends State<_ToolCard> with AutomaticKeepAliveClientMixin {
  late final ExpansionTileController _details = ExpansionTileController();
  String? _lastStatus;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _lastStatus = widget.entry.status;
    // Suggest open while the tool is live — same one-shot rule as desktop ToolCard / Steps.
    if (widget.entry.status == 'running') {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _details.expand();
      });
    }
  }

  @override
  void didUpdateWidget(covariant _ToolCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    final status = widget.entry.status;
    if (status == 'running' && _lastStatus != 'running') {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _details.expand();
      });
    }
    _lastStatus = status;
  }

  @override
  void dispose() {
    _details.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final entry = widget.entry;
    final colors = widget.colors;
    final status = entry.status ?? '';
    final borderColor = status == 'running'
        ? colors.accent
        : status == 'failed'
            ? colors.statusDanger
            : colors.border;
    final dotColor = status == 'running'
        ? colors.statusDotRunning
        : status == 'failed'
            ? colors.statusDotDanger
            : colors.foregroundMuted;
    final title = entry.text.isEmpty ? context.l10n.runToolFallback : entry.text;
    final hasPayload =
        (entry.toolInput != null && entry.toolInput!.isNotEmpty) ||
        (entry.toolOutput != null && entry.toolOutput!.isNotEmpty);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colors.surface1,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.circle, size: 8, color: dotColor),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: colors.foreground,
                  ),
                ),
              ),
              if (status.isNotEmpty)
                Text(status, style: TextStyle(color: colors.foregroundMuted, fontSize: 11)),
            ],
          ),
          if (hasPayload)
            Material(
              type: MaterialType.transparency,
              child: Theme(
                data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
                child: ExpansionTile(
                  controller: _details,
                  tilePadding: EdgeInsets.zero,
                  childrenPadding: EdgeInsets.zero,
                  title: Text(
                    context.l10n.runToolDetails,
                    style: TextStyle(color: colors.foregroundMuted, fontSize: 12),
                  ),
                  children: [
                    if (entry.toolInput != null && entry.toolInput!.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      _CodeBlock(text: entry.toolInput!, colors: colors),
                    ],
                    if (entry.toolOutput != null && entry.toolOutput!.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      _CodeBlock(text: entry.toolOutput!, colors: colors),
                    ],
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _CodeBlock extends StatelessWidget {
  const _CodeBlock({required this.text, required this.colors});

  final String text;
  final CoderColors colors;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      constraints: const BoxConstraints(maxHeight: 180),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: colors.surface0,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: colors.border),
      ),
      child: SingleChildScrollView(
        child: Text(
          text,
          style: TextStyle(fontFamily: 'monospace', fontSize: 11, color: colors.foreground, height: 1.4),
        ),
      ),
    );
  }
}

/// ACP plan checklist — Cursor-style progress on the phone.
class PlanChecklistCard extends StatefulWidget {
  const PlanChecklistCard({super.key, required this.entry, required this.colors});

  final TranscriptEntry entry;
  final CoderColors colors;

  @override
  State<PlanChecklistCard> createState() => _PlanChecklistCardState();
}

class _PlanChecklistCardState extends State<PlanChecklistCard> {
  final ScrollController _scroll = ScrollController();

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final colors = widget.colors;
    final entry = widget.entry;
    final items = entry.planEntries ?? const <TranscriptPlanEntry>[];
    final done = items.where((e) => e.status == 'completed').length;
    final complete = items.isNotEmpty && done == items.length;
    final title = items.isEmpty
        ? l10n.runPlanTitle
        : l10n.runPlanProgress(done, items.length);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colors.surface1,
        border: Border(
          left: BorderSide(
            color: complete ? colors.statusSuccess : colors.statusDotRunning,
            width: 3,
          ),
          top: BorderSide(color: colors.border),
          right: BorderSide(color: colors.border),
          bottom: BorderSide(color: colors.border),
        ),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: TextStyle(color: colors.foreground, fontWeight: FontWeight.w600)),
          if (items.isNotEmpty) ...[
            const SizedBox(height: 8),
            Scrollbar(
              controller: _scroll,
              thumbVisibility: true,
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 240),
                child: ListView.separated(
                  controller: _scroll,
                  shrinkWrap: true,
                  itemCount: items.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 6),
                  itemBuilder: (context, index) {
                    final item = items[index];
                    final muted = item.status == 'completed' || item.status == 'cancelled';
                    return Row(
                      key: ValueKey(item.id ?? 'plan-step-$index-${item.content}'),
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _planMark(item.status),
                          style: TextStyle(
                            color: item.status == 'in_progress'
                                ? colors.statusDotRunning
                                : item.status == 'completed'
                                    ? colors.statusSuccess
                                    : colors.foregroundMuted,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            item.content,
                            style: TextStyle(
                              color: muted ? colors.foregroundMuted : colors.foreground,
                              decoration: muted ? TextDecoration.lineThrough : null,
                              fontSize: 13,
                              height: 1.4,
                            ),
                          ),
                        ),
                        if (item.priority == 'high')
                          Text(
                            l10n.runPlanPriorityHigh,
                            style: TextStyle(color: colors.statusWarning, fontSize: 11),
                          ),
                      ],
                    );
                  },
                ),
              ),
            ),
          ],
          if (entry.planMarkdown != null && entry.planMarkdown!.isNotEmpty) ...[
            const SizedBox(height: 8),
            ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 192),
              child: SingleChildScrollView(
                child: AssistantMarkdown(text: entry.planMarkdown!, colors: colors),
              ),
            ),
          ],
        ],
      ),
    );
  }

  String _planMark(String status) {
    switch (status) {
      case 'completed':
        return '✓';
      case 'in_progress':
        return '●';
      case 'cancelled':
        return '–';
      default:
        return '○';
    }
  }
}

class ApprovalCard extends StatelessWidget {
  const ApprovalCard({
    super.key,
    required this.approval,
    required this.colors,
    this.onAnswer,
    this.actionsDeferred = false,
    this.canStopAsking = false,
  });

  final TranscriptApproval approval;
  final CoderColors colors;
  final Future<void> Function(
    String requestId, {
    String? optionId,
    List<String>? optionIds,
    String? text,
    bool stopAsking,
  })? onAnswer;
  /// Pending — actions live in sticky chrome above the composer.
  final bool actionsDeferred;
  /// Envoy Harness (approvalPolicy) while Settings still asks.
  final bool canStopAsking;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final answered = approval.resolvedWith;
    final closed = approval.closed;
    final deferred = actionsDeferred && answered == null && !closed;

    // **The accent is a stripe, not a border.** A `Border` whose left side is wider than the others
    // cannot carry a `borderRadius`: Flutter asserts "A borderRadius can only be given for a uniform
    // Border" the moment the card is *painted*, so this card could not survive a debug-mode approval —
    // no test had ever rendered it until `test/approval_card_test.dart` did, and the stripe is a
    // clipped positioned child now, with a uniform border underneath it.
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: Stack(
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: colors.surface1,
              border: Border.all(color: colors.border),
            ),
            child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            answered != null || closed ? l10n.runAnswered : l10n.runNeedsAnswer,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 6),
          // **`isEmpty` is a daemon older than the question**, not a question with no words: a
          // conforming daemon always sends one, in its own catalogue's words when it has no tool name
          // to name. The fallback says so in the user's language rather than leaving a blank line.
          Text(
            approval.question.isEmpty
                ? l10n.runApprovalNeedsDecision
                : daemonText(l10n, approval.question),
            style: TextStyle(color: colors.foreground, fontWeight: FontWeight.w600),
          ),
          // Plan bodies stay visible even while choices live in sticky chrome — same contract as
          // the desktop deferred card. Cap height so a long ask_user plan cannot push the buttons
          // off the phone.
          if (approval.detail != null && approval.detail!.isNotEmpty) ...[
            const SizedBox(height: 8),
            _ApprovalDetail(detail: approval.detail!, colors: colors),
          ],
          if (_askHint(l10n, approval.selection) case final hint?) ...[
            const SizedBox(height: 6),
            Text(hint, style: TextStyle(color: colors.foregroundMuted, fontSize: 13)),
          ],
          if (deferred) ...[
            const SizedBox(height: 4),
            Text(
              l10n.runApprovalAnswerBelow,
              style: TextStyle(color: colors.foregroundMuted, fontSize: 13),
            ),
          ],
          const SizedBox(height: 12),
          if (answered != null)
            Text(
              l10n.runAnsweredWith(_answeredLabel(l10n, approval)),
              style: TextStyle(color: colors.foregroundMuted, fontSize: 12),
            )
          else if (closed)
            Text(l10n.runNoLongerWaiting, style: TextStyle(color: colors.foregroundMuted, fontSize: 12))
          else if (deferred)
            const SizedBox.shrink()
          else if (approval.selection == 'many')
            _ManyChoices(approval: approval, colors: colors, onAnswer: onAnswer)
          else if (approval.selection == 'text')
            _TextAnswer(approval: approval, colors: colors, onAnswer: onAnswer)
          else ...[
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final option in approval.options)
                  FilledButton(
                    style: option.destructive
                        ? FilledButton.styleFrom(backgroundColor: colors.destructive)
                        : null,
                    onPressed: onAnswer == null
                        ? null
                        : () => onAnswer!(approval.requestId, optionId: option.id),
                    // The daemon's own Allow / Don't allow labels arrive keyed, like every other
                    // sentence it authors.
                    child: Text(daemonText(l10n, option.label)),
                  ),
              ],
            ),
            if (canStopAsking)
              _StopAskingButton(
                approval: approval,
                onAnswer: onAnswer,
                label: l10n.runApprovalStopAsking,
              ),
          ],
              ],
            ),
          ),
          Positioned(
            left: 0,
            top: 0,
            bottom: 0,
            child: Container(width: 3, color: colors.statusWarning),
          ),
        ],
      ),
    );
  }
}

/// The sentence for a note row.
///
/// A note the daemon sent carries its text plus the key for it, and goes through [daemonText] so the
/// user reads it in their own language (the daemon owns the wording; the phone owns the language). A
/// note the app generated carries a kind and its numbers instead, and is worded here — which is what
/// keeps plural rules and the sentence in the phone's language correct.
String _noteText(AppLocalizations l10n, TranscriptEntry entry) {
  switch (entry.noteKind) {
    case 'diff':
      return l10n.runNoteDiff(entry.noteCount ?? 0);
    case 'usage':
      return l10n.runNoteContext(entry.notePercent ?? 0);
    case 'ended':
      return switch (entry.noteStatus) {
        'done' => l10n.runNoteFinished,
        'cancelled' => l10n.runNoteStopped,
        'failed' => l10n.runNoteStoppedBefore,
        _ => l10n.runNoteEnded,
      };
    default:
      return daemonText(l10n, entry.text);
  }
}

String? _askHint(AppLocalizations l10n, String? selection) {
  switch (selection) {
    case 'many':
      return l10n.approvalDetailMultiple;
    case 'text':
      return l10n.approvalDetailText;
    case 'one':
      return l10n.approvalDetailPick;
    default:
      return null;
  }
}

bool _detailLooksLikeMarkdown(String detail) {
  return detail.contains('\n') ||
      RegExp(r'^#{1,6}\s', multiLine: true).hasMatch(detail) ||
      detail.contains('|');
}

/// Scrollable ask/plan body — markdown when it looks like a plan, plain when it is a short keyed hint.
class _ApprovalDetail extends StatefulWidget {
  const _ApprovalDetail({required this.detail, required this.colors});

  final String detail;
  final CoderColors colors;

  @override
  State<_ApprovalDetail> createState() => _ApprovalDetailState();
}

class _ApprovalDetailState extends State<_ApprovalDetail> {
  final ScrollController _scroll = ScrollController();

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final text = daemonText(l10n, widget.detail);
    final markdown = _detailLooksLikeMarkdown(text);
    final child = markdown
        ? AssistantMarkdown(text: text, colors: widget.colors)
        : Text(text, style: TextStyle(color: widget.colors.foregroundMuted, fontSize: 13));
    if (!markdown) return child;

    return Scrollbar(
      controller: _scroll,
      thumbVisibility: true,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 240),
        child: SingleChildScrollView(
          controller: _scroll,
          child: child,
        ),
      ),
    );
  }
}

String _answeredLabel(AppLocalizations l10n, TranscriptApproval approval) {
  final ids = approval.resolvedWithIds;
  if (ids != null && ids.length > 1) {
    return ids.map((id) => _labelFor(l10n, approval.options, id)).join(', ');
  }
  return _labelFor(l10n, approval.options, approval.resolvedWith ?? '');
}

String _labelFor(AppLocalizations l10n, List<TranscriptOption> options, String optionId) {
  for (final option in options) {
    if (option.id == optionId) return daemonText(l10n, option.label);
  }
  return optionId;
}

class _ManyChoices extends StatefulWidget {
  const _ManyChoices({required this.approval, required this.colors, this.onAnswer});

  final TranscriptApproval approval;
  final CoderColors colors;
  final Future<void> Function(
    String requestId, {
    String? optionId,
    List<String>? optionIds,
    String? text,
    bool stopAsking,
  })? onAnswer;

  @override
  State<_ManyChoices> createState() => _ManyChoicesState();
}

class _ManyChoicesState extends State<_ManyChoices> {
  final Set<String> _picked = {};

  @override
  Widget build(BuildContext context) {
    // **A `Material` above the checkboxes, or Flutter's own assertion fires.** `CheckboxListTile` paints
    // its background and ink on the nearest `Material`, and this card's background is a decorated box —
    // a combination Flutter refuses in debug ("ListTile background color or ink splashes may be
    // invisible"), which nothing had painted before `approval_card_test.dart`. A transparent `Material`
    // gives the ink somewhere to land without changing what the card looks like.
    return Material(
      type: MaterialType.transparency,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final option in widget.approval.options)
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              value: _picked.contains(option.id),
              title: Text(
                daemonText(context.l10n, option.label),
                style: TextStyle(color: widget.colors.foreground),
              ),
              controlAffinity: ListTileControlAffinity.leading,
              onChanged: (checked) {
                setState(() {
                  if (checked == true) {
                    _picked.add(option.id);
                  } else {
                    _picked.remove(option.id);
                  }
                });
              },
            ),
          FilledButton(
            onPressed: widget.onAnswer == null || _picked.isEmpty
                ? null
                : () => widget.onAnswer!(widget.approval.requestId, optionIds: _picked.toList()),
            child: Text(context.l10n.commonConfirm),
          ),
        ],
      ),
    );
  }
}

class _TextAnswer extends StatefulWidget {
  const _TextAnswer({required this.approval, required this.colors, this.onAnswer});

  final TranscriptApproval approval;
  final CoderColors colors;
  final Future<void> Function(
    String requestId, {
    String? optionId,
    List<String>? optionIds,
    String? text,
    bool stopAsking,
  })? onAnswer;

  @override
  State<_TextAnswer> createState() => _TextAnswerState();
}

class _StopAskingButton extends StatelessWidget {
  const _StopAskingButton({
    required this.approval,
    required this.label,
    this.onAnswer,
  });

  final TranscriptApproval approval;
  final String label;
  final Future<void> Function(
    String requestId, {
    String? optionId,
    List<String>? optionIds,
    String? text,
    bool stopAsking,
  })? onAnswer;

  @override
  Widget build(BuildContext context) {
    if (onAnswer == null) return const SizedBox.shrink();
    String? allowId;
    for (final option in approval.options) {
      if (!option.destructive) {
        allowId = option.id;
        break;
      }
    }
    if (allowId == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: TextButton(
        onPressed: () => onAnswer!(
          approval.requestId,
          optionId: allowId,
          stopAsking: true,
        ),
        child: Text(label),
      ),
    );
  }
}

class _TextAnswerState extends State<_TextAnswer> {
  final TextEditingController _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ready = _controller.text.trim().isNotEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(
          controller: _controller,
          minLines: 2,
          maxLines: 6,
          style: TextStyle(color: widget.colors.foreground),
          decoration: InputDecoration(hintText: context.l10n.runYourAnswer),
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 8),
        FilledButton(
          onPressed: widget.onAnswer == null || !ready
              ? null
              : () => widget.onAnswer!(widget.approval.requestId, text: _controller.text),
          child: Text(context.l10n.commonConfirm),
        ),
      ],
    );
  }
}
