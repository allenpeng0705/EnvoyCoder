/// One sentence summarising a tool group (desktop `tool-group-summary.ts` twin).
library;

import '../l10n/generated/app_localizations.dart';
import 'tool_buckets.dart';

String toolGroupSummary(AppLocalizations l10n, ToolCounts counts) {
  final parts = <String>[];
  if (counts.edited == 1) {
    parts.add(l10n.runToolsEditedOne);
  } else if (counts.edited > 1) {
    parts.add(l10n.runToolsEditedMany(counts.edited));
  }
  if (counts.ran == 1) {
    parts.add(l10n.runToolsRanOne);
  } else if (counts.ran > 1) {
    parts.add(l10n.runToolsRanMany(counts.ran));
  }
  if (counts.searched == 1) {
    parts.add(l10n.runToolsSearchedOne);
  } else if (counts.searched > 1) {
    parts.add(l10n.runToolsSearchedMany(counts.searched));
  }
  if (counts.other == 1) {
    parts.add(l10n.runToolsOtherOne);
  } else if (counts.other > 1) {
    parts.add(l10n.runToolsOtherMany(counts.other));
  }
  if (parts.isEmpty) return l10n.runToolsSummaryEmpty;
  if (parts.length == 1) return parts.first;
  if (parts.length == 2) {
    return l10n.runToolsSummaryTwo(parts[0], parts[1]);
  }
  final head = parts.sublist(0, parts.length - 1).join(l10n.runToolsSummaryComma);
  return l10n.runToolsSummaryMany(head, parts.last);
}
