/// The screen a phone with no paired desktop opens on.
///
/// This is deliberately a *different screen* from an empty project list rather than the same list
/// with a sentence in it. The two look identical to a build and completely different to a user: an
/// empty list with no button is a dead end that reads as "this app has nothing", while this says
/// what is missing and offers the one action that fixes it. The owner's rule — do not show an empty
/// project list with no way forward — is why the button is the point of the screen, not a footnote.
library;

import 'package:flutter/material.dart';

import '../theme/tokens.dart';

class NoHostsScreen extends StatelessWidget {
  const NoHostsScreen({super.key, required this.onAddHost});

  final VoidCallback onAddHost;

  @override
  Widget build(BuildContext context) {
    final colors = CoderTheme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('EnvoyDev')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(CoderSpace.xl2),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.computer, size: 48, color: colors.foregroundMuted),
              const SizedBox(height: CoderSpace.md2),
              Text('No desktop paired yet', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: CoderSpace.sm2),
              const Text(
                'On your computer, open EnvoyDev → Pair a phone, then scan the code. '
                'Your agents keep running whether or not the phone is connected.',
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: CoderSpace.xl),
              // The one thing to do here, and it is the same flow the top bar's Add-host button
              // runs — not a second, parallel way to pair.
              FilledButton.icon(
                onPressed: onAddHost,
                icon: const Icon(Icons.add_link),
                label: const Text('Add host'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
