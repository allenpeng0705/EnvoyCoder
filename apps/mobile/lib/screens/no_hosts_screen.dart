/// The screen a phone with no paired desktop opens on.
///
/// This is deliberately a *different screen* from an empty project list rather than the same list
/// with a sentence in it. The two look identical to a build and completely different to a user: an
/// empty list with no button is a dead end that reads as "this app has nothing", while this says
/// what is missing and offers the one action that fixes it. The owner's rule — do not show an empty
/// project list with no way forward — is why the button is the point of the screen, not a footnote.
library;

import 'package:flutter/material.dart';

import '../l10n/l10n.dart';
import '../theme/tokens.dart';

class NoHostsScreen extends StatelessWidget {
  const NoHostsScreen({super.key, required this.onAddHost});

  final VoidCallback onAddHost;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final colors = CoderTheme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.appName)),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(CoderSpace.xl2),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.computer, size: 48, color: colors.foregroundMuted),
              const SizedBox(height: CoderSpace.md2),
              Text(l10n.hostNoHostsTitle, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: CoderSpace.sm2),
              Text(
                l10n.hostNoHostsBody,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: CoderSpace.xl),
              // The one thing to do here, and it is the same flow the Connections sheet's first row
              // runs — not a second, parallel way to pair. (The top bar's Add-host shortcut is gone
              // by design: with a host on screen, pairing lives in the sheet the name opens.)
              FilledButton.icon(
                onPressed: onAddHost,
                icon: const Icon(Icons.add_link),
                label: Text(l10n.connectionsAddHost),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
