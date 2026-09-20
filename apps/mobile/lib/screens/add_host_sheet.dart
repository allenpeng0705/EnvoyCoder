/// Ways to add a host — Paseo's menu shape, EnvoyDev's transport.
///
/// Scan / paste use the family's pairing URI. Direct TCP and Remote SSH build a host row the
/// family's candidate walk can dial without a QR (the SSH hop is the *transport* for the host's own
/// address — see `host_client.dart`).
library;

import 'package:flutter/material.dart';

import '../l10n/l10n.dart';
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
    final l10n = context.l10n;
    // Scrollable, not a bare `Column`: four two-line rows are taller than the sheet's 9/16-of-screen
    // cap on a short phone, and the naming dialog that now follows a code opens a keyboard **over this
    // sheet**, shrinking it further. A plain column overflowed by 6.5pt at 600pt of height; a scroll
    // view spends a little of the sheet's height on nothing and cannot overflow at any of them.
    return SafeArea(
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.qr_code_scanner),
              title: Text(l10n.hostScanQr),
              subtitle: Text(l10n.hostScanQrSubtitle),
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
              title: Text(l10n.hostPasteLink),
              subtitle: Text(l10n.hostPasteLinkSubtitle),
              onTap: () async {
                final code = await _promptText(
                  context,
                  title: l10n.hostPasteLinkTitle,
                  hint: l10n.hostPasteLinkHint,
                );
                if (!context.mounted) return;
                if (code == null || code.isEmpty) return;
                Navigator.of(context).pop(AddHostResult.code(code));
              },
            ),
            ListTile(
              leading: const Icon(Icons.lan_outlined),
              title: Text(l10n.hostDirectTcp),
              subtitle: Text(l10n.hostDirectTcpSubtitle),
              onTap: () async {
                final host = await _promptDirectTcp(context);
                if (!context.mounted) return;
                if (host == null) return;
                Navigator.of(context).pop(AddHostResult.host(host));
              },
            ),
            ListTile(
              leading: const Icon(Icons.terminal),
              title: Text(l10n.hostRemoteSsh),
              subtitle: Text(l10n.hostRemoteSshSubtitle),
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
  final l10n = context.l10n;
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
        TextButton(onPressed: () => Navigator.of(context).pop(), child: Text(l10n.commonCancel)),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(controller.text.trim()),
          child: Text(l10n.commonContinue),
        ),
      ],
    ),
  );
}

Future<CoderHost?> _promptDirectTcp(BuildContext context) async {
  final l10n = context.l10n;
  final endpointController = TextEditingController(text: '192.168.1.1:4770');
  final tokenController = TextEditingController();
  final labelController = TextEditingController();
  final ok = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(l10n.hostDirectTcp),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: endpointController,
            decoration: InputDecoration(labelText: l10n.hostFieldHostPort),
          ),
          TextField(
            controller: tokenController,
            decoration: InputDecoration(
              labelText: l10n.hostFieldToken,
              helperText: l10n.hostFieldTokenHelper,
            ),
            obscureText: true,
          ),
          TextField(
            controller: labelController,
            decoration: InputDecoration(labelText: l10n.hostFieldLabel),
          ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(false), child: Text(l10n.commonCancel)),
        FilledButton(onPressed: () => Navigator.of(context).pop(true), child: Text(l10n.commonAdd)),
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
    case HostDraftRefused():
      final l10n = context.l10n;
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(l10n.hostRefusedTitle),
          content: Text(result.messageFor(l10n)),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(), child: Text(l10n.commonOk)),
          ],
        ),
      );
      return null;
  }
}

Future<CoderHost?> _promptSsh(BuildContext context) async {
  final l10n = context.l10n;
  final sshHostController = TextEditingController();
  final userController = TextEditingController();
  final portController = TextEditingController(text: '22');
  final passwordController = TextEditingController();
  final daemonController = TextEditingController(text: '127.0.0.1:4770');
  final tokenController = TextEditingController();
  final ok = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(l10n.hostRemoteSsh),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: sshHostController,
              decoration: InputDecoration(labelText: l10n.hostFieldSshHost),
            ),
            TextField(
              controller: userController,
              decoration: InputDecoration(labelText: l10n.hostFieldUser),
            ),
            TextField(
              controller: portController,
              decoration: InputDecoration(labelText: l10n.hostFieldSshPort),
              keyboardType: TextInputType.number,
            ),
            TextField(
              controller: passwordController,
              decoration: InputDecoration(labelText: l10n.hostFieldPassword),
              obscureText: true,
            ),
            TextField(
              controller: daemonController,
              decoration: InputDecoration(
                labelText: l10n.hostFieldDaemon,
                helperText: l10n.hostFieldDaemonHelper,
              ),
            ),
            TextField(
              controller: tokenController,
              decoration: InputDecoration(
                // Optional *here*, and that is a fact about the route rather than leniency: the
                // tunnel arrives on the remote machine's own loopback, which the daemon trusts. A
                // token is still kept when given, because it is what the same host would need if the
                // hop were ever dropped for a direct address.
                labelText: l10n.hostFieldPairingToken,
                helperText: l10n.hostFieldPairingTokenHelper,
              ),
              obscureText: true,
            ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(false), child: Text(l10n.commonCancel)),
        FilledButton(onPressed: () => Navigator.of(context).pop(true), child: Text(l10n.commonAdd)),
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
