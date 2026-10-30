/// Classify a tool call for grouped summary buckets (desktop `tool-buckets.ts` twin).
library;

enum ToolBucket { edited, ran, searched, other }

class ToolCounts {
  const ToolCounts({
    this.edited = 0,
    this.ran = 0,
    this.searched = 0,
    this.other = 0,
  });

  final int edited;
  final int ran;
  final int searched;
  final int other;

  int get total => edited + ran + searched + other;
}

ToolCounts emptyToolCounts() => const ToolCounts();

ToolBucket toolBucket(String name, {String? kind}) {
  final k = (kind ?? '').toLowerCase();
  if (k == 'edit' || k == 'write' || k == 'delete') return ToolBucket.edited;
  if (k == 'execute' || k == 'terminal') return ToolBucket.ran;
  if (k == 'search' || k == 'read' || k == 'fetch') return ToolBucket.searched;

  final n = name.toLowerCase();
  if (RegExp(
    r'write|edit|create|patch|apply_patch|str_replace|delete_file|notebook|multi_edit|file_edit',
  ).hasMatch(n)) {
    return ToolBucket.edited;
  }
  if (RegExp(r'shell|bash|exec|terminal|command|run_terminal|powershell').hasMatch(n)) {
    return ToolBucket.ran;
  }
  if (RegExp(r'search|grep|glob|find|read|list_dir|ls |web_search|semantic').hasMatch(n)) {
    return ToolBucket.searched;
  }
  return ToolBucket.other;
}

ToolCounts countToolBuckets(Iterable<({String name, String? kind})> tools) {
  var edited = 0;
  var ran = 0;
  var searched = 0;
  var other = 0;
  for (final tool in tools) {
    switch (toolBucket(tool.name, kind: tool.kind)) {
      case ToolBucket.edited:
        edited += 1;
      case ToolBucket.ran:
        ran += 1;
      case ToolBucket.searched:
        searched += 1;
      case ToolBucket.other:
        other += 1;
    }
  }
  return ToolCounts(edited: edited, ran: ran, searched: searched, other: other);
}
