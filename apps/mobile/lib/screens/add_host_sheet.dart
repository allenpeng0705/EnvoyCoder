/// Ways to add a host — Paseo's menu shape, EnvoyDev's transport.
///
/// Scan / paste use the family's pairing URI. Direct TCP and Remote SSH build a host row the
/// family's candidate walk can dial without a QR (the SSH hop is the *transport* for the host's own
/// address — see `host_client.dart`).
library;

import 'package:flutter/material.dart';

import '../models/host.dart';
import '../services/add_host.dart';
import 'qr_scan_screen.dart';

/// Result of the add-host sheet: either a pairing code to parse, or a ready [CoderHost].
class AddHostResult {
  const AddHostResult.code(this.code) : host = null;
  const AddHostResult.host(this.host) : code = null;

  final String? code;
  final CoderHost? host;
}

Future<AddHostResult?> showAddHostSheet(BuildContext context) {
  return showModalBottomSheet<AddHostResult>(
    context: context,
    showDragHandle: true,
    builder: (context) => const _AddHostSheet(),
  );
}

class _AddHostSheet extends StatelessWidget {
  const _AddHostSheet();

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            leading: const Icon(Icons.qr_code_scanner),
            title: const Text('Scan QR'),
            subtitle: const Text('Pair with the code on your computer'),
            onTap: () async {
              final code = await Navigator.of(context).push<String>(
                MaterialPageRoute(builder: (_) => const QrScanScreen()),
              );
              if (!context.mounted) return;
              if (code == null || code.isEmpty) {
                Navigator.of(context).pop();
                return;
              }
              Navigator.of(context).pop(AddHostResult.code(code));
            },
          ),
          ListTile(
            leading: const Icon(Icons.content_paste),
            title: const Text('Paste link'),
            subtitle: const Text('Paste the pairing link from EnvoyDev'),
            onTap: () async {
              final code = await _promptText(
                context,
                title: 'Paste pairing link',
                hint: 'envoy://pair?…',
              );
              if (!context.mounted) return;
              if (code == null || code.isEmpty) return;
              Navigator.of(context).pop(AddHostResult.code(code));
            },
          ),
          ListTile(
            leading: const Icon(Icons.lan_outlined),
            title: const Text('Direct TCP'),
            subtitle: const Text('Host, port, and optional token'),
            onTap: () async {
              final host = await _promptDirectTcp(context);
              if (!context.mounted) return;
              if (host == null) return;
              Navigator.of(context).pop(AddHostResult.host(host));
            },
          ),
          ListTile(
            leading: const Icon(Icons.terminal),
            title: const Text('Remote SSH'),
            subtitle: const Text('Reach the daemon through an SSH hop'),
            onTap: () async {
              final host = await _promptSsh(context);
              if (!context.mounted) return;
              if (host == null) return;
              Navigator.of(context).pop(AddHostResult.host(host));
            },
          ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}

Future<String?> _promptText(
  BuildContext context, {
  required String title,
  required String hint,
  bool obscure = false,
}) async {
  final controller = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: TextField(
        controller: controller,
        autofocus: true,
        obscureText: obscure,
        decoration: InputDecoration(hintText: hint),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(controller.text.trim()),
          child: const Text('Continue'),
        ),
      ],
    ),
  );
}

Future<CoderHost?> _promptDirectTcp(BuildContext context) async {
  final endpointController = TextEditingController(text: '192.168.1.1:4770');
  final tokenController = TextEditingController();
  final labelController = TextEditingController();
  final ok = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('Direct TCP'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: endpointController,
            decoration: const InputDecoration(labelText: 'Host:port'),
          ),
          TextField(
            controller: tokenController,
            decoration: const InputDecoration(
              labelText: 'Token (optional if already paired)',
              helperText: 'Kept only on this phone — never shown in the list.',
            ),
            obscureText: true,
          ),
          TextField(
            controller: labelController,
            decoration: const InputDecoration(labelText: 'Label (optional)'),
          ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
        FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Add')),
      ],
    ),
  );
  if (ok != true) return null;

  // The rules live in `services/add_host.dart` so a test can hold them, and so a refusal is a
  // *sentence* rather than the silent `return null` this used to be — pressing Add with a blank field
  // closed the dialog and did nothing at all, which reads as the app ignoring the press.
  final result = buildDirectHost(
    endpoint: endpointController.text,
    token: tokenController.text,
    label: labelController.text,
  );
  if (!context.mounted) return null;
  return _orExplain(context, result);
}

/// A refusal, shown where the press was, or the host it built.
Future<CoderHost?> _orExplain(BuildContext context, HostDraft result) async {
  switch (result) {
    case HostDraftBuilt(:final host):
      return host;
    case HostDraftRefused(:final message):
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('That did not add a machine'),
          content: Text(message),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('OK')),
          ],
        ),
      );
      return null;
  }
}

Future<CoderHost?> _promptSsh(BuildContext context) async {
  final sshHostController = TextEditingController();
  final userController = TextEditingController();
  final portController = TextEditingController(text: '22');
  final passwordController = TextEditingController();
  final daemonController = TextEditingController(text: '127.0.0.1:4770');
  final tokenController = TextEditingController();
  final ok = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('Remote SSH'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: sshHostController,
              decoration: const InputDecoration(labelText: 'SSH host'),
            ),
            TextField(
              controller: userController,
              decoration: const InputDecoration(labelText: 'User'),
            ),
            TextField(
              controller: portController,
              decoration: const InputDecoration(labelText: 'SSH port'),
              keyboardType: TextInputType.number,
            ),
            TextField(
              controller: passwordController,
              decoration: const InputDecoration(labelText: 'Password'),
              obscureText: true,
            ),
            TextField(
              controller: daemonController,
              decoration: const InputDecoration(
                labelText: 'Daemon on remote (host:port)',
                helperText: 'Usually 127.0.0.1:4770 on that machine',
              ),
            ),
            TextField(
              controller: tokenController,
              decoration: const InputDecoration(
                // Optional *here*, and that is a fact about the route rather than leniency: the
                // tunnel arrives on the remote machine's own loopback, which the daemon trusts. A
                // token is still kept when given, because it is what the same host would need if the
                // hop were ever dropped for a direct address.
                labelText: 'Pairing token (optional over SSH)',
                helperText: 'The tunnel arrives as the machine itself, so it is trusted',
              ),
              obscureText: true,
            ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
        FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Add')),
      ],
    ),
  );
  if (ok != true) return null;

  final result = buildSshHost(
    sshHost: sshHostController.text,
    daemonEndpoint: daemonController.text,
    user: userController.text,
    port: portController.text,
    password: passwordController.text,
    token: tokenController.text,
  );
  if (!context.mounted) return null;
  return _orExplain(context, result);
}
