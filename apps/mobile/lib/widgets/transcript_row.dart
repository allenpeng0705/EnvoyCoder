/// Transcript rows styled to match the desktop `TranscriptRow` + `MessageMarkdown` path.
library;

import 'package:flutter/material.dart';

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
  final Future<void> Function(String requestId, String optionId)? onAnswer;
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
            entry.text,
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
    final delivered = entry.delivered;
    final meta = delivered == 'steered'
        ? 'You · joined the turn'
        : delivered == 'queued'
            ? 'You · waited for the turn'
            : 'You';
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
          'How it thought about this',
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
                  entry.text,
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
  final Future<void> Function(String requestId, String optionId)? onAnswer;

  @override
  Widget build(BuildContext context) {
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
            answered != null || closed ? 'Answered' : 'The agent needs your answer',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 6),
          Text(approval.question, style: TextStyle(color: colors.foreground, fontWeight: FontWeight.w600)),
          if (approval.detail != null && approval.detail!.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(approval.detail!, style: TextStyle(color: colors.foregroundMuted, fontSize: 13)),
          ],
          const SizedBox(height: 12),
          if (answered != null)
            Text(
              'Answered: ${_labelFor(approval.options, answered)}',
              style: TextStyle(color: colors.foregroundMuted, fontSize: 12),
            )
          else if (closed)
            Text('No longer waiting.', style: TextStyle(color: colors.foregroundMuted, fontSize: 12))
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
                        : () => onAnswer!(approval.requestId, option.id),
                    child: Text(option.label),
                  ),
              ],
            ),
        ],
      ),
    );
  }
}

String _labelFor(List<TranscriptOption> options, String optionId) {
  for (final option in options) {
    if (option.id == optionId) return option.label;
  }
  return optionId;
}
