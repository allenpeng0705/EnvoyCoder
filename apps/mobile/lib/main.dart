/// EnvoyCoder for the phone.
///
/// The shape is Paseo's — a list of hosts, then the work on the selected one — because that is what
/// people expect from a "check on my agents" app. What is *not* Paseo's is the transport: this app
/// pairs with an EnvoyCoder desktop the same way every app in the EnvoyMesh family does (a shared
/// pairing code, with the `app` claim keeping the family apart), and reaches it over the mesh, a
/// direct address, or an SSH hop.
///
/// The screen shows the **status of the connection** before it shows content, deliberately: a list
/// of tasks that is silently stale is worse than no list.
library;

import 'package:flutter/material.dart';

import 'models/host.dart';
import 'screens/host_list_screen.dart';
import 'services/pairing_service.dart';

void main() {
  runApp(const EnvoyCoderApp());
}

class EnvoyCoderApp extends StatelessWidget {
  const EnvoyCoderApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'EnvoyCoder',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF4C8DFF), brightness: Brightness.dark),
        useMaterial3: true,
      ),
      home: const HostListScreen(),
    );
  }
}

/// Shown when a scanned code is refused — the message comes from `pairingAppMismatch`, so it is the
/// same sentence every other app in the family shows.
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

/// A host row's subtitle, which never contains the token.
String hostSubtitle(CoderHost host) => describeHost(host);
