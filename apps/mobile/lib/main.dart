/// EnvoyDev for the phone.
///
/// The shape is Paseo's — a list of hosts, then the work on the selected one — because that is what
/// people expect from a "check on my agents" app. What is *not* Paseo's is the transport: this app
/// pairs with an EnvoyDev desktop the same way every app in the EnvoyMesh family does (a shared
/// pairing code, with the `app` claim keeping the family apart), and reaches it over the mesh, a
/// direct address, or an SSH hop.
///
/// The screen shows the **status of the connection** before it shows content, deliberately: a list
/// of tasks that is silently stale is worse than no list.
library;

import 'package:flutter/material.dart';

import 'screens/host_list_screen.dart';
import 'theme/tokens.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const EnvoyDevApp());
}

class EnvoyDevApp extends StatelessWidget {
  const EnvoyDevApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'EnvoyDev',
      theme: const CoderTheme(CoderColors.light).toThemeData(),
      darkTheme: const CoderTheme(CoderColors.dark).toThemeData(),
      themeMode: ThemeMode.system,
      home: const HostListScreen(),
    );
  }
}
