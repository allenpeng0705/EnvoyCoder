/// Transcript rows styled to match the desktop `TranscriptRow` + `MessageMarkdown` path.
library;

import 'package:flutter/material.dart';

import '../l10n/l10n.dart';
import '../models/transcript.dart';
import '../theme/tokens.dart';
import 'assistant_markdown.dart';

class TranscriptRow extends StatelessWidget {
  const TranscriptRow({
    super.key,
    required this.entry,
    required this.colors,
    this.onAnswer,
    this.streaming = false,
  });

  final TranscriptEntry entry;
  final CoderColors colors;
  final Future<void> Function(String requestId, {String? optionId, List<String>? optionIds, String? text})? onAnswer;
  final bool streaming;

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
      case 'approval':
        if (entry.approval == null) return const SizedBox.shrink();
        return ApprovalCard(
          approval: entry.approval!,
          colors: colors,
          onAnswer: onAnswer,
        );
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
    final meta = delivered == 'steered'
        ? l10n.runYouSteered
        : delivered == 'queued'
            ? l10n.runYouQueued
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

class _ThoughtTile extends StatelessWidget {
  const _ThoughtTile({required this.text, required this.colors});

  final String text;
  final CoderColors colors;

  @override
  Widget build(BuildContext context) {
    // Collapsed by default — same rule as desktop `<details>`.
    return Theme(
      data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
      child: ExpansionTile(
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

class _ToolCard extends StatelessWidget {
  const _ToolCard({required this.entry, required this.colors});

  final TranscriptEntry entry;
  final CoderColors colors;

  @override
  Widget build(BuildContext context) {
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
          if (entry.toolInput != null) ...[
            const SizedBox(height: 8),
            _CodeBlock(text: entry.toolInput!, colors: colors),
          ],
          if (entry.toolOutput != null) ...[
            const SizedBox(height: 8),
            _CodeBlock(text: entry.toolOutput!, colors: colors),
          ],
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

class ApprovalCard extends StatelessWidget {
  const ApprovalCard({
    super.key,
    required this.approval,
    required this.colors,
    this.onAnswer,
  });

  final TranscriptApproval approval;
  final CoderColors colors;
  final Future<void> Function(String requestId, {String? optionId, List<String>? optionIds, String? text})? onAnswer;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final answered = approval.resolvedWith;
    final closed = approval.closed;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colors.surface1,
        borderRadius: BorderRadius.circular(8),
        border: Border(
          left: BorderSide(color: colors.statusWarning, width: 3),
          top: BorderSide(color: colors.border),
          right: BorderSide(color: colors.border),
          bottom: BorderSide(color: colors.border),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            answered != null || closed ? l10n.runAnswered : l10n.runNeedsAnswer,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 6),
          if (approval.question.isNotEmpty)
            Text(approval.question, style: TextStyle(color: colors.foreground, fontWeight: FontWeight.w600)),
          if (approval.detail != null && approval.detail!.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(approval.detail!, style: TextStyle(color: colors.foregroundMuted, fontSize: 13)),
          ],
          const SizedBox(height: 12),
          if (answered != null)
            Text(
              l10n.runAnsweredWith(_answeredLabel(approval)),
              style: TextStyle(color: colors.foregroundMuted, fontSize: 12),
            )
          else if (closed)
            Text(l10n.runNoLongerWaiting, style: TextStyle(color: colors.foregroundMuted, fontSize: 12))
          else if (approval.selection == 'many')
            _ManyChoices(approval: approval, colors: colors, onAnswer: onAnswer)
          else if (approval.selection == 'text')
            _TextAnswer(approval: approval, colors: colors, onAnswer: onAnswer)
          else
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
                    child: Text(option.label),
                  ),
              ],
            ),
        ],
      ),
    );
  }
}

/// The sentence for a note row.
///
/// A note the daemon sent already carries its text and is rendered verbatim (the daemon owns that
/// wording). A note the app generated carries a kind and its numbers instead, and is worded here —
/// which is what keeps plural rules correct and the sentence in the phone's language.
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
      return entry.text;
  }
}

String _answeredLabel(TranscriptApproval approval) {
  final ids = approval.resolvedWithIds;
  if (ids != null && ids.length > 1) {
    return ids.map((id) => _labelFor(approval.options, id)).join(', ');
  }
  return _labelFor(approval.options, approval.resolvedWith ?? '');
}

String _labelFor(List<TranscriptOption> options, String optionId) {
  for (final option in options) {
    if (option.id == optionId) return option.label;
  }
  return optionId;
}

class _ManyChoices extends StatefulWidget {
  const _ManyChoices({required this.approval, required this.colors, this.onAnswer});

  final TranscriptApproval approval;
  final CoderColors colors;
  final Future<void> Function(String requestId, {String? optionId, List<String>? optionIds, String? text})? onAnswer;

  @override
  State<_ManyChoices> createState() => _ManyChoicesState();
}

class _ManyChoicesState extends State<_ManyChoices> {
  final Set<String> _picked = {};

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final option in widget.approval.options)
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            dense: true,
            value: _picked.contains(option.id),
            title: Text(option.label, style: TextStyle(color: widget.colors.foreground)),
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
    );
  }
}

class _TextAnswer extends StatefulWidget {
  const _TextAnswer({required this.approval, required this.colors, this.onAnswer});

  final TranscriptApproval approval;
  final CoderColors colors;
  final Future<void> Function(String requestId, {String? optionId, List<String>? optionIds, String? text})? onAnswer;

  @override
  State<_TextAnswer> createState() => _TextAnswerState();
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
