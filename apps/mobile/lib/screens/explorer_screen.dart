/// Files and changes for the task that is open.
///
/// The phone's version of the desktop explorer: a full screen, because a side
/// column does not fit. Back closes it. Folders open; files are listed and not
/// edited. `node_modules` and `.git` stay hidden.
library;

import 'package:flutter/material.dart';

import '../l10n/l10n.dart';
import '../theme/tokens.dart';

typedef ExplorerRpc = Future<Map<String, dynamic>> Function(
  String method, [
  Map<String, dynamic> params,
]);

class ExplorerScreen extends StatefulWidget {
  const ExplorerScreen({super.key, required this.rpc, required this.root});

  final ExplorerRpc rpc;
  final String root;

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
      final raw = result['changes'];
      final changes = <_Change>[];
      if (raw is List) {
        for (final item in raw) {
          if (item is! Map) continue;
          final path = item['path']?.toString() ?? '';
          if (path.isEmpty) continue;
          changes.add(_Change(
            path: path,
            kind: item['kind']?.toString() ?? 'modified',
            from: item['from']?.toString(),
          ));
        }
      }
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

  Widget _changesBody(CoderColors colors) {
    final l10n = context.l10n;
    if (_changesLoading) return const Center(child: CircularProgressIndicator());
    if (_changesError != null) return _message(_changesError!, colors);
    if (!_repo) return _message(l10n.explorerNotRepo, colors);
    if (_changes.isEmpty) return _message(l10n.explorerNoChanges, colors);
    return ListView(
      children: [
        for (final change in _changes)
          ListTile(
            title: Text(change.from == null || change.from!.isEmpty ? change.path : '${change.from} → ${change.path}'),
            subtitle: Text(_kindLabel(change.kind, l10n)),
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
  const _Change({required this.path, required this.kind, this.from});

  final String path;
  final String kind;
  final String? from;
}
