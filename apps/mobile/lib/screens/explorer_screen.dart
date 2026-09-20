/// Files and changes for the task that is open.
///
/// The phone's version of the desktop explorer: a full screen, because a side
/// column does not fit. Back closes it. Folders open; files are listed and not
/// edited. `node_modules` and `.git` stay hidden.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/daemon_text.dart';
import '../l10n/l10n.dart';
import '../theme/tokens.dart';

typedef ExplorerRpc = Future<Map<String, dynamic>> Function(
  String method, [
  Map<String, dynamic> params,
]);

class ExplorerScreen extends StatefulWidget {
  const ExplorerScreen({
    super.key,
    required this.rpc,
    required this.root,
    this.projectId,
  });

  final ExplorerRpc rpc;
  final String root;

  /// The project whose repository the writes act on, when the caller knows it.
  ///
  /// The git methods take a **project id**, never a path: the daemon resolves the folder itself, so a client
  /// cannot name a directory for it to mutate. Absent means the Changes tab lists and diffs but offers no
  /// staging — an honest degradation for an embedded or older caller.
  final String? projectId;

  @override
  State<ExplorerScreen> createState() => _ExplorerScreenState();
}

class _ExplorerScreenState extends State<ExplorerScreen> with SingleTickerProviderStateMixin {
  late final TabController _tabs;

  bool _filesLoading = true;
  String? _filesError;
  String _path = '';
  List<_Entry> _entries = const [];

  bool _changesLoading = true;
  String? _changesError;
  bool _repo = true;
  List<_Change> _changes = const [];
  final _commitMessage = TextEditingController();
  bool _writing = false;
  String? _writeNotice;
  String? _writeError;

  static const _hidden = {'node_modules', '.git'};

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    _path = widget.root;
    _loadFiles(_path);
    _loadChanges();
  }

  @override
  void dispose() {
    _commitMessage.dispose();
    _tabs.dispose();
    super.dispose();
  }

  Future<void> _loadFiles(String path) async {
    setState(() {
      _filesLoading = true;
      _filesError = null;
    });
    try {
      final result = await widget.rpc('coder.listHomeFsEntries', {'path': path});
      final raw = result['entries'];
      final entries = <_Entry>[];
      if (raw is List) {
        for (final item in raw) {
          if (item is! Map) continue;
          final name = item['name']?.toString() ?? '';
          if (name.isEmpty || _hidden.contains(name)) continue;
          entries.add(_Entry(
            name: name,
            kind: item['kind']?.toString() == 'dir' ? 'dir' : 'file',
            path: item['path']?.toString() ?? '',
          ));
        }
      }
      if (!mounted) return;
      setState(() {
        _path = result['path']?.toString() ?? path;
        _entries = entries;
        _filesLoading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _filesLoading = false;
        _filesError = context.l10n.explorerCouldNotList;
      });
    }
  }

  Future<void> _loadChanges() async {
    setState(() {
      _changesLoading = true;
      _changesError = null;
    });
    try {
      final result = await widget.rpc('coder.listWorktreeChanges', {'path': widget.root});
      final changes = _parseChanges(result['changes']);
      if (!mounted) return;
      setState(() {
        _repo = result['repo'] != false;
        _changes = changes;
        _changesLoading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _changesLoading = false;
        _changesError = context.l10n.explorerCouldNotRead;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final colors = CoderTheme.of(context);
    final atRoot = _path == widget.root;
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.explorerTitle),
        bottom: TabBar(
          controller: _tabs,
          tabs: [
            Tab(text: l10n.explorerFiles),
            Tab(text: l10n.explorerChanges),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabs,
        children: [
          _filesBody(colors, atRoot),
          _changesBody(colors),
        ],
      ),
    );
  }

  Widget _filesBody(CoderColors colors, bool atRoot) {
    final l10n = context.l10n;
    if (_filesLoading) return const Center(child: CircularProgressIndicator());
    if (_filesError != null) {
      return _message(_filesError!, colors);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: Text(
            _path,
            style: TextStyle(color: colors.foregroundMuted, fontSize: 12),
          ),
        ),
        Expanded(
          child: ListView(
            children: [
              if (!atRoot)
                ListTile(
                  leading: const Icon(Icons.arrow_upward),
                  title: Text(l10n.folderParent),
                  onTap: () {
                    final slash = _path.lastIndexOf(RegExp(r'[/\\]'));
                    if (slash > 0) _loadFiles(_path.substring(0, slash));
                  },
                ),
              if (_entries.isEmpty)
                ListTile(title: Text(l10n.explorerFolderEmpty)),
              for (final entry in _entries)
                ListTile(
                  leading: Icon(entry.kind == 'dir' ? Icons.folder_outlined : Icons.insert_drive_file_outlined),
                  title: Text(entry.name),
                  onTap: entry.kind == 'dir' ? () => _loadFiles(entry.path) : null,
                ),
            ],
          ),
        ),
      ],
    );
  }

  /// The changed files in one answer, whoever measured them.
  static List<_Change> _parseChanges(Object? raw) {
    final changes = <_Change>[];
    if (raw is! List) return changes;
    for (final item in raw) {
      if (item is! Map) continue;
      final path = item['path']?.toString() ?? '';
      if (path.isEmpty) continue;
      changes.add(_Change(
        path: path,
        kind: item['kind']?.toString() ?? 'modified',
        from: item['from']?.toString(),
        staged: item['staged'] == true,
        unstaged: item['unstaged'] == true,
      ));
    }
    return changes;
  }

  /// One of the three git writes — and its answer **is** the refreshed list.
  ///
  /// The daemon measures the repository after the write, so this tab and the rail agree without a second round
  /// trip; a refusal lands next to the control that caused it, in the user's language. `null` means it refused
  /// (the sentence is already on screen) and the caller should do nothing else.
  Future<({List<_Change> changes, String? sha})?> _write(
    String method,
    Map<String, dynamic> params,
  ) async {
    final projectId = widget.projectId;
    if (projectId == null || _writing) return null;
    setState(() {
      _writing = true;
      _writeError = null;
      _writeNotice = null;
    });
    try {
      final result = await widget.rpc(method, {'projectId': projectId, ...params});
      final changes = _parseChanges(result['changes']);
      if (!mounted) return null;
      setState(() {
        _changes = changes;
        _writing = false;
      });
      return (changes: changes, sha: result['sha']?.toString());
    } catch (error) {
      if (!mounted) return null;
      setState(() {
        _writing = false;
        _writeError = daemonErrorText(context.l10n, '$error');
      });
      return null;
    }
  }

  Future<void> _stage(List<String> paths) async {
    if (paths.isEmpty) return;
    await _write('coder.gitStage', {'paths': paths});
  }

  Future<void> _unstage(List<String> paths) async {
    if (paths.isEmpty) return;
    await _write('coder.gitUnstage', {'paths': paths});
  }

  Future<void> _commit() async {
    final message = _commitMessage.text.trim();
    if (message.isEmpty) return;
    final l10n = context.l10n;
    final result = await _write('coder.gitCommit', {'message': message});
    if (result == null || !mounted) return;
    _commitMessage.clear();
    final sha = result.sha;
    // The sentence names the short sha, which is what a person reads back in `git log`.
    setState(() => _writeNotice = l10n.explorerCommitDone(sha == null || sha.length < 7 ? (sha ?? "") : sha.substring(0, 7)));
  }

  Widget _changesBody(CoderColors colors) {
    final l10n = context.l10n;
    if (_changesLoading) return const Center(child: CircularProgressIndicator());
    if (_changesError != null) return _message(_changesError!, colors);
    if (!_repo) return _message(l10n.explorerNotRepo, colors);

    final canWrite = widget.projectId != null;
    final unstaged = [for (final change in _changes) if (change.unstaged) change.path];
    final staged = _changes.where((change) => change.staged).length;
    return ListView(
      children: [
        // **The commit box belongs to the repository, not to the list.** It stays put when the list empties —
        // which is exactly the moment a user looks for the sentence saying the commit landed.
        if (canWrite)
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  controller: _commitMessage,
                  enabled: !_writing,
                  maxLines: 1,
                  textInputAction: TextInputAction.done,
                  onChanged: (_) => setState(() {}),
                  onSubmitted: (_) => unawaited(_commit()),
                  decoration: InputDecoration(
                    hintText: l10n.explorerCommitMessage,
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    // **Stage all is a press, not a default.** A commit takes the index; filling it for a user
                    // who wanted one file would be the app deciding what their commit contains.
                    if (unstaged.isNotEmpty)
                      TextButton(
                        onPressed: _writing ? null : () => unawaited(_stage(unstaged)),
                        child: Text(l10n.explorerCommitStageAll),
                      ),
                    const Spacer(),
                    FilledButton(
                      // Off until both facts hold — a message and something in the index — so a press that
                      // cannot work is not offered.
                      onPressed: _writing || _commitMessage.text.trim().isEmpty || staged == 0
                          ? null
                          : () => unawaited(_commit()),
                      child: Text(l10n.explorerCommitCta),
                    ),
                  ],
                ),
                if (_writeNotice != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(_writeNotice!, style: TextStyle(color: colors.foregroundMuted, fontSize: 12)),
                  ),
                if (_writeError != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(_writeError!, style: TextStyle(color: colors.statusDanger, fontSize: 12)),
                  ),
              ],
            ),
          ),
        if (_changes.isEmpty)
          _message(l10n.explorerNoChanges, colors)
        else
          for (final change in _changes)
            ListTile(
              title: Text(change.from == null || change.from!.isEmpty ? change.path : '${change.from} → ${change.path}'),
              subtitle: Text(_kindLabel(change.kind, l10n)),
              // Two controls at most, and each is drawn only when it would do something: a file can be staged
              // *and* changed again, which is exactly when both are useful.
              trailing: !canWrite
                  ? null
                  : Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (change.unstaged)
                          IconButton(
                            tooltip: l10n.explorerStage(change.path),
                            onPressed: _writing ? null : () => unawaited(_stage([change.path])),
                            icon: const Icon(Icons.add_box_outlined),
                          ),
                        if (change.staged)
                          IconButton(
                            tooltip: l10n.explorerUnstage(change.path),
                            onPressed: _writing ? null : () => unawaited(_unstage([change.path])),
                            icon: const Icon(Icons.indeterminate_check_box_outlined),
                          ),
                      ],
                    ),
            ),
      ],
    );
  }

  Widget _message(String text, CoderColors colors) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Text(text, style: TextStyle(color: colors.foregroundMuted)),
    );
  }

  static String _kindLabel(String kind, AppLocalizations l10n) => switch (kind) {
        'added' => l10n.explorerKindAdded,
        'deleted' => l10n.explorerKindDeleted,
        'renamed' => l10n.explorerKindRenamed,
        'untracked' => l10n.explorerKindNew,
        'conflict' => l10n.explorerKindConflict,
        _ => l10n.explorerKindModified,
      };
}

class _Entry {
  const _Entry({required this.name, required this.kind, required this.path});

  final String name;
  final String kind;
  final String path;
}

class _Change {
  const _Change({
    required this.path,
    required this.kind,
    this.from,
    required this.staged,
    required this.unstaged,
  });

  final String path;
  final String kind;
  final String? from;

  /// The index holds something for this path — what a commit would record.
  final bool staged;

  /// The working tree differs from the index — what staging again would pick up.
  final bool unstaged;
}
