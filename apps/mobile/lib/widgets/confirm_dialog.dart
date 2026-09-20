/// The app's one confirmation dialog for an action that takes something away.
///
/// It exists because two new affordances (remove a project, archive a task) need exactly the shape
/// the Connections sheet established for **Forget host**: a question, a sentence that says what is
/// lost and what is not, a Cancel, and a labelled confirm. Copying that AlertDialog per call site is
/// how three copies drift — one gains a red confirm button, another loses Cancel — and the drift is
/// invisible until a destructive press is confirmed by accident.
///
/// [destructive] is what keeps the wording honest in the other direction. A project removal deletes
/// EnvoyDev's record of the project with no way back, so its confirm is the danger colour; archiving
/// a task only takes it out of the list and leaves the work on disk, so its confirm is an ordinary
/// button. Colouring the archive press red would teach the user to fear an action that is safe.
library;

import 'package:flutter/material.dart';

import '../theme/tokens.dart';

/// Ask the user to confirm [title]/[message]; `true` only when the confirm button was pressed.
///
/// Every dismissal that is not the confirm press — Cancel, the barrier, the Android back gesture —
/// returns `false`, because "no answer" must never read as "yes" for something that changes state.
Future<bool> showConfirmDialog(
  BuildContext context, {
  required String title,
  required String message,
  required String confirmLabel,
  bool destructive = true,
}) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) {
      final colors = CoderTheme.of(context);
      return AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(
              confirmLabel,
              style: destructive ? TextStyle(color: colors.destructive) : null,
            ),
          ),
        ],
      );
    },
  );
  return confirmed == true;
}
