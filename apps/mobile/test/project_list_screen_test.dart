// The restructured entry screen, pinned: the two top-bar controls, the project row's two-control
// trailing area (a `+` and a `…`), the letter mark the desktop rail leads with, and the two things
// the owner asked to be gone — the "Connected <address>" row and the floating New-task button.
//
// A widget test cannot prove a task starts (that needs a daemon, and `new_task_sheet`'s own flow is
// not under test here); what it can prove is that the screen offers the *right* entry points, offers
// no third one, and no longer offers the removed ones. That is exactly the change under review, so it
// is what is pinned.

import 'dart:async';

import 'package:envoydev_mobile/models/host.dart';
import 'package:envoydev_mobile/screens/connections_sheet.dart';
import 'package:envoydev_mobile/screens/project_list_screen.dart';
import 'package:envoydev_mobile/services/connections_controller.dart';
import 'package:envoydev_mobile/services/host_client.dart';
import 'package:envoydev_mobile/services/host_store.dart';
import 'package:envoydev_mobile/theme/project_mark.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support/memory_secure_storage.dart';

/// The daemon's answers, as the screen asks for them.
///
/// A stub rather than a real `HostClient` with a fake socket, and that is a deliberate trade: the
/// real client starts a 30-second reconnect heartbeat, which `testWidgets` fails the test for leaving
/// pending. `host_client_test.dart` already owns proving the client dials and reconnects; this file
/// owns proving the *screen* offers the right controls, and the stub throws on anything the screen
/// does not legitimately call — so it cannot pass by serving a fixture the real daemon would not.
class _StubClient extends HostClient {
  _StubClient(super.host);

  static const _projects = [
    {
      'id': 'local::/repo-a',
      'path': '/repo-a',
      'label': 'Repo A',
      'hostId': 'local',
      'addedAt': '2024-01-01T00:00:00.000Z',
      // A project-level agent, so the row's `…` has a real name to show.
      'defaults': {'harness': 'envoy-harness'},
    },
    {
      'id': 'local::/repo-b',
      'path': '/repo-b',
      'label': 'Repo B',
      'hostId': 'local',
      'addedAt': '2024-01-02T00:00:00.000Z',
    },
    {
      // A lower-case label, so the mark's upper-casing is observable rather than assumed.
      'id': 'local::/envoymesh',
      'path': '/envoymesh',
      'label': 'envoymesh',
      'hostId': 'local',
      'addedAt': '2024-01-03T00:00:00.000Z',
    },
  ];

  static const _tasks = [
    {
      'id': 't-1',
      'projectId': 'local::/repo-a',
      'title': 'Fix the tests',
      'status': 'running',
      'updatedAt': '2024-01-03T00:00:00.000Z',
    },
    {
      'id': 't-2',
      'projectId': 'local::/repo-b',
      'title': 'Ship the thing',
      'status': 'needs-attention',
      'updatedAt': '2024-01-04T00:00:00.000Z',
    },
  ];

  @override
  HostConnectionState get state => HostConnectionState.connected;

  @override
  Stream<HostConnectionState> get states => const Stream<HostConnectionState>.empty();

  @override
  Stream<Map<String, dynamic>> get events => const Stream<Map<String, dynamic>>.empty();

  @override
  Future<Map<String, dynamic>> call(
    String method, [
    Map<String, dynamic> params = const {},
    Duration timeout = const Duration(seconds: 15),
  ]) async =>
      switch (method) {
        'coder.listProjects' => {'projects': _projects},
        'coder.listTasks' => {'tasks': _tasks},
        // One ready agent, so the `…` menu's agent item is enabled and names something.
        'coder.listHarnesses' => {
            'harnesses': [
              {
                'id': 'envoy-harness',
                'label': 'Envoy Harness',
                'capabilities': {'model': true},
                'availability': {'state': 'ready'},
              },
            ],
          },
        'coder.getSettings' => {'settings': <String, dynamic>{}},
        _ => throw StateError('the screen called $method, which this test does not expect'),
      };

  @override
  Future<void> connectBest() async {}

  // `dispose` is deliberately NOT overridden: the inherited one cancels the family client's heartbeat
  // timer. The stub silences the *dial*, not the cleanup.
}

/// Hand the client back and dispose it.
///
/// `addTearDown` is too late for this: `AutomatedTestWidgetsFlutterBinding` checks for pending timers
/// when the widget tree is disposed, which happens *before* registered tear-downs run — so a real
/// `HostClient` (whose constructor starts a 30-second sweep) fails the test body even when a tear-down
/// would have cleaned it up. Each test therefore disposes inside its own body, via this helper.
Future<void> _finish(HostClient client) => client.dispose();

const _host = CoderHost(
  id: 'h',
  label: 'Desk machine',
  endpoint: '192.168.1.9:4770',
  ownerId: 'o',
  app: 'EnvoyDev',
  token: 'tok',
);

/// The screen, with the two top-bar callbacks counted and the client handed back for disposal.
Future<({int connections, int addHost, HostClient client})> _pumpScreen(WidgetTester tester) async {
  var connections = 0;
  var addHost = 0;
  final client = _StubClient(_host);
  await tester.pumpWidget(
    MaterialApp(
      home: ProjectListScreen(
        host: _host,
        client: client,
        onOpenConnections: () => connections += 1,
        onAddHost: () => addHost += 1,
        onShowSettings: (_, __) {},
      ),
    ),
  );
  await tester.pumpAndSettle();
  return (connections: connections, addHost: addHost, client: client);
}

/// The one IconButton carrying this tooltip. `find.byTooltip` also matches the Semantics wrapper, so
/// the test finds the button itself and then looks inside it.
Finder _iconButtonWithTooltip(String tooltip) => find.byWidgetPredicate(
      (widget) => widget is IconButton && widget.tooltip == tooltip,
    );

/// A project row's `…`. `PopupMenuButton` is generic, so the check is on the raw type plus the tooltip
/// that names the row — the button and its accessibility name are the same fact, as on the desktop.
Finder _projectMenuButton(String project) => find.byWidgetPredicate(
      (widget) => widget is PopupMenuButton && widget.tooltip == 'More actions for $project',
    );

/// The letter tile for one project, by the id its tone is derived from.
Finder _projectMark(String projectId) => find.byWidgetPredicate(
      (widget) => widget is ProjectMark && widget.projectId == projectId,
    );

void main() {
  testWidgets('the top bar offers Connections and Add host, and leads to host management', (tester) async {
    var connections = 0;
    final client = _StubClient(_host);
    await tester.pumpWidget(
      MaterialApp(
        home: ProjectListScreen(
          host: _host,
          client: client,
          onOpenConnections: () => connections += 1,
          onAddHost: () {},
          onShowSettings: (_, __) {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Both controls exist...
    expect(find.widgetWithText(TextButton, 'Connections'), findsOneWidget);
    expect(_iconButtonWithTooltip('Add host'), findsOneWidget);
    expect(find.descendant(of: _iconButtonWithTooltip('Add host'), matching: find.byIcon(Icons.add_link)),
        findsOneWidget);
    // ...and the labelled one is the one that opens host management.
    await tester.tap(find.text('Connections'));
    await tester.pump();
    expect(connections, 1);
    await _finish(client);
  });

  testWidgets('the Connections button opens the host-management sheet', (tester) async {
    // The sheet's own behaviour — switching, forgetting — is pinned in `connections_sheet_test.dart`.
    // What this pins is the join: the button the owner asked for is wired to the repurposed list, not
    // to a callback that does nothing.
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final store = HostStore(prefs: prefs, secure: MemorySecureStorage());
    await store.upsert(_host);
    final controller = ConnectionsController(store)
      ..clientFactory = (host) => _StubClient(host);
    await controller.load();

    final client = _StubClient(_host);
    late BuildContext screenContext;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) {
            screenContext = context;
            return ProjectListScreen(
              host: _host,
              client: client,
              onOpenConnections: () =>
                  unawaited(showConnectionsSheet(screenContext, controller)),
              onAddHost: () {},
              onShowSettings: (_, __) {},
            );
          },
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Connections'));
    await tester.pumpAndSettle();

    expect(find.byType(ConnectionsSheet), findsOneWidget);
    // It lists the paired host the controller holds, not an empty frame.
    expect(find.textContaining(_host.endpoint), findsWidgets);

    // Take the sheet down before the controller: a live sheet listens to the client's state stream,
    // and disposing the client underneath it would wait on that listener.
    await tester.pumpWidget(const SizedBox());
    controller.dispose();
    await _finish(client);
  });

  testWidgets('the removed "Connected <address>" row is not on the project list', (tester) async {
    final screen = await _pumpScreen(tester);

    // The label is a bare "Connected" today; the row it lived in also carried the endpoint. Neither
    // may be back: the machine's name and a status dot are in the title now.
    expect(find.text('Connected'), findsNothing);
    expect(find.text('192.168.1.9:4770'), findsNothing);
    expect(find.text('Desk machine'), findsOneWidget);
    await _finish(screen.client);
  });

  testWidgets('the floating New-task button is gone, and no project is preselected for you',
      (tester) async {
    final screen = await _pumpScreen(tester);

    expect(find.byType(FloatingActionButton), findsNothing);
    expect(find.text('New task'), findsNothing);
    await _finish(screen.client);
  });

  testWidgets('each project row carries exactly two trailing controls: + and …', (tester) async {
    final screen = await _pumpScreen(tester);

    for (final project in ['Repo A', 'Repo B', 'envoymesh']) {
      expect(_iconButtonWithTooltip('New task in $project'), findsOneWidget, reason: project);
      expect(_projectMenuButton(project), findsOneWidget, reason: project);
    }

    // The `+` the owner asked for, not the old add-a-task glyph.
    expect(
      find.descendant(of: _iconButtonWithTooltip('New task in Repo A'), matching: find.byIcon(Icons.add)),
      findsOneWidget,
    );
    // The two controls that used to make it three — the agent chip and the standalone Remove — are not
    // on the row any more. (Remove's glyph reappears inside the `…`, which is not open here.)
    expect(find.byIcon(Icons.remove_circle_outline), findsNothing);
    expect(find.text('Envoy'), findsNothing);
    await _finish(screen.client);
  });

  testWidgets('the + opens the create sheet for that project', (tester) async {
    final screen = await _pumpScreen(tester);

    // Tapping the project's own `+` opens the create sheet already on that project — the answer to
    // "which project?" is the row, so the sheet does not ask again.
    await tester.tap(_iconButtonWithTooltip('New task in Repo B'));
    await tester.pumpAndSettle();
    expect(find.text('New task'), findsOneWidget);
    final dropdown = tester.widget<DropdownButtonFormField<String>>(
      find.byType(DropdownButtonFormField<String>),
    );
    expect(dropdown.initialValue, 'local::/repo-b');
    await _finish(screen.client);
  });

  testWidgets('the … menu contains the model name and Remove', (tester) async {
    final screen = await _pumpScreen(tester);

    await tester.tap(_projectMenuButton('Repo A'));
    await tester.pumpAndSettle();

    // The name the row's agent chip used to carry, still readable — now one tap deeper, as the owner
    // asked. `HarnessInfo.badge` shortens "Envoy Harness" to "Envoy" on both surfaces.
    expect(find.text('Envoy'), findsOneWidget);
    expect(find.text('Change agent'), findsOneWidget);
    // Remove came along, and it is the same action the row used to offer, not a second wording.
    expect(find.text('Remove project'), findsOneWidget);

    // No other row's menu is open with it: Repo B has no project agent, so its `Agent` placeholder
    // would be on screen if this menu were not the one that was opened.
    expect(find.text('Agent'), findsNothing);
    await _finish(screen.client);
  });

  testWidgets('the … menu\'s agent item still opens the project agent picker', (tester) async {
    final screen = await _pumpScreen(tester);

    await tester.tap(_projectMenuButton('Repo A'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Change agent'));
    await tester.pumpAndSettle();

    // The picker the row's agent chip used to open is one tap deeper, not gone — and it is the same
    // sheet, named for the same project, listing the same `coder.listHarnesses` agents.
    expect(find.text('Agent for Repo A'), findsOneWidget);
    expect(find.text('Envoy Harness'), findsOneWidget);
    await _finish(screen.client);
  });

  testWidgets('the initial badge shows the right uppercase letter, in the desktop\'s tone',
      (tester) async {
    final screen = await _pumpScreen(tester);

    // `envoymesh` is lower case and has to read `E`. `Repo A` and `Repo B` both read `R`, because the
    // mark is the *label's* first character and not the distinguishing word in it — the desktop rule.
    expect(
      find.descendant(of: _projectMark('local::/envoymesh'), matching: find.text('E')),
      findsOneWidget,
    );
    expect(find.descendant(of: _projectMark('local::/repo-a'), matching: find.text('R')), findsOneWidget);
    expect(find.descendant(of: _projectMark('local::/repo-b'), matching: find.text('R')), findsOneWidget);

    // One mark per project, and its label is the project's own label — the tone is derived from the
    // id, so `project_mark_test.dart` can hold the mobile derivation against the desktop's. Three
    // different ids here pick three different tones, which is what keeps two `R`s apart on screen.
    expect(find.byType(ProjectMark), findsNWidgets(3));
    expect(
      ['local::/envoymesh', 'local::/repo-a', 'local::/repo-b'].map(projectToneFor).toSet().length,
      3,
    );
    expect(tester.widget<ProjectMark>(_projectMark('local::/envoymesh')).label, 'envoymesh');
    expect(projectToneFor('local::/envoymesh'), ProjectTone.teal);
    await _finish(screen.client);
  });

  testWidgets('project rows are separated by the theme\'s divider, and only between them',
      (tester) async {
    final screen = await _pumpScreen(tester);

    // Three projects: a line between the first and second and between the second and third, none
    // above the first or below the last — the desktop's `border-top` on every group but the first.
    expect(find.byType(Divider), findsNWidgets(2));
    for (final divider in tester.widgetList<Divider>(find.byType(Divider))) {
      // No colour, thickness or spacing of its own: the app theme's `dividerTheme` supplies all three
      // (`tokens.dart`: `colors.border`, 1, 1). `design_tokens_test.dart` pins that mapping.
      expect(divider.color, isNull);
      expect(divider.thickness, isNull);
      expect(divider.height, isNull);
    }
    await _finish(screen.client);
  });

  testWidgets('Add host is reachable from the top bar without opening Connections', (tester) async {
    var addHostCalls = 0;
    final client = _StubClient(_host);
    await tester.pumpWidget(
      MaterialApp(
        home: ProjectListScreen(
          host: _host,
          client: client,
          onOpenConnections: () {},
          onAddHost: () => addHostCalls += 1,
          onShowSettings: (_, __) {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(_iconButtonWithTooltip('Add host'));
    await tester.pump();
    expect(addHostCalls, 1);
    await _finish(client);
  });
}
