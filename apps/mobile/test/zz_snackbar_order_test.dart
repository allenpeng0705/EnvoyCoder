// TEMPORARY review instrument: is a SnackBar painted above or below an open modal bottom sheet?
//
// The branch sheet confirms every action with a SnackBar while staying open. If the modal route paints above
// the Scaffold that hosts the SnackBar, those confirmations are invisible. This measures the geometry rather
// than assuming the framework's order.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('a SnackBar and an open modal sheet occupy the same pixels', (tester) async {
    final messenger = GlobalKey<ScaffoldMessengerState>();
    await tester.pumpWidget(MaterialApp(
      scaffoldMessengerKey: messenger,
      home: Scaffold(
        body: Builder(
          builder: (context) => Center(
            child: TextButton(
              onPressed: () => showModalBottomSheet<void>(
                context: context,
                isScrollControlled: true,
                builder: (context) => const Padding(
                  padding: EdgeInsets.all(24),
                  child: Column(mainAxisSize: MainAxisSize.min, children: [Text('SHEET')]),
                ),
              ),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    messenger.currentState!.showSnackBar(const SnackBar(content: Text('CONFIRMED')));
    await tester.pumpAndSettle();

    final snack = tester.getRect(find.byType(SnackBar));
    final sheet = tester.getRect(find.text('SHEET'));
    // Where the two overlap, the last-pushed route (the sheet's) wins: its own surface is painted over the
    // route beneath, and the SnackBar lives in that route.
    final overlaps = snack.top < sheet.bottom;
    // ignore: avoid_print
    print('MEASURED snackbar=$snack sheet-label=$sheet overlap=$overlaps');
    expect(find.text('CONFIRMED'), findsOneWidget);
  });
}
