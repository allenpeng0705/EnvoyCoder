/// AppBar action that re-opens the EnvoyDev setup guide.
library;

import 'package:flutter/material.dart';

import '../l10n/l10n.dart';
import '../screens/onboarding/setup_guide_screen.dart';

class SetupGuideButton extends StatelessWidget {
  const SetupGuideButton({super.key, this.onPairNow});

  /// Optional: when the guide's Pair now is pressed from a non-first-launch open.
  /// Return `true` to dismiss the guide after a successful pair.
  final Future<bool> Function()? onPairNow;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return IconButton(
      tooltip: l10n.setupGuideTitle,
      visualDensity: VisualDensity.standard,
      padding: const EdgeInsets.all(8),
      constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
      icon: const Icon(Icons.info_outline, size: 22),
      onPressed: () => showSetupGuide(context, onPairNow: onPairNow),
    );
  }
}
