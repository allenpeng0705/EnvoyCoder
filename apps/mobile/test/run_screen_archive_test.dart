// Archiving the task you are currently looking at.
//
// The project list can archive any task from its row, but a task open on its own screen is a
// different case: taking it out of the list from underneath a screen that is still showing it is the
// "removing the task you are currently viewing" edge case, and it must not leave the user on a dead
// screen. The screen owns the action, and pops `true` so the list behind it drops the row; a refusal
// keeps the screen and the work exactly where they were.
//
// The verb is Archive because `coder.archiveTask` (`packages/protocol/src/rpc.ts:2086`) is the only
// task operation the protocol implements — it stamps `archivedAt` and leaves the folder, its files
// and the transcript on the computer (`apps/desktop/src/daemon/store.ts:582-594`).

import 'dart:async';

import 'package:envoydev_mobile/models/host.dart';
import 'package:envoydev_mobile/screens/run_screen.dart';
import 'package:envoydev_mobile/services/host_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class _StubClient extends HostClient {
  _StubClient(super.host);

  bool failWrites = false;

  /// Whether `coder.tailRun` reports the run as live — the app bar is at its widest then (Stop +
  /// Live + Explorer + Archive), which is the case a narrow phone has to survive.
  bool live = false;

  final List<({String method, Map<String, dynamic> params})> calls = [];

  @override
  HostConnectionState get state => HostConnectionState.connected;

  @override
  Stream<HostConnectionState> get states => const Stream<HostConnectionState>.empty();

  @override
  Stream<Map<String, dynamic>> get events => const Stream<Map<String, dynamic>>.empty();

  @override
  Future<void> connectBest() async {}

  @override
  Future<Map<String, dynamic>> call(
    String method, [
    Map<String, dynamic> params = const {},
    Duration timeout = const Duration(seconds: 15),
  ]) async {
    calls.add((method: method, params: params));
    switch (method) {
      case 'coder.listHarnesses':
        return {'harnesses': <Map<String, dynamic>>[]};
      case 'coder.listTasks':
        return {'tasks': <Map<String, dynamic>>[]};
      case 'coder.listRuns':
        return {'runs': <Map<String, dynamic>>[]};
      case 'coder.tailRun':
        return {'events': <Map<String, dynamic>>[], 'live': live};
      case 'coder.archiveTask':
        if (failWrites) throw StateError('refused');
        return {'task': {'id': params['id'], 'archivedAt': '2024-01-05T00:00:00.000Z'}};
      default:
        throw StateError('the screen called $method, which this test does not expect');
    }
  }

  // `dispose` is inherited: it cancels the family client's heartbeat timer.
}

const _host = CoderHost(
  id: 'h',
  label: 'Desk machine',
  endpoint: '192.168.1.9:4770',
  ownerId: 'o',
  app: 'EnvoyDev',
  token: 'tok',
);

Finder _iconButtonWithTooltip(String tooltip) => find.byWidgetPredicate(
      (widget) => widget is IconButton && widget.tooltip == tooltip,
    );

/// Open the run screen the way the project list does, and hand back the value it pops.
class _Opened {
  bool? popped;
}

Future<_Opened> _openRun(WidgetTester tester, _StubClient client, {String? taskId}) async {
  final opened = _Opened();
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => TextButton(
            onPressed: () {
              unawaited(
                Navigator.of(context)
                    .push<bool>(
                      MaterialPageRoute(
                        builder: (_) => RunScreen(
                          client: client,
                          runId: 'r-1',
                          title: 'Fix the tests',
                          taskId: taskId,
                        ),
                      ),
                    )
                    .then((value) => opened.popped = value),
              );
            },
            child: const Text('open'),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  return opened;
}

Future<void> _drainSnackBar(WidgetTester tester) async {
  await tester.pump(const Duration(seconds: 5));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('archiving the task you are viewing asks first, then leaves the screen', (tester) async {
    final client = _StubClient(_host);
    final opened = await _openRun(tester, client, taskId: 't-1');

    expect(find.byType(RunScreen), findsOneWidget);
    await tester.tap(_iconButtonWithTooltip('Archive task'));
    await tester.pumpAndSettle();

    expect(find.text('Archive Fix the tests?'), findsOneWidget);
    expect(find.textContaining('archiving is not deletion'), findsOneWidget);

    await tester.tap(find.widgetWithText(TextButton, 'Archive'));
    await tester.pumpAndSettle();

    expect(client.calls.where((c) => c.method == 'coder.archiveTask').single.params,
        {'id': 't-1', 'archived': true});
    // Gone from the screen, and the list behind it was told to drop the row.
    expect(find.byType(RunScreen), findsNothing);
    expect(find.text('open'), findsOneWidget);
    expect(opened.popped, isTrue);
    await client.dispose();
  });

  testWidgets('cancelling the archive on the run screen changes nothing', (tester) async {
    final client = _StubClient(_host);
    final opened = await _openRun(tester, client, taskId: 't-1');

    await tester.tap(_iconButtonWithTooltip('Archive task'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
    await tester.pumpAndSettle();

    expect(client.calls.where((c) => c.method == 'coder.archiveTask'), isEmpty);
    expect(find.byType(RunScreen), findsOneWidget);
    expect(opened.popped, isNull);
    await client.dispose();
  });

  testWidgets('a refused archive keeps the run screen up with the reason', (tester) async {
    final client = _StubClient(_host)..failWrites = true;
    await _openRun(tester, client, taskId: 't-1');

    await tester.tap(_iconButtonWithTooltip('Archive task'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Archive'));
    await tester.pumpAndSettle();

    expect(client.calls.where((c) => c.method == 'coder.archiveTask'), hasLength(1));
    // Navigating away from work that still exists would be the lie.
    expect(find.byType(RunScreen), findsOneWidget);
    expect(find.text('Could not archive this task. It is still here.'), findsOneWidget);
    await _drainSnackBar(tester);
    await client.dispose();
  });

  testWidgets('a run with no task behind it offers no archive button', (tester) async {
    final client = _StubClient(_host);
    await _openRun(tester, client, taskId: null);

    // Nothing to archive, so the button would be an action that cannot be carried out.
    expect(_iconButtonWithTooltip('Archive task'), findsNothing);
    await client.dispose();
  });

  testWidgets('the run screen app bar still lays out at 360pt with a live run', (tester) async {
    tester.view.physicalSize = const Size(360, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final client = _StubClient(_host)..live = true;
    await _openRun(tester, client, taskId: 't-1');

    // The widest the bar gets: Stop, Live, Explorer and Archive all present at once.
    expect(find.text('Stop'), findsOneWidget);
    expect(_iconButtonWithTooltip('Toggle Explorer sidebar'), findsOneWidget);
    expect(_iconButtonWithTooltip('Archive task'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await client.dispose();
  });
}
