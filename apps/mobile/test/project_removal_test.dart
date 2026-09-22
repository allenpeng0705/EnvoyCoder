// Removal on the project list: Remove a project, and Remove a task.
//
// This is the owner's ask — "allow user to remove project or task on mobile" — and the two halves are
// deliberately *not* the same operation, because the protocol gives them different powers:
//
//   * `coder.removeProject` drops EnvoyDev's project row for good and archives that project's tasks
//     (`packages/protocol/src/rpc.ts:1899`, `apps/desktop/src/daemon/store.ts:487-504`). Nothing in the
//     user's folder is touched, but the project itself cannot be brought back — so it is "Remove", it
//     is the danger colour, and it is the one destructive action here.
//   * There is no task delete. The only task operation is `coder.archiveTask` (`rpc.ts:2086`), which
//     stamps `archivedAt` and can be reversed with `archived: false`. The menu item reads "Remove" (the
//     short list verb, the same word the desktop uses) and its confirm is not coloured as danger; the
//     *dialog* is what stays honest — it says the task leaves the list and its files are not touched.
//
// What this file pins, beyond the wording: a confirmation stands between the press and the write, a
// refusal leaves the row that still exists server-side exactly where it was (no optimistic drop), and
// the last project can be removed without stranding the screen.

import 'package:envoydev_mobile/models/host.dart';
import 'package:envoydev_mobile/screens/project_list_screen.dart';
import 'package:envoydev_mobile/screens/run_screen.dart';
import 'package:envoydev_mobile/services/host_client.dart';
import 'package:envoydev_mobile/theme/tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// A daemon that keeps state, so a write is visible to the refetch the screen does afterwards.
///
/// A stub rather than a socket: the real `HostClient` starts a 30-second reconnect heartbeat that a
/// `testWidgets` body fails for leaving pending. It throws on any method the screen is not expected to
/// call, so the test cannot pass by serving an answer the real daemon would not.
class _StubClient extends HostClient {
  _StubClient(
    super.host, {
    List<Map<String, dynamic>>? projects,
    List<Map<String, dynamic>>? tasks,
    List<Map<String, dynamic>>? harnesses,
  })  : projects = List.of(projects ?? const []),
        tasks = List.of(tasks ?? const []),
        harnesses = List.of(harnesses ?? const []);

  final List<Map<String, dynamic>> projects;
  final List<Map<String, dynamic>> tasks;
  final List<Map<String, dynamic>> harnesses;

  /// When set, the two write methods refuse — the stand-in for an older daemon (method not found) or a
  /// link that drops mid-call.
  bool failWrites = false;

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
        return {'projects': List<Map<String, dynamic>>.from(projects)};
      case 'coder.listTasks':
        return {'tasks': List<Map<String, dynamic>>.from(tasks)};
      case 'coder.listHarnesses':
        return {'harnesses': List<Map<String, dynamic>>.from(harnesses)};
      case 'coder.getSettings':
        return {'settings': <String, dynamic>{}};
      case 'coder.updateTask':
        if (failWrites) throw StateError('refused');
        final id = params['id'];
        final index = tasks.indexWhere((task) => task['id'] == id);
        if (index < 0) throw StateError('no such task $id');
        tasks[index] = {...tasks[index], ...params};
        return {'task': tasks[index]};
      case 'coder.removeProject':
        if (failWrites) throw StateError('refused');
        final id = params['id'];
        projects.removeWhere((project) => project['id'] == id);
        final archived = <Map<String, dynamic>>[];
        for (var i = 0; i < tasks.length; i++) {
          if (tasks[i]['projectId'] == id && tasks[i]['archivedAt'] == null) {
            tasks[i] = {...tasks[i], 'archivedAt': '2024-01-05T00:00:00.000Z'};
            archived.add(tasks[i]);
          }
        }
        return {'removed': id, 'archived': archived};
      case 'coder.archiveTask':
        if (failWrites) throw StateError('refused');
        final id = params['id'];
        final index = tasks.indexWhere((task) => task['id'] == id);
        if (index < 0) throw StateError('no such task $id');
        final archived = params['archived'] != false;
        tasks[index] = {
          ...tasks[index],
          'archivedAt': archived ? '2024-01-05T00:00:00.000Z' : null,
        };
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

const _projectA = {
  'id': 'p-a',
  'path': '/repo-a',
  'label': 'Repo A',
  'hostId': 'local',
  'addedAt': '2024-01-01T00:00:00.000Z',
};
const _projectB = {
  'id': 'p-b',
  'path': '/repo-b',
  'label': 'Repo B',
  'hostId': 'local',
  'addedAt': '2024-01-02T00:00:00.000Z',
};
const _taskA = {
  'id': 't-1',
  'projectId': 'p-a',
  'title': 'Fix the tests',
  'status': 'running',
  'updatedAt': '2024-01-03T00:00:00.000Z',
};

Future<void> _finish(HostClient client) => client.dispose();

/// Let a SnackBar's own dismissal timer run out, so the test does not end with a pending timer.
Future<void> _drainSnackBar(WidgetTester tester) async {
  await tester.pump(const Duration(seconds: 5));
  await tester.pumpAndSettle();
}

Finder _iconButtonWithTooltip(String tooltip) => find.byWidgetPredicate(
      (widget) => widget is IconButton && widget.tooltip == tooltip,
    );

/// A project row's `…`. The row's agent and its Remove moved in here, so every removal test starts by
/// opening this trigger.
Finder _projectMenuButton(String project) => find.byWidgetPredicate(
      (widget) => widget is PopupMenuButton && widget.tooltip == 'More actions for $project',
    );

/// A task row's `…`, which carries Rename and the removal that used to be a standalone button.
Finder _taskMenuButton(String task) => find.byWidgetPredicate(
      (widget) => widget is PopupMenuButton && widget.tooltip == 'More actions for $task',
    );

/// Open one project's `…`, then press the item with this label.
Future<void> _pressRowMenuItem(WidgetTester tester, String project, String item) async {
  await tester.tap(_projectMenuButton(project));
  await tester.pumpAndSettle();
  await tester.tap(find.text(item));
  await tester.pumpAndSettle();
}

/// Open one task's `…`, then press the item with this label.
Future<void> _pressTaskMenuItem(WidgetTester tester, String task, String item) async {
  await tester.tap(_taskMenuButton(task));
  await tester.pumpAndSettle();
  await tester.tap(find.text(item));
  await tester.pumpAndSettle();
}

Future<_StubClient> _pumpScreen(
  WidgetTester tester, {
  List<Map<String, dynamic>>? projects,
  List<Map<String, dynamic>>? tasks,
  List<Map<String, dynamic>>? harnesses,
}) async {
  final client = _StubClient(
    _host,
    projects: projects ?? [_projectA, _projectB],
    tasks: tasks ?? [_taskA],
    harnesses: harnesses,
  );
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

void main() {
  testWidgets('the row\'s … menu offers a labelled Remove, never a bare glyph', (tester) async {
    final client = await _pumpScreen(tester);

    // The trigger is the row's second and last control, named for the row it acts on.
    expect(_projectMenuButton('Repo A'), findsOneWidget);
    expect(find.bySemanticsLabel('More actions for Repo A'), findsOneWidget);
    // The standalone Remove the row used to carry is gone; Remove is a menu item now.
    expect(_iconButtonWithTooltip('Remove project Repo A'), findsNothing);

    await tester.tap(_projectMenuButton('Repo A'));
    await tester.pumpAndSettle();

    expect(find.text('Remove'), findsOneWidget);
    expect(find.widgetWithText(ListTile, 'Remove'), findsOneWidget);
    // The menu item wears the destructive glyph in the danger colour, and the item's own line names
    // the action — never a bare glyph.
    final leading = tester.widget<Icon>(
      find.descendant(
        of: find.widgetWithText(ListTile, 'Remove'),
        matching: find.byIcon(Icons.remove_circle_outline),
      ),
    );
    expect(leading.color, CoderColors.light.destructive);
    await _finish(client);
  });

  testWidgets('the task row\'s … menu offers Rename and Remove, never Delete', (tester) async {
    final client = await _pumpScreen(tester);

    // The row keeps exactly one trailing control (the `…`); the `>` chevron the owner asked to be
    // rid of is gone, and nothing took its place.
    expect(_taskMenuButton('Fix the tests'), findsOneWidget);
    expect(find.bySemanticsLabel('More actions for Fix the tests'), findsOneWidget);
    expect(find.byIcon(Icons.chevron_right), findsNothing);
    // The standalone Archive the row used to carry is gone; it is a menu item now.
    expect(_iconButtonWithTooltip('Archive task Fix the tests'), findsNothing);

    await tester.tap(_taskMenuButton('Fix the tests'));
    await tester.pumpAndSettle();

    // The parity the owner asked for: two actions, the same two the desktop task row offers — and the
    // short labels, because the row is already the task.
    expect(find.widgetWithText(ListTile, 'Rename'), findsOneWidget);
    expect(find.widgetWithText(ListTile, 'Remove'), findsOneWidget);
    // The operation is archive; the menu says Remove, and the *dialog* behind it is what stays honest
    // (see the task-removal test below). No screen may claim a delete the protocol does not have.
    expect(find.textContaining('Delete'), findsNothing);
    await _finish(client);
  });

  testWidgets('the task row\'s … menu can change this task\'s agent', (tester) async {
    final client = await _pumpScreen(
      tester,
      tasks: [
        {..._taskA, 'harness': 'envoy-harness'},
      ],
      harnesses: [
        {
          'id': 'envoy-harness',
          'label': 'Envoy Harness',
          'availability': {'state': 'ready'},
        },
        {
          'id': 'deepseek-harness',
          'label': 'DeepSeek Harness',
          'availability': {'state': 'ready'},
        },
      ],
    );

    await tester.tap(_taskMenuButton('Fix the tests'));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(ListTile, 'Change agent'), findsOneWidget);

    await tester.tap(find.text('Change agent'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('DeepSeek Harness'));
    await tester.pumpAndSettle();

    expect(client.writesTo('coder.updateTask'), 1);
    expect(
      client.calls.lastWhere((c) => c.method == 'coder.updateTask').params['harness'],
      'deepseek-harness',
    );
    await _finish(client);
  });

  testWidgets('a task row still opens its run screen by tapping the row', (tester) async {
    // The chevron was decorative, so removing it must not strand the run screen: the row's own tap is
    // the control that reaches it. This pins the replacement affordance rather than assuming it.
    final client = await _pumpScreen(
      tester,
      projects: [_projectA],
      tasks: [
        {..._taskA, 'runId': 'r-1'},
      ],
    );

    await tester.tap(find.text('Fix the tests'));
    await tester.pumpAndSettle();

    expect(find.byType(RunScreen), findsOneWidget);
    // The `…` was not what opened it.
    expect(client.writesTo('coder.archiveTask'), 0);
    await _finish(client);
  });

  testWidgets('Remove still confirms: the same wording, and cancelling changes nothing',
      (tester) async {
    final client = await _pumpScreen(tester);

    await _pressRowMenuItem(tester, 'Repo A', 'Remove');

    expect(find.text('Remove Repo A?'), findsOneWidget);
    // The consequence, in the user's language: the tasks are archived, the folder is untouched, and
    // the project itself does not come back.
    expect(find.textContaining('archived, not deleted'), findsOneWidget);
    expect(find.textContaining('nothing in that folder is touched'), findsOneWidget);
    expect(find.textContaining('cannot be undone'), findsOneWidget);

    await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
    await tester.pumpAndSettle();

    expect(find.text('Repo A'), findsOneWidget);
    expect(client.writesTo('coder.removeProject'), 0);
    await _finish(client);
  });

  testWidgets('confirming removal calls coder.removeProject and drops the row', (tester) async {
    final client = await _pumpScreen(tester);

    await _pressRowMenuItem(tester, 'Repo A', 'Remove');
    await tester.tap(find.widgetWithText(TextButton, 'Remove project'));
    await tester.pumpAndSettle();

    expect(client.writesTo('coder.removeProject'), 1);
    expect(
      client.calls.firstWhere((c) => c.method == 'coder.removeProject').params,
      {'id': 'p-a'},
    );
    expect(find.text('Repo A'), findsNothing);
    expect(find.text('Repo B'), findsOneWidget);
    // The project's one task went with it, and the answer says how many were archived rather than
    // leaving the user to guess whether the work survived.
    expect(find.text('Removed Repo A. 1 task was archived.'), findsOneWidget);
    await _drainSnackBar(tester);
    await _finish(client);
  });

  testWidgets('a failed removal leaves the row in place — nothing is optimistically dropped',
      (tester) async {
    final client = await _pumpScreen(tester);
    client.failWrites = true;

    await _pressRowMenuItem(tester, 'Repo A', 'Remove');
    await tester.tap(find.widgetWithText(TextButton, 'Remove project'));
    await tester.pumpAndSettle();

    // The write was attempted...
    expect(client.writesTo('coder.removeProject'), 1);
    // ...and the row that still exists server-side is still on screen, with a reason.
    expect(find.text('Repo A'), findsOneWidget);
    expect(find.text('Could not remove Repo A. It is still in the list.'), findsOneWidget);
    await _drainSnackBar(tester);
    await _finish(client);
  });

  testWidgets('removing the last project lands on the empty state, not a stranded screen',
      (tester) async {
    final client = await _pumpScreen(tester, projects: [_projectA], tasks: const []);

    await _pressRowMenuItem(tester, 'Repo A', 'Remove');
    await tester.tap(find.widgetWithText(TextButton, 'Remove project'));
    await tester.pumpAndSettle();

    expect(
      find.text('No projects yet — add a folder on this computer.'),
      findsOneWidget,
    );
    // The way forward the empty state already offered is still there.
    expect(find.widgetWithText(FilledButton, 'Add project'), findsOneWidget);
    await _drainSnackBar(tester);
    await _finish(client);
  });

  testWidgets('Remove confirms truthfully, then calls coder.archiveTask and drops the row',
      (tester) async {
    final client = await _pumpScreen(tester);

    await _pressTaskMenuItem(tester, 'Fix the tests', 'Remove');

    // The label is a list verb; the sentence behind it is the operation's truth, and it is what
    // stops "Remove" from reading as a delete.
    expect(find.text('Remove Fix the tests?'), findsOneWidget);
    expect(find.textContaining('archiving is not deletion'), findsOneWidget);

    await tester.tap(find.widgetWithText(TextButton, 'Remove'));
    await tester.pumpAndSettle();

    expect(client.writesTo('coder.archiveTask'), 1);
    expect(
      client.calls.firstWhere((c) => c.method == 'coder.archiveTask').params,
      {'id': 't-1', 'archived': true},
    );
    expect(find.text('Fix the tests'), findsNothing);
    expect(find.text('No tasks in this project yet'), findsWidgets);
    await _finish(client);
  });

  testWidgets('cancelling the task removal dialog changes nothing', (tester) async {
    final client = await _pumpScreen(tester);

    await _pressTaskMenuItem(tester, 'Fix the tests', 'Remove');
    await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
    await tester.pumpAndSettle();

    expect(client.writesTo('coder.archiveTask'), 0);
    expect(find.text('Fix the tests'), findsOneWidget);
    await _finish(client);
  });

  testWidgets('a failed task removal leaves the task in place', (tester) async {
    final client = await _pumpScreen(tester);
    client.failWrites = true;

    await _pressTaskMenuItem(tester, 'Fix the tests', 'Remove');
    await tester.tap(find.widgetWithText(TextButton, 'Remove'));
    await tester.pumpAndSettle();

    expect(client.writesTo('coder.archiveTask'), 1);
    expect(find.text('Fix the tests'), findsOneWidget);
    expect(find.text('Could not remove Fix the tests. It is still in the list.'), findsOneWidget);
    await _drainSnackBar(tester);
    await _finish(client);
  });

  testWidgets('the project and task rows lay out at 320pt without overflow', (tester) async {
    // 320pt is the narrowest phone this app claims to support, and the width the row was reported to
    // overflow at back when three trailing controls shared it. The project row shares two (`+` and
    // `…`) and the task row is down to **one** (`…`, with the `>` chevron removed), so the question this
    // test answers is whether either *row* overflows here — a reduction should only help.
    //
    // It cannot simply assert "no exception": the **top bar** overflows at 320pt regardless, a
    // pre-existing bug in a region this change does not touch — its title Row (status dot + host
    // label) is squeezed to nothing by `Connections` + `Add host` + `More` and reports 5.1pt. So the
    // test captures every rendering error and attributes it, failing if *any* of them is a row's.
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final reported = <FlutterErrorDetails>[];
    final original = FlutterError.onError;
    FlutterError.onError = reported.add;
    addTearDown(() => FlutterError.onError = original);

    final client = await _pumpScreen(tester, projects: [_projectA, _projectB], tasks: [_taskA]);

    // Both rows' controls are still present and still laid out at this width, and the task row's
    // trailing area is now the `…` alone.
    expect(_iconButtonWithTooltip('New task in Repo A'), findsOneWidget);
    expect(_projectMenuButton('Repo A'), findsOneWidget);
    expect(_taskMenuButton('Fix the tests'), findsOneWidget);
    expect(find.byIcon(Icons.chevron_right), findsNothing);

    final creators = [
      for (final details in reported)
        if (details.exceptionAsString().contains('overflowed')) _creatorOf(details),
    ];
    // The row's trailing Row or the leading Row would appear here as `Row ← … ListTile`; nothing from
    // either row may. What is allowed is the top bar's own title Row, and at most that one.
    expect(
      creators.where((creator) => !creator.contains('_AppBarTitleBox')),
      isEmpty,
      reason: creators.join('\n'),
    );
    expect(creators.length, lessThanOrEqualTo(1), reason: creators.join('\n'));

    await _finish(client);
  });
}

/// The `debugCreator` line out of a rendering error's information, which is what names the widget that
/// overflowed (`Row ← _AppBarTitleBox ← …`).
String _creatorOf(FlutterErrorDetails details) {
  final nodes = details.informationCollector?.call();
  if (nodes == null) return '<no details>';
  for (final node in nodes) {
    final text = node.toString();
    if (text.startsWith('debugCreator:')) return text;
  }
  return '<no creator>';
}
