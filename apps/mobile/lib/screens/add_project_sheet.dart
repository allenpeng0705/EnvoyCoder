/// Register a folder on the paired computer as an EnvoyDev project.
///
/// Browse via [HomeFolderBrowser] (daemon home-fs RPCs), or paste a path.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../models/harness.dart';
import '../services/host_client.dart';
import '../widgets/home_folder_browser.dart';

/// Returns the added project's id, or null if cancelled.
Future<String?> showAddProjectSheet({
  required BuildContext context,
  required HostClient client,
  List<HarnessInfo> harnesses = const [],
}) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (ctx) => _AddProjectSheet(client: client, harnesses: harnesses),
  );
}

class _AddProjectSheet extends StatefulWidget {
  const _AddProjectSheet({required this.client, required this.harnesses});

  final HostClient client;
  final List<HarnessInfo> harnesses;

  @override
  State<_AddProjectSheet> createState() => _AddProjectSheetState();
}

class _AddProjectSheetState extends State<_AddProjectSheet> {
  final TextEditingController _pathController = TextEditingController();
  String? _harnessId;
  var _busy = false;

  @override
  void initState() {
    super.initState();
    final offered = offeredHarnesses(widget.harnesses);
    if (offered.isNotEmpty) _harnessId = offered.first.id;
  }

  @override
  void dispose() {
    _pathController.dispose();
    super.dispose();
  }

  Future<void> _browse() async {
    final picked = await HomeFolderBrowser.open(
      context,
      rpc: (method, [params = const {}]) => widget.client.call(method, params),
      initialPath: _pathController.text.trim().isEmpty ? null : _pathController.text.trim(),
      title: 'Choose project folder',
    );
    if (picked == null || !mounted) return;
    setState(() => _pathController.text = picked);
  }

  Future<void> _submit() async {
    final path = _pathController.text.trim();
    if (path.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Choose a folder on this computer.')),
      );
      return;
    }
    setState(() => _busy = true);
    try {
      final params = <String, dynamic>{
        'path': path,
        if (_harnessId != null) 'defaults': {'harness': _harnessId},
      };
      final result = await widget.client.call('coder.addProject', params);
      final project = result['project'];
      final id = project is Map ? project['id']?.toString() : null;
      if (!mounted) return;
      Navigator.of(context).pop(id);
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            e
                .toString()
                .replaceFirst('Exception: ', '')
                .replaceFirst('Bad state: ', ''),
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final offered = offeredHarnesses(widget.harnesses);

    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        bottom: MediaQuery.viewInsetsOf(context).bottom + 16,
      ),
      child: SafeArea(
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Add project',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 8),
              Text(
                'Pick a folder on this computer. Agents will run inside it.',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _pathController,
                enabled: !_busy,
                decoration: InputDecoration(
                  labelText: 'Folder',
                  hintText: '/Users/you/work/repo',
                  border: const OutlineInputBorder(),
                  suffixIcon: IconButton(
                    tooltip: 'Browse',
                    onPressed: _busy ? null : () => unawaited(_browse()),
                    icon: const Icon(Icons.folder_open),
                  ),
                ),
              ),
              if (offered.isNotEmpty) ...[
                const SizedBox(height: 16),
                DropdownButtonFormField<String>(
                  initialValue: _harnessId,
                  decoration: const InputDecoration(
                    labelText: 'Default agent',
                    border: OutlineInputBorder(),
                  ),
                  items: [
                    for (final h in offered)
                      DropdownMenuItem(value: h.id, child: Text(h.label)),
                  ],
                  onChanged: _busy
                      ? null
                      : (v) {
                          if (v != null) setState(() => _harnessId = v);
                        },
                ),
              ],
              const SizedBox(height: 16),
              FilledButton(
                onPressed: _busy ? null : () => unawaited(_submit()),
                child: _busy
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Add project'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
