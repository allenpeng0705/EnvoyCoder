// Changing this task's agent from the run composer writes `coder.updateTask { harness }`.

import 'dart:async';

import 'package:envoydev_mobile/models/host.dart';
import 'package:envoydev_mobile/screens/run_screen.dart';
import 'package:envoydev_mobile/services/host_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class _RecordingClient extends HostClient {
  _RecordingClient(super.host);

  final List<Map<String, dynamic>> calls = [];
  final _events = StreamController<Map<String, dynamic>>.broadcast();

  @override
  HostConnectionState get state => HostConnectionState.connected;

  @override
  Stream<HostConnectionState> get states => const Stream<HostConnectionState>.empty();

  @override
  Stream<Map<String, dynamic>> get events => _events.stream;

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
      case 'coder.listHarnesses':
        return {
          'harnesses': [
            {
              'id': 'envoy-harness',
              'label': 'Envoy Harness',
              'capabilities': {'model': true},
              'models': {
                'kind': 'listed',
                'options': [
                  {'id': 'gpt-5', 'label': 'GPT-5'},
                ],
              },
              'availability': {'state': 'ready'},
            },
            {
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
            },
          ],
        };
      case 'coder.listTasks':
        return {
          'tasks': [
            {
              'id': 't-1',
              'projectId': 'p-1',
              'cwd': '/repo',
              'title': 'Fix the tests',
              'harness': 'envoy-harness',
              'status': 'idle',
            },
          ],
        };
      case 'coder.listRuns':
        return {
          'runs': [
            {'id': 'r-1', 'taskId': 't-1'},
          ],
        };
      case 'coder.tailRun':
        return {'events': <Map<String, dynamic>>[], 'live': false};
      case 'coder.updateTask':
        return {
          'task': {'id': params['id'], 'harness': params['harness']},
        };
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

void main() {
  testWidgets('picking a different agent writes this task\'s harness', (tester) async {
    final client = _RecordingClient(_host);
    await tester.pumpWidget(
      MaterialApp(
        home: RunScreen(
          client: client,
          runId: 'r-1',
          title: 'Fix the tests',
          taskId: 't-1',
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Envoy Harness'), findsOneWidget);

    await tester.tap(find.text('Envoy Harness'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('DeepSeek Harness'));
    await tester.pumpAndSettle();

    final updated = client.calls.where((call) => call['method'] == 'coder.updateTask').toList();
    expect(updated, isNotEmpty);
    expect((updated.last['params'] as Map)['harness'], 'deepseek-harness');

    await client.dispose();
  });
}
