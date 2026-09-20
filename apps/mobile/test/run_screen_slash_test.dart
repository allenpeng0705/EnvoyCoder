// `/` commands on the phone.
//
// The list is the **agent's**, not ours: ACP sends it as `available_commands_update` once a session
// exists, the daemon records it as a `run.commands` event, and both surfaces offer exactly what came
// back — which is why nothing here is hardcoded per agent, and why an agent that publishes no list
// (a plain `dsh` turn does not) offers none on either surface.
//
// These tests pin the phone's half of that contract: the list arrives on the live stream, a *reopened*
// task still offers it (the run's stored events are replayed), an empty list is a real answer rather
// than "we have not looked", and tapping a row writes the command into the composer.

import 'dart:async';

import 'package:envoydev_mobile/models/host.dart';
import 'package:envoydev_mobile/screens/run_screen.dart';
import 'package:envoydev_mobile/services/host_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// A run whose events the test drives, and whose history it can predetermine.
class _StubClient extends HostClient {
  _StubClient(super.host, {this.history = const []});

  /// What `coder.tailRun` answers with — the events a reopened task replays.
  final List<Map<String, dynamic>> history;

  final _events = StreamController<Map<String, dynamic>>.broadcast();

  @override
  HostConnectionState get state => HostConnectionState.connected;

  @override
  Stream<HostConnectionState> get states => const Stream<HostConnectionState>.empty();

  @override
  Stream<Map<String, dynamic>> get events => _events.stream;

  @override
  Future<void> connectBest() async {}

  /// What a run's session published, as the daemon records it: the family's event envelope, and an
  /// event that names this run — the screen ignores both a foreign frame and another run's events.
  void sendCommands(List<Map<String, dynamic>> commands) {
    _events.add({
      'event': 'coder:run-event',
      'data': {'kind': 'run.commands', 'runId': 'r-1', 'taskId': 't-1', 'commands': commands},
    });
  }

  @override
  Future<Map<String, dynamic>> call(
    String method, [
    Map<String, dynamic> params = const {},
    Duration timeout = const Duration(seconds: 15),
  ]) async {
    switch (method) {
      case 'coder.listHarnesses':
        return {'harnesses': <Map<String, dynamic>>[]};
      case 'coder.listTasks':
        return {'tasks': <Map<String, dynamic>>[]};
      case 'coder.listRuns':
        return {
          'runs': history.isEmpty ? <Map<String, dynamic>>[] : [{'id': 'r-1'}],
        };
      case 'coder.tailRun':
        return {'events': history, 'live': true};
      default:
        throw StateError('the screen called $method, which this test does not expect');
    }
  }

  @override
  Future<void> dispose() async {
    await _events.close();
    return super.dispose();
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

Future<void> _openRun(WidgetTester tester, _StubClient client) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => TextButton(
            onPressed: () => unawaited(
              Navigator.of(context).push<void>(
                MaterialPageRoute(
                  builder: (_) => RunScreen(
                    client: client,
                    runId: 'r-1',
                    title: 'Fix the tests',
                    taskId: 't-1',
                  ),
                ),
              ),
            ),
            child: const Text('open'),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
}

/// The composer is the screen's text field; the list appears above it as the draft becomes `/token`.
Future<void> _type(WidgetTester tester, String text) async {
  await tester.enterText(find.byType(TextField).last, text);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('the agent\'s published commands are offered while the draft is a /token', (tester) async {
    final client = _StubClient(_host);
    await _openRun(tester, client);

    client.sendCommands([
      {'name': 'model', 'description': 'Switch the model', 'argumentHint': '[id]'},
      {'name': 'provider', 'description': 'Switch the provider'},
    ]);
    await tester.pumpAndSettle();

    // Nothing is offered until the user types the slash: the list is an answer to a draft, not a menu.
    expect(find.textContaining('/model'), findsNothing);

    await _type(tester, '/');
    expect(find.text('/model [id]'), findsOneWidget);
    expect(find.text('/provider'), findsOneWidget);
    expect(find.text('Switch the model'), findsOneWidget);

    // Prefix match, the agent's order kept.
    await _type(tester, '/mo');
    expect(find.text('/model [id]'), findsOneWidget);
    expect(find.text('/provider'), findsNothing);

    // A space ends the command word — arguments are the user's, not a filter.
    await _type(tester, '/model gpt');
    expect(find.text('/model [id]'), findsNothing);

    await client.dispose();
  });

  testWidgets('tapping a command writes it into the composer, ready for its arguments',
      (tester) async {
    final client = _StubClient(_host);
    await _openRun(tester, client);
    client.sendCommands([
      {'name': 'compact', 'description': 'Trim the context'},
    ]);
    await tester.pumpAndSettle();

    await _type(tester, '/com');
    await tester.tap(find.text('/compact'));
    await tester.pumpAndSettle();

    expect(tester.widget<TextField>(find.byType(TextField).last).controller?.text, '/compact ');

    await client.dispose();
  });

  testWidgets('a reopened task still offers what its last session published', (tester) async {
    // The phone learns the list from the run's events, and a task opened after a restart replays them
    // through `coder.tailRun` — so the autocomplete is not a live-run-only feature.
    final client = _StubClient(_host, history: [
      {
        'kind': 'run.commands',
        'runId': 'r-1',
        'taskId': 't-1',
        'commands': [
          {'name': 'cost', 'description': 'What this session has cost'},
        ],
      },
    ]);
    await _openRun(tester, client);

    await _type(tester, '/');
    expect(find.text('/cost'), findsOneWidget);

    await client.dispose();
  });

  testWidgets('an agent that publishes nothing offers nothing', (tester) async {
    // An empty list is a real answer: it replaces an earlier one rather than being ignored, which is
    // the difference between "this agent has no commands" and "we have not looked".
    final client = _StubClient(_host);
    await _openRun(tester, client);
    client.sendCommands([
      {'name': 'model', 'description': 'Switch the model'},
    ]);
    await tester.pumpAndSettle();
    await _type(tester, '/');
    expect(find.text('/model'), findsOneWidget);

    client.sendCommands(const []);
    await tester.pumpAndSettle();
    await _type(tester, '/');
    expect(find.text('/model'), findsNothing);


    await client.dispose();
  });
}
