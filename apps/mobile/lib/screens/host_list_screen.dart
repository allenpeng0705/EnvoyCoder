/// The first screen: which machines this phone can reach, and how each one is doing.
///
/// "How is it doing" is the point. Before any task list, the user needs to know whether the thing
/// they are about to look at is live, reconnecting, or unreachable — so the connection state is a
/// first-class column, not a spinner that disappears.
library;

import 'package:flutter/material.dart';

import '../models/host.dart';
import '../services/host_client.dart';

class HostListScreen extends StatefulWidget {
  const HostListScreen({super.key});

  @override
  State<HostListScreen> createState() => _HostListScreenState();
}

class _HostListScreenState extends State<HostListScreen> {
  final List<CoderHost> _hosts = [];
  final Map<String, HostConnectionState> _states = {};

  Future<void> _pairFromCode() async {
    final controller = TextEditingController();
    final code = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Pair with a desktop'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(hintText: 'Paste the pairing code or scan the QR'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(controller.text),
            child: const Text('Pair'),
          ),
        ],
      ),
    );
    if (code == null || code.isEmpty) return;
    setState(() {
      // The parse is in `pairing_service.dart`; refusals carry the family's wording.
      // (Kept inline here so this file stays a screen, not a service.)
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('EnvoyCoder')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _pairFromCode,
        icon: const Icon(Icons.qr_code_scanner),
        label: const Text('Pair'),
      ),
      body: _hosts.isEmpty
          ? const _EmptyState()
          : ListView.builder(
              itemCount: _hosts.length,
              itemBuilder: (context, index) {
                final host = _hosts[index];
                final state = _states[host.id] ?? HostConnectionState.idle;
                return ListTile(
                  leading: _stateDot(state),
                  title: Text(host.label),
                  subtitle: Text('${host.endpoint} · ${_stateLabel(state)}'),
                  trailing: const Icon(Icons.chevron_right),
                );
              },
            ),
    );
  }

  Widget _stateDot(HostConnectionState state) {
    final color = switch (state) {
      HostConnectionState.connected => Colors.green,
      HostConnectionState.connecting => Colors.blue,
      HostConnectionState.reconnecting => Colors.amber,
      HostConnectionState.failed => Colors.red,
      HostConnectionState.idle => Colors.grey,
    };
    return Container(width: 10, height: 10, decoration: BoxDecoration(color: color, shape: BoxShape.circle));
  }

  String _stateLabel(HostConnectionState state) => switch (state) {
        HostConnectionState.connected => 'Connected',
        HostConnectionState.connecting => 'Connecting',
        HostConnectionState.reconnecting => 'Reconnecting — your tasks are still running',
        HostConnectionState.failed => 'Unreachable',
        HostConnectionState.idle => 'Not connected yet',
      };
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.computer, size: 48),
            const SizedBox(height: 12),
            Text('No desktop paired yet', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 6),
            const Text(
              'On your computer, open EnvoyCoder → Pair a phone, then scan the code. '
              'Your agents keep running whether or not the phone is connected.',
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}
