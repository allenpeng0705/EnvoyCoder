// Renaming a task from its row, and the rule that makes it safe: the write is real, and the row
// follows the daemon rather than the other way round.
//
// The desktop task row offers Rename and a removal (`CoderSidebar.tsx:557-583`); the mobile row now
// offers the same two behind its `…`. Removal's own behaviour is pinned in `project_removal_test.dart`
// — this file is about Rename:
//
//   * it calls `coder.updateTask` with `{id, title}` (the protocol's rename,
//     `packages/protocol/src/rpc.ts:2050`; the store persists it at
//     `apps/desktop/src/daemon/store.ts:545`);
//   * it is **not** optimistic — while the call is in flight the old title is still on screen, and the
//     new one appears only after the daemon's answer;
//   * Cancel, a blank field, and a refused write all leave the old title exactly where it was, the
//     last of them with a sentence saying so.

import 'dart:async';

import 'package:envoydev_mobile/models/host.dart';
import 'package:envoydev_mobile/screens/project_list_screen.dart';
import 'package:envoydev_mobile/services/host_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// A daemon that keeps state, so a rename is visible to the refetch the screen does afterwards.
///
/// The same trade as `project_removal_test.dart`: a stub rather than a socket, because the real
/// `HostClient` starts a 30-second reconnect heartbeat that a `testWidgets` body fails for leaving
/// pending. It throws on any method the screen is not expected to call, so the test cannot pass by
/// serving an answer the real daemon would not.
class _StubClient extends HostClient {
  _StubClient(super.host, {List<Map<String, dynamic>>? tasks}) : tasks = List.of(tasks ?? const []);

  final List<Map<String, dynamic>> tasks;

  /// When set, the write refuses — the stand-in for an older daemon or a link that drops mid-call.
  bool failWrites = false;

  /// When set, `coder.updateTask` waits on it before answering — what lets the test look at the row
  /// *while* the write is in flight.
  Completer<void>? renameGate;

  final List<({String method, Map<String, dynamic> params})> calls = [];

  int writesTo(String method) => calls.where((c) => c.method == method).length;

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
      case 'coder.listProjects':
        return {
          'projects': [
            {
              'id': 'p-a',
              'path': '/repo-a',
              'label': 'Repo A',
              'hostId': 'local',
              'addedAt': '2024-01-01T00:00:00.000Z',
            },
          ],
        };
      case 'coder.listTasks':
        return {'tasks': List<Map<String, dynamic>>.from(tasks)};
      case 'coder.listHarnesses':
        return {'harnesses': <Map<String, dynamic>>[]};
      case 'coder.getSettings':
        return {'settings': <String, dynamic>{}};
      case 'coder.updateTask':
        if (failWrites) throw StateError('refused');
        final gate = renameGate;
        if (gate != null) await gate.future;
        final id = params['id'];
        final title = params['title'];
        final index = tasks.indexWhere((task) => task['id'] == id);
        if (index < 0) throw StateError('no such task $id');
        tasks[index] = {...tasks[index], 'title': title};
        return {'task': tasks[index]};
      default:
        throw StateError('the screen called $method, which this test does not expect');
    }
  }

  // `dispose` is inherited on purpose: it cancels the family client's heartbeat timer, and each test
  // disposes inside its body (see `_finish`).
}

const _host = CoderHost(
  id: 'h',
  label: 'Desk machine',
  endpoint: '192.168.1.9:4770',
  ownerId: 'o',
  app: 'EnvoyDev',
  token: 'tok',
);

const _task = {
  'id': 't-1',
  'projectId': 'p-a',
  'title': 'Fix the tests',
  'status': 'running',
  'updatedAt': '2024-01-03T00:00:00.000Z',
};

Future<void> _finish(HostClient client) => client.dispose();

Future<void> _drainSnackBar(WidgetTester tester) async {
  await tester.pump(const Duration(seconds: 5));
  await tester.pumpAndSettle();
}

Finder _taskMenuButton(String task) => find.byWidgetPredicate(
      (widget) => widget is PopupMenuButton && widget.tooltip == 'More actions for $task',
    );

/// The *dialog's* field. The project list has a search `TextField` of its own, so an unscoped
/// `find.byType(TextField)` matches two widgets and `enterText` refuses to guess.
Finder _dialogField() => find.descendant(
      of: find.byType(AlertDialog),
      matching: find.byType(TextField),
    );

Future<_StubClient> _pumpScreen(WidgetTester tester) async {
  final client = _StubClient(_host, tasks: [Map<String, dynamic>.from(_task)]);
  await tester.pumpWidget(
    MaterialApp(
      home: ProjectListScreen(
        host: _host,
        client: client,
        onOpenConnections: () {},
        onOpenNetworkStatus: () {},
        onShowSettings: (_, __) {},
      ),
    ),
  );
  await tester.pumpAndSettle();
  return client;
}

/// Open the row's `…`, choose Rename, and leave the dialog on screen.
///
/// The menu item is the short `Rename` (the row is already the task); the dialog it opens is titled
/// `Rename task`, because that is where the object has to be named.
Future<void> _openRenameDialog(WidgetTester tester) async {
  await tester.tap(_taskMenuButton('Fix the tests'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Rename'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('the dialog opens prefilled with the title, and Enter writes it through',
      (tester) async {
    final client = await _pumpScreen(tester);
    await _openRenameDialog(tester);

    // Prefilled: the user edits what the row says rather than retyping it.
    final field = tester.widget<TextField>(_dialogField());
    expect(field.controller?.text, 'Fix the tests');

    await tester.enterText(_dialogField(), 'Fix the flaky tests');
    // Enter is the commit path as well as the button — the desktop field's rule, kept here.
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();

    expect(client.writesTo('coder.updateTask'), 1);
    expect(
      client.calls.firstWhere((c) => c.method == 'coder.updateTask').params,
      {'id': 't-1', 'title': 'Fix the flaky tests'},
    );
    // The row shows the daemon's answer — the refetched list, not a local edit.
    expect(find.text('Fix the flaky tests'), findsOneWidget);
    expect(find.text('Fix the tests'), findsNothing);
    await _finish(client);
  });

  testWidgets('the row changes only after the daemon answers — nothing optimistic', (tester) async {
    final client = await _pumpScreen(tester);
    final gate = Completer<void>();
    client.renameGate = gate;

    await _openRenameDialog(tester);
    await tester.enterText(_dialogField(), 'Renamed while offline');
    await tester.tap(find.widgetWithText(FilledButton, 'Rename'));
    await tester.pumpAndSettle();

    // The call is out, and the row has not moved: the old title is still the only title on screen.
    expect(client.writesTo('coder.updateTask'), 1);
    expect(find.text('Fix the tests'), findsOneWidget);
    expect(find.text('Renamed while offline'), findsNothing);

    gate.complete();
    await tester.pumpAndSettle();

    // Only now, with the daemon's answer in hand, does the row change.
    expect(find.text('Renamed while offline'), findsOneWidget);
    expect(find.text('Fix the tests'), findsNothing);
    await _finish(client);
  });

  testWidgets('cancelling the rename changes nothing', (tester) async {
    final client = await _pumpScreen(tester);
    await _openRenameDialog(tester);

    await tester.enterText(_dialogField(), 'A name the user thought better of');
    await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
    await tester.pumpAndSettle();

    expect(client.writesTo('coder.updateTask'), 0);
    expect(find.text('Fix the tests'), findsOneWidget);
    expect(find.text('A name the user thought better of'), findsNothing);
    await _finish(client);
  });

  testWidgets('an emptied field is refused in the dialog, not written as a blank title',
      (tester) async {
    final client = await _pumpScreen(tester);
    await _openRenameDialog(tester);

    await tester.enterText(_dialogField(), '   ');
    await tester.tap(find.widgetWithText(FilledButton, 'Rename'));
    await tester.pumpAndSettle();

    // The dialog stays open and says why; nothing was written.
    expect(find.text('Enter a name for this task.'), findsOneWidget);
    expect(client.writesTo('coder.updateTask'), 0);
    expect(find.text('Fix the tests'), findsOneWidget);
    await _finish(client);
  });

  testWidgets('a failed rename leaves the old title visible, with a reason', (tester) async {
    final client = await _pumpScreen(tester);
    client.failWrites = true;

    await _openRenameDialog(tester);
    await tester.enterText(_dialogField(), 'Never stored');
    await tester.tap(find.widgetWithText(FilledButton, 'Rename'));
    await tester.pumpAndSettle();

    expect(client.writesTo('coder.updateTask'), 1);
    expect(find.text('Fix the tests'), findsOneWidget);
    expect(find.text('Never stored'), findsNothing);
    expect(find.text('Could not rename Fix the tests. The name is unchanged.'), findsOneWidget);
    await _drainSnackBar(tester);
    await _finish(client);
  });
}
