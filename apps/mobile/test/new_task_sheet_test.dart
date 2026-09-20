// The New-task sheet, after the owner's refinement and the agent-scope change.
//
// Two owner asks meet here.
//
// The earlier one: *"can we refine the pop up ui for 'New task', It's too crowded. First, no need to
// show the project... Second, the four buttons are not informative... The input field needn't be
// multi-line and needn't the attachment icon. The 'Start' button should be 'Add'."*
//
// The later one, which is why there are three chips and not four: *"the new task should follow the
// project's agent setting, not to have any default agent. The default agent is for project, not for
// task."* The Agent chip wrote a task-level `harness` into `coder.createTask`, so a task could run an
// agent its project did not use. It is gone; the sheet resolves the project's agent only to choose
// which model / mode / thinking options to offer, and never sends one.
//
// This file pins each half on the sheet itself, at the width it has to survive:
//
//   * opened from a project — the only path the app has — the picker is **not** there; the latent
//     no-project path still gets it;
//   * the three task chips read `Category: value` (the desktop's words, the desktop's "Default") under
//     an `Options for this task` header, and the **agent is not among them**;
//   * the agent the chips render against is the **project's**, not the first offered;
//   * `coder.createTask` carries **no** `harness`, so the daemon resolves the project's agent;
//   * the input is one line, the paperclip is gone, and the primary button reads **Add**;
//   * and the whole sheet lays out at 320pt with no overflow.
//
// The project list's own tests cover the `+` that opens it; this file owns what is inside.

import 'dart:async';

import 'package:envoydev_mobile/models/harness.dart';
import 'package:envoydev_mobile/models/host.dart';
import 'package:envoydev_mobile/models/project_rail.dart';
import 'package:envoydev_mobile/screens/new_task_sheet.dart';
import 'package:envoydev_mobile/services/host_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// The sheet only reads; it calls the daemon when Add is pressed, which these tests do not. A call
/// therefore means the sheet did something it should not have, so it throws rather than guessing.
class _StubClient extends HostClient {
  _StubClient(super.host);

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
    throw StateError('the sheet called $method, which this test does not expect');
  }
}

/// A client that lets Add actually run, and remembers every call so a test can assert what the sheet
/// did and did not put on the wire.
class _RecordingClient extends HostClient {
  _RecordingClient(super.host);

  final List<Map<String, dynamic>> calls = [];

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
    calls.add({'method': method, 'params': params});
    switch (method) {
      case 'coder.createTask':
        return {
          'task': {
            'id': 't-new',
            'projectId': params['projectId'],
            'cwd': '/repo-a',
            'title': params['title'],
            'harness': 'envoy-harness',
            'status': 'idle',
            'createdAt': '2024-01-01T00:00:00.000Z',
            'updatedAt': '2024-01-01T00:00:00.000Z',
          },
        };
      case 'coder.startRun':
        // No run id: the sheet pops without pushing a RunScreen, which this test does not exercise.
        return {'run': <String, dynamic>{}};
      default:
        throw StateError('the sheet called $method, which this test does not expect');
    }
  }
}

const _host = CoderHost(
  id: 'h',
  label: 'Desk machine',
  endpoint: '192.168.1.9:4770',
  ownerId: 'o',
  app: 'EnvoyDev',
  token: 'tok',
);

const _projectA = ProjectInfo(
  id: 'p-a',
  path: '/repo-a',
  label: 'Repo A',
  hostId: 'local',
  addedAt: '2024-01-01T00:00:00.000Z',
  defaultHarness: 'envoy-harness',
);

/// No agent of its own — the app default is the fallback the daemon would use too.
const _projectB = ProjectInfo(
  id: 'p-b',
  path: '/repo-b',
  label: 'Repo B',
  hostId: 'local',
  addedAt: '2024-01-02T00:00:00.000Z',
);

/// An agent that is **not** first in the offered list, so a chip rendered for it proves the sheet
/// resolved the project's agent rather than `offered.first`.
const _projectC = ProjectInfo(
  id: 'p-c',
  path: '/repo-c',
  label: 'Repo C',
  hostId: 'local',
  addedAt: '2024-01-03T00:00:00.000Z',
  defaultHarness: 'deepseek-harness',
);

/// One agent that advertises three controls, so the sheet has three chips to render.
final _agent = HarnessInfo.fromJson(const {
  'id': 'envoy-harness',
  'label': 'Envoy Harness',
  'capabilities': {'model': true, 'agentMode': true, 'thinking': true},
  'modes': [
    {'id': 'plan', 'label': 'Plan'},
  ],
  'models': {
    'kind': 'listed',
    'options': [
      {'id': 'gpt-5', 'label': 'GPT-5'},
    ],
  },
  'thinking': {
    'kind': 'listed',
    'options': [
      {'value': 'high', 'label': 'High'},
    ],
  },
  'availability': {'state': 'ready'},
});

/// The second offered agent, with a model id of its own — the project that names it must show this
/// model, not Envoy's.
final _agentDeepSeek = HarnessInfo.fromJson(const {
  'id': 'deepseek-harness',
  'label': 'DeepSeek Harness',
  'capabilities': {'model': true},
  'models': {
    'kind': 'listed',
    'options': [
      {'id': 'deepseek/deepseek-chat', 'label': 'DeepSeek Chat'},
    ],
  },
  'availability': {'state': 'ready'},
});

/// A screen whose only job is to own a context for `showModalBottomSheet`.
class _SheetHost extends StatelessWidget {
  const _SheetHost({
    required this.client,
    required this.initialProjectId,
    this.harnesses = const [],
    this.appHarness,
  });

  final HostClient client;
  final String? initialProjectId;
  final List<HarnessInfo> harnesses;
  final String? appHarness;
  static const List<ProjectInfo> projects = [_projectA, _projectB, _projectC];

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => Center(
            child: TextButton(
              onPressed: () => unawaited(showNewTaskSheet(
                context: context,
                client: client,
                projects: projects,
                harnesses: harnesses,
                initialProjectId: initialProjectId,
                appHarness: appHarness,
              )),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );
  }
}

Future<void> _openSheet(WidgetTester tester, _SheetHost host) async {
  await tester.pumpWidget(host);
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('from a project: no picker, one-line input, no paperclip, an Add button',
      (tester) async {
    final client = _StubClient(_host);
    await _openSheet(
      tester,
      _SheetHost(client: client, initialProjectId: 'p-b', harnesses: [_agent]),
    );

    expect(find.text('New task'), findsOneWidget);
    // The project is implied by the row, so the sheet does not ask again.
    expect(find.byType(DropdownButtonFormField<String>), findsNothing);
    // The input is one line — a first message that becomes the task's title, not a paragraph box.
    final field = tester.widget<TextField>(find.byType(TextField));
    expect(field.maxLines, 1);
    // The paperclip is gone from this flow (the run screen's composer still has one).
    expect(find.byIcon(Icons.attach_file), findsNothing);
    expect(find.text('Attach'), findsNothing);
    // The verb is what this sheet does to the list.
    expect(find.widgetWithText(FilledButton, 'Add'), findsOneWidget);
    expect(find.text('Start'), findsNothing);

    await client.dispose();
  });

  testWidgets('the task chips say what they are, and the agent is not one of them', (tester) async {
    final client = _StubClient(_host);
    await _openSheet(
      tester,
      _SheetHost(
        client: client,
        initialProjectId: 'p-a',
        harnesses: [_agent],
        appHarness: 'envoy-harness',
      ),
    );

    // A header turns the row from decoration into an options block.
    expect(find.text('Options for this task'), findsOneWidget);
    // Category + value for the three *task* choices. The agent is a property of the project, so it
    // is not offered here at all — that is the whole point of this change.
    expect(find.text('Model: Default'), findsOneWidget);
    expect(find.text('Mode: Default'), findsOneWidget);
    expect(find.text('Thinking: Default'), findsOneWidget);
    expect(find.text('Agent: Envoy'), findsNothing);
    // The desktop's own sentence for the concept is the chip's tooltip.
    expect(
      tester.widget<ActionChip>(find.widgetWithText(ActionChip, 'Mode: Default')).tooltip,
      'What the agent is allowed to do in this task',
    );

    await client.dispose();
  });

  testWidgets('the chips are the project agent\'s, not the first one offered', (tester) async {
    final client = _StubClient(_host);
    // Envoy is offered first, but the project names DeepSeek. The chips must be DeepSeek's.
    await _openSheet(
      tester,
      _SheetHost(
        client: client,
        initialProjectId: 'p-c',
        harnesses: [_agent, _agentDeepSeek],
        appHarness: 'envoy-harness',
      ),
    );

    // DeepSeek publishes a model but no modes, so the Mode chip is absent — offered-first Envoy would
    // have shown one. This is the chip set of the project's agent, resolved through the project.
    expect(find.text('Model: Default'), findsOneWidget);
    expect(find.text('Mode: Default'), findsNothing);

    // And the picker offers DeepSeek's model, not the first offered agent's.
    await tester.tap(find.text('Model: Default'));
    await tester.pumpAndSettle();
    expect(find.text('DeepSeek Chat'), findsOneWidget);
    expect(find.text('GPT-5'), findsNothing);

    await client.dispose();
  });

  testWidgets('a new task carries no task-level agent: createTask is left to resolve the project',
      (tester) async {
    final client = _RecordingClient(_host);
    await _openSheet(
      tester,
      _SheetHost(
        client: client,
        initialProjectId: 'p-a',
        harnesses: [_agent],
        appHarness: 'envoy-harness',
      ),
    );

    await tester.enterText(find.byType(TextField), 'Fix the flaky test');
    await tester.tap(find.widgetWithText(FilledButton, 'Add'));
    await tester.pumpAndSettle();

    final created = client.calls.firstWhere((call) => call['method'] == 'coder.createTask');
    final params = created['params'] as Map<String, dynamic>;
    expect(params['projectId'], 'p-a');
    // The agent is the project's; the task does not have one of its own. Sending it here would store
    // the project's value *as if the task had chosen it*, which is the half of the owner's rule that
    // makes a later project change miss the task.
    expect(params.containsKey('harness'), isFalse);
    // Nothing in the create path writes an agent at all.
    for (final call in client.calls) {
      expect(
        (call['params'] as Map).containsKey('harness'),
        isFalse,
        reason: '${call['method']} must not write a harness',
      );
    }

    await client.dispose();
  });

  testWidgets('the picker is kept for the only path that needs it: no project preselected',
      (tester) async {
    final client = _StubClient(_host);
    await _openSheet(tester, _SheetHost(client: client, initialProjectId: null));

    // Nothing in the app opens the sheet this way yet, but the widget accepts it, and a sheet that
    // did not know its project would otherwise have no way to say which one.
    final dropdown = tester.widget<DropdownButtonFormField<String>>(
      find.byType(DropdownButtonFormField<String>),
    );
    expect(dropdown.initialValue, 'p-a');

    await client.dispose();
  });

  testWidgets('the sheet lays out at 320pt without overflow', (tester) async {
    // 320pt is the narrowest phone the app claims. The picker left and the field shrank; the chips
    // grew a category word and lost the agent one. This is the measurement that says the trade holds.
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final reported = <FlutterErrorDetails>[];
    final original = FlutterError.onError;
    FlutterError.onError = reported.add;
    addTearDown(() => FlutterError.onError = original);

    final client = _StubClient(_host);
    await _openSheet(
      tester,
      _SheetHost(
        client: client,
        initialProjectId: 'p-a',
        harnesses: [_agent],
        appHarness: 'envoy-harness',
      ),
    );

    // Everything asked for is still there at this width, and nothing overflowed.
    expect(find.text('Options for this task'), findsOneWidget);
    expect(find.text('Model: Default'), findsOneWidget);
    expect(find.text('Thinking: Default'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Add'), findsOneWidget);

    final overflows = [
      for (final details in reported)
        if (details.exceptionAsString().contains('overflowed')) details.exceptionAsString().trim(),
    ];
    expect(overflows, isEmpty, reason: overflows.join('\n'));

    // The measurement the report needs: the sheet's own height at 320pt. It has to fit a 640pt screen
    // with the keyboard up, and with the chips wrapping at this width it is the tightest case.
    final sheet = tester.getSize(find.descendant(
      of: find.byType(BottomSheet),
      matching: find.byType(SafeArea),
    ));
    final options = tester.getSize(find.byType(Wrap));
    final input = tester.getSize(find.byType(TextField));
    expect(sheet.width, 320);
    // ignore: avoid_print
    print('MEASURE sheet=${sheet.height} options=${options.height} input=${input.height}');
    // The options block is the thing that must not stack: three chips is two rows at this width. The
    // whole sheet has to leave room for a keyboard.
    expect(options.height, lessThan(140), reason: 'the chips stacked instead of gridding');
    expect(sheet.height, lessThan(380), reason: 'the sheet grew instead of shrinking');

    await client.dispose();
  });
}
