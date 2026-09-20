/// The repository facts `coder.gitStatus` and `coder.gitBranches` answer with.
///
/// The wire types live in `@envoydev/protocol`; this is the phone's read of them, and it is deliberately
/// narrow: what the rail prints and what the branch sheet needs, with every field required so a daemon that
/// stops sending one is a compile error here rather than a missing line on screen.
library;

class GitStatusInfo {
  const GitStatusInfo({
    required this.kind,
    this.branch,
    required this.detached,
    this.upstream,
    required this.ahead,
    required this.behind,
    required this.dirty,
    required this.conflicted,
  });

  /// `git` | `jj` | `none`. Only `git` has branches this build can drive.
  final String kind;

  /// Absent when HEAD is detached, or when the folder is not a repository.
  final String? branch;
  final bool detached;
  final String? upstream;
  final int ahead;
  final int behind;

  /// Entries git reported: staged, modified and untracked.
  final int dirty;

  /// An unmerged entry exists — a merge stopped here, and a person is needed.
  final bool conflicted;

  bool get isRepository => kind == 'git';

  static int _count(Object? value) => value is num ? value.toInt() : 0;

  factory GitStatusInfo.fromJson(Map<String, dynamic> json) {
    return GitStatusInfo(
      kind: (json['kind'] as String?) ?? 'none',
      branch: json['branch'] as String?,
      detached: json['detached'] == true,
      upstream: json['upstream'] as String?,
      ahead: _count(json['ahead']),
      behind: _count(json['behind']),
      dirty: _count(json['dirty']),
      conflicted: json['conflicted'] == true,
    );
  }
}

class GitBranchInfo {
  const GitBranchInfo({required this.name, required this.current, this.upstream});

  final String name;
  final bool current;
  final String? upstream;

  factory GitBranchInfo.fromJson(Map<String, dynamic> json) {
    return GitBranchInfo(
      name: (json['name'] as String?) ?? '',
      current: json['current'] == true,
      upstream: json['upstream'] as String?,
    );
  }
}

/// One stash, as `coder.gitStashList` and every stash write reports it.
///
/// [index] is the only part the phone ever sends back: a stash is named by a number, so the daemon is what
/// turns it into `stash@{n}` — a client that could name a revision could name a commit instead of a stash.
/// [message] is git's own subject, left exactly as git wrote it because it is not a sentence of ours.
class GitStashInfo {
  const GitStashInfo({required this.index, required this.ref, required this.message, this.at});

  final int index;
  final String ref;
  final String message;

  /// When it was made. Absent when the daemon could not read git's answer.
  final DateTime? at;

  /// The stashes in one answer, whoever measured them.
  static List<GitStashInfo> listFrom(Object? raw) {
    final stashes = <GitStashInfo>[];
    if (raw is! List) return stashes;
    for (final item in raw) {
      if (item is! Map) continue;
      final index = item['index'];
      final ref = item['ref']?.toString() ?? '';
      if (index is! num || ref.isEmpty) continue;
      stashes.add(GitStashInfo(
        index: index.toInt(),
        ref: ref,
        message: item['message']?.toString() ?? '',
        at: DateTime.tryParse(item['at']?.toString() ?? ''),
      ));
    }
    return stashes;
  }
}
