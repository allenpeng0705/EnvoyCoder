// The restructured entry screen, pinned: the top bar's three controls (a cell-tower status icon on
// the left, the connection name in the middle, Add host and the overflow on the right), how each of
// them is reached, the project row's two-control trailing area (a `+` and a `…`), the letter mark the
// desktop rail leads with, and the two things the owner asked to be gone — the "Connected <address>"
// row and the floating New-task button.
//
// A widget test cannot prove a task starts (that needs a daemon, and `new_task_sheet`'s own flow is
// not under test here); what it can prove is that the screen offers the *right* entry points, offers
// no third one, and no longer offers the removed ones. That is exactly the change under review, so it
// is what is pinned.

import 'dart:async';

import 'package:envoydev_mobile/models/host.dart';
import 'package:envoydev_mobile/screens/connections_sheet.dart';
import 'package:envoydev_mobile/screens/network_status_screen.dart';
import 'package:envoydev_mobile/screens/project_list_screen.dart';
import 'package:envoydev_mobile/services/connections_controller.dart';
import 'package:envoydev_mobile/services/host_client.dart';
import 'package:envoydev_mobile/services/host_store.dart';
import 'package:envoydev_mobile/theme/project_mark.dart';
import 'package:envoydev_mobile/theme/tokens.dart';
import 'package:envoydev_mobile/widgets/name_dialog.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
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
  _StubClient(super.host, {HostConnectionState initial = HostConnectionState.connected})
      : _state = initial;

  HostConnectionState _state;

  /// A real broadcast stream rather than `Stream.empty`. The top bar's status icon is now the one
  /// thing on this screen whose whole meaning is a transition (`connecting` is not `connected` is
  /// not `failed`), so the stream has to be a seam a test can drive. It is `sync` so a test's `emit`
  /// is reflected in the very next `pump`, with no microtask race between the two.
  final StreamController<HostConnectionState> _stateController =
      StreamController<HostConnectionState>.broadcast(sync: true);

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
  HostConnectionState get state => _state;

  @override
  Stream<HostConnectionState> get states => _stateController.stream;

  @override
  Stream<Map<String, dynamic>> get events => const Stream<Map<String, dynamic>>.empty();

  /// Move the link to [next] the way a real client's state stream would, so the top bar can be
  /// watched changing between the states rather than only observed in one of them.
  void emit(HostConnectionState next) {
    _state = next;
    _stateController.add(next);
  }

  /// Close the seam. `dispose` is deliberately NOT overridden (see below), so the test owns this.
  Future<void> closeStates() => _stateController.close();

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

/// The screen, with the top bar's host-switching callback counted and the client handed back for
/// disposal.
Future<({int connections, _StubClient client})> _pumpScreen(WidgetTester tester) async {
  var connections = 0;
  final client = _StubClient(_host);
  await tester.pumpWidget(
    MaterialApp(
      home: ProjectListScreen(
        host: _host,
        client: client,
        onOpenConnections: () => connections += 1,
        onOpenNetworkStatus: () {},
        onShowSettings: (_, __) {},
      ),
    ),
  );
  await tester.pumpAndSettle();
  return (connections: connections, client: client);
}

/// The one IconButton carrying this tooltip. `find.byTooltip` also matches the Semantics wrapper, so
/// the test finds the button itself and then looks inside it.
Finder _iconButtonWithTooltip(String tooltip) => find.byWidgetPredicate(
      (widget) => widget is IconButton && widget.tooltip == tooltip,
    );

/// The top bar's cell-tower status button, found by its tooltip shape rather than by one state's
/// exact wording, so the same finder works while the state changes.
Finder _statusButton() => find.byWidgetPredicate(
      (widget) =>
          widget is IconButton && (widget.tooltip?.startsWith('Network status for ') ?? false),
    );

/// What the top bar must say about [state]: the shared status-indicator colour from `CoderColors`,
/// the one cell-tower glyph EnvoyGo uses, and a tooltip and Semantics label that name the status.
void _expectStatusIcon(WidgetTester tester, CoderColors colors, HostConnectionState state) {
  final expected = switch (state) {
    HostConnectionState.connected => colors.statusDotSuccess,
    HostConnectionState.connecting => colors.statusDotRunning,
    HostConnectionState.reconnecting => colors.statusDotWarning,
    HostConnectionState.failed => colors.statusDotDanger,
    HostConnectionState.idle => colors.foregroundExtraMuted,
  };
  final label = 'Network status for ${_host.label} — ${state.label}';
  expect(find.byTooltip(label), findsOneWidget, reason: state.name);
  expect(find.bySemanticsLabel(label), findsOneWidget, reason: state.name);
  final icon = tester.widget<Icon>(
    find.descendant(of: _statusButton(), matching: find.byType(Icon)),
  );
  expect(icon.icon, Icons.cell_tower, reason: state.name);
  expect(icon.color, expected, reason: state.name);
}

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
  testWidgets('the top bar is status icon, name, + and Settings — no Connections label, no Add host',
      (tester) async {
    var connections = 0;
    var settings = 0;
    final client = _StubClient(_host);
    await tester.pumpWidget(
      MaterialApp(
        home: ProjectListScreen(
          host: _host,
          client: client,
          onOpenConnections: () => connections += 1,
          onOpenNetworkStatus: () {},
          onShowSettings: (_, __) => settings += 1,
        ),
      ),
    );
    await tester.pumpAndSettle();

    // The cell tower leads, the name is the middle, and the two direct actions trail.
    expect(_statusButton(), findsOneWidget);
    expect(find.text(_host.label), findsOneWidget);
    expect(_iconButtonWithTooltip('Add project'), findsOneWidget);
    expect(_iconButtonWithTooltip('Settings'), findsOneWidget);
    // The owner's removals: the labelled button, the Add-host shortcut and the overflow are all gone.
    expect(find.widgetWithText(TextButton, 'Connections'), findsNothing);
    expect(_iconButtonWithTooltip('Add host'), findsNothing);
    expect(find.byIcon(Icons.add_link), findsNothing);
    expect(find.byTooltip('More'), findsNothing);

    // Each trailing control is the real action, not a decoration.
    await tester.tap(_iconButtonWithTooltip('Settings'));
    await tester.pump();
    expect(settings, 1);
    await _finish(client);
  });

  testWidgets('the name opens the host-management sheet — the door the Connections button was',
      (tester) async {
    // The sheet's own behaviour — switching, forgetting — is pinned in `connections_sheet_test.dart`.
    // What this pins is the join: the name the owner substituted for the labelled button is wired to
    // the repurposed list, not to a callback that does nothing.
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
              onOpenNetworkStatus: () {},
              onShowSettings: (_, __) {},
            );
          },
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text(_host.label));
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

  testWidgets('the name is the switcher and the icon is the diagnostic: two callbacks, kept apart',
      (tester) async {
    var connections = 0;
    var status = 0;
    final client = _StubClient(_host);
    await tester.pumpWidget(
      MaterialApp(
        home: ProjectListScreen(
          host: _host,
          client: client,
          onOpenConnections: () => connections += 1,
          onOpenNetworkStatus: () => status += 1,
          onShowSettings: (_, __) {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Tapping the name switches hosts and does not open diagnostics...
    await tester.tap(find.text(_host.label));
    await tester.pump();
    expect(connections, 1);
    expect(status, 0);

    // ...and tapping the cell tower diagnoses and does not switch.
    await tester.tap(_statusButton());
    await tester.pump();
    expect(status, 1);
    expect(connections, 1);
    await _finish(client);
  });

  testWidgets('the status icon opens the network-status panel for the active host', (tester) async {
    final client = _StubClient(_host);
    late BuildContext screenContext;
    await tester.pumpWidget(
      MaterialApp(
        theme: const CoderTheme(CoderColors.light).toThemeData(),
        home: Builder(
          builder: (context) {
            screenContext = context;
            return ProjectListScreen(
              host: _host,
              client: client,
              onOpenConnections: () {},
              onOpenNetworkStatus: () => unawaited(showNetworkStatus(screenContext, client)),
              onShowSettings: (_, __) {},
            );
          },
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(_statusButton());
    await tester.pumpAndSettle();

    // The panel is up — and it is the active host's, which is the only host the icon could mean.
    expect(find.byType(NetworkStatusScreen), findsOneWidget);
    expect(find.text('Network status'), findsOneWidget);
    expect(find.text('Computer'), findsOneWidget);

    await tester.pumpWidget(const SizedBox());
    await client.closeStates();
    await _finish(client);
  });

  testWidgets('the status icon follows the real state: colour, tooltip and label per state',
      (tester) async {
    final screen = await _pumpScreen(tester);
    const colors = CoderColors.light;

    // The stub starts connected.
    _expectStatusIcon(tester, colors, HostConnectionState.connected);

    // The owner's "5G takes some time" case: connecting, reconnecting and failed are three different
    // colours and three different sentences — never collapsed into one grey.
    for (final state in [
      HostConnectionState.connecting,
      HostConnectionState.reconnecting,
      HostConnectionState.failed,
      HostConnectionState.idle,
    ]) {
      screen.client.emit(state);
      await tester.pump();
      _expectStatusIcon(tester, colors, state);
    }

    // Five states, five visibly different colours, so "at a glance" can actually tell them apart.
    final distinct = {
      for (final state in HostConnectionState.values)
        switch (state) {
          HostConnectionState.connected => colors.statusDotSuccess,
          HostConnectionState.connecting => colors.statusDotRunning,
          HostConnectionState.reconnecting => colors.statusDotWarning,
          HostConnectionState.failed => colors.statusDotDanger,
          HostConnectionState.idle => colors.foregroundExtraMuted,
        },
    };
    expect(distinct, hasLength(HostConnectionState.values.length));

    await screen.client.closeStates();
    await _finish(screen.client);
  });

  testWidgets('a long but legal connection name ellipsizes, full value in tooltip and Semantics',
      (tester) async {
    // 38 characters — inside the 40 the dialog allows, and far wider than a 320pt top bar title.
    const longName = "Shileipeng's MacBook Pro 16-inch (work)";
    expect(longName.length, lessThanOrEqualTo(kConnectionNameMaxLength));
    const host = CoderHost(
      id: 'h',
      label: longName,
      endpoint: '192.168.1.9:4770',
      ownerId: 'o',
      app: 'EnvoyDev',
      token: 'tok',
    );
    final client = _StubClient(host);
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        home: ProjectListScreen(
          host: host,
          client: client,
          onOpenConnections: () {},
          onOpenNetworkStatus: () {},
          onShowSettings: (_, __) {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    // The name is drawn, on one line, and actually truncated — `didExceedMaxLines` is the rendering
    // fact, not the widget's configuration, so removing the ellipsis fails this test.
    final paragraph = tester.renderObject<RenderParagraph>(
      find.descendant(of: find.byType(AppBar), matching: find.text(longName)),
    );
    expect(paragraph.maxLines, 1);
    expect(paragraph.didExceedMaxLines, isTrue);
    // Nothing is lost to a long-press or a screen reader: both carry the whole name.
    expect(find.byTooltip(longName), findsOneWidget);
    expect(find.bySemanticsLabel(RegExp('Switch connection — current: ')), findsOneWidget);
    // And the trailing actions are still on the bar.
    expect(_iconButtonWithTooltip('Add project'), findsOneWidget);
    expect(_iconButtonWithTooltip('Settings'), findsOneWidget);

    await _finish(client);
  });

  testWidgets('the top bar fits 320pt with a long name and the needs-you badge', (tester) async {
    // The tightest this bar gets: the cell tower, a user-set name, `+`, the gear, and the badge that
    // appears when a task needs an answer. The test font is square (Ahem), so the badge is wider here
    // than it is on a device — a pessimistic case, deliberately.
    //
    // Before this change the same width produced two overflows: the title Row by **5.1pt** and the
    // trailing actions Row by **110pt** when the badge was present. Neither may come back, and the
    // user-set name may not push the two trailing controls off the bar.
    const longName = "Shileipeng's MacBook Pro 16-inch (work)";
    const host = CoderHost(
      id: 'h',
      label: longName,
      endpoint: '192.168.1.9:4770',
      ownerId: 'o',
      app: 'EnvoyDev',
      token: 'tok',
    );
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final reported = <FlutterErrorDetails>[];
    final original = FlutterError.onError;
    FlutterError.onError = reported.add;
    addTearDown(() => FlutterError.onError = original);

    final client = _StubClient(host);
    await tester.pumpWidget(
      MaterialApp(
        home: ProjectListScreen(
          host: host,
          client: client,
          onOpenConnections: () {},
          onOpenNetworkStatus: () {},
          onShowSettings: (_, __) {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    // The badge is present — this is the worst case, not the calm one.
    expect(find.text('1 needs you'), findsOneWidget);
    // All four elements survive: nothing was pushed off the bar.
    expect(_statusButton(), findsOneWidget);
    expect(find.text(longName), findsOneWidget);
    expect(_iconButtonWithTooltip('Add project'), findsOneWidget);
    expect(_iconButtonWithTooltip('Settings'), findsOneWidget);

    final overflows = [
      for (final details in reported)
        if (details.exceptionAsString().contains('overflowed')) details.exceptionAsString().trim(),
    ];
    expect(overflows, isEmpty, reason: overflows.join('\n'));
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

  testWidgets('the top bar has no Add host any more; pairing lives in the Connections sheet',
      (tester) async {
    // The owner's refinement: Add host is the Connections sheet's first row now, so the bar has no
    // Add-host control at all. What the `+` on the bar does is Add project — a different action that
    // is pinned by the sheet it opens, not by the callback shape.
    final screen = await _pumpScreen(tester);

    expect(_iconButtonWithTooltip('Add host'), findsNothing);
    expect(find.byIcon(Icons.add_link), findsNothing);

    await tester.tap(_iconButtonWithTooltip('Add project'));
    await tester.pumpAndSettle();
    expect(find.text('Add project'), findsWidgets);
    await _finish(screen.client);
  });
}
