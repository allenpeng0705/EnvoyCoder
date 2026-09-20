/// Adding a host, from the sheet to the save — one implementation for every caller.
///
/// This lived inside `HostListScreen` while that screen was the entry point. It cannot stay there
/// now: the Connections sheet's first row and the empty state for a phone with no hosts both have to
/// add a host, and two copies of "show the sheet, parse the code, refuse in the family's words,
/// save" is how one of them quietly stops refusing the wrong app's code. (The project list's top bar
/// used to carry a third door; the owner removed it so pairing has one home.)
///
/// The refusal dialog lives here too, for the same reason: a refusal is shown *once*, at the press
/// that caused it, rather than reconstructed by whichever screen was open.
library;

import 'package:flutter/material.dart';

import 'host_store.dart';
import 'pairing_service.dart';
import '../models/host.dart';
import '../screens/add_host_sheet.dart';
import '../widgets/name_dialog.dart';

/// Shown when a scanned code is refused — wording from `pairingAppMismatch`.
void showPairingRefusal(BuildContext context, String message) {
  showDialog<void>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('That code is for another app'),
      content: Text(message),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('OK')),
      ],
    ),
  );
}

/// Run the whole add-host flow. Returns the host that was paired and saved, or null if the user
/// backed out or the code was refused.
///
/// Saving is part of the flow, not the caller's job: a caller that forgot `upsert` would leave a
/// host on screen and not on disk, which is the kind of bug that only shows up after a restart.
///
/// ## Naming the connection, once, before it is saved
///
/// A code names a machine by its **address** — `pairing_service.dart` sets the label from the URL's
/// host, because the payload EnvoyDev mints carries no host or app name at all
/// (`packages/host-bridge/src/index.ts:594-631`: `pairingUri` sends a token, owner and addresses,
/// and nothing that reads like a name). So the default is the address, and the dialog is prefilled
/// with it. That is the whole reason this step exists and the reason it is safe: the common case is
/// one tap on **Add**, keeping the address as the name, and a user with two machines who wants
/// "Studio" and "Laptop" sets it here rather than renaming afterwards.
///
/// **Naming is not mandatory.** Clearing the field is not an error — `showNameDialog` returns the
/// prefilled default — so there is no way to be blocked on it, and nothing is saved until the tap, so
/// Cancel really does abort the pairing rather than leaving a half-added host.
///
/// Direct TCP and SSH are deliberately **not** given this dialog: the Direct TCP form already asks
/// for an optional label, and an SSH host is named by the hop the user typed, so a second name prompt
/// there would be a question already answered.
Future<CoderHost?> addHostFlow(BuildContext context, HostStore store) async {
  final result = await showAddHostSheet(context);
  if (result == null) return null;

  final CoderHost host;
  if (result.code != null) {
    final parsed = parsePairingCode(result.code!);
    if (!parsed.ok) {
      if (!context.mounted) return null;
      showPairingRefusal(context, parsed.refusal!);
      return null;
    }
    if (!context.mounted) return null;
    final name = await showNameDialog(
      context,
      title: 'Name this connection',
      fieldLabel: 'Connection name',
      initialValue: parsed.host!.label,
      confirmLabel: 'Add',
      helperText: 'Shown in the Connections list — the address is kept as well.',
      // The connection-name bound, from the one place that defines it (`name_dialog.dart`). The
      // prefilled default is the address, whose host part is at most 39 characters, so a user who
      // simply taps Add is never stopped by it.
      maxLength: kConnectionNameMaxLength,
    );
    // Cancel (or the barrier) at the naming step aborts the whole pairing: nothing has been written
    // yet, so there is no host to leave behind.
    if (name == null) return null;
    host = parsed.host!.copyWith(label: name);
  } else if (result.host != null) {
    host = result.host!;
  } else {
    return null;
  }

  await store.upsert(host);
  // A host the user just added is the host they meant to use: leaving the active choice on whatever
  // machine was open before would pair a new desktop and then show the old one.
  await store.saveActiveHostId(host.id);
  return host;
}
