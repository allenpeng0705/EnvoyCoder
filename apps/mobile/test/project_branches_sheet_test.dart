// The phone's branch sheet, over the two calls it actually sends.
//
// The phone never runs git: it names an operation and the daemon builds the argv (see
// `lib/widgets/project_branches_sheet.dart`). So what is worth pinning here is the *interaction* — the
// current branch marked and not pressable, a tap switching, a typed name creating, a detached HEAD said out
// loud, and a refusal rendered where the action was taken rather than swallowed.

import 'dart:async';

import 'package:envoydev_mobile/l10n/l10n.dart';
import 'package:envoydev_mobile/models/git.dart';
import 'package:envoydev_mobile/models/host.dart';
import 'package:envoydev_mobile/models/project_rail.dart';
import 'package:envoydev_mobile/services/host_client.dart';
import 'package:envoydev_mobile/widgets/project_branches_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/l10n.dart';

/// A client that answers the two git methods and remembers what it was asked.
class _StubClient extends HostClient {
  _StubClient(super.host);

  final List<({String method, Map<String, dynamic> params})> calls = [];

  /// When set, the next write fails with this message instead of answering a status.
  String? refuseWith;

  @override
  HostConnectionState get state => HostConnectionState.connected;

  @override
  Stream<HostConnectionState> get states => const Stream<HostConnectionState>.empty();

  @override
  Stream<Map<String, dynamic>> get events => const Stream<Map<String, dynamic>>.empty();

  @override
  Future<void> connectBest() async {}

  static Map<String, dynamic> status(String branch) => {
        'kind': 'git',
        'branch': branch,
        'detached': false,
        'ahead': 0,
        'behind': 0,
        'dirty': 0,
        'conflicted': false,
      };

  @override
  Future<Map<String, dynamic>> call(
    String method, [
    Map<String, dynamic> params = const {},
    Duration timeout = const Duration(seconds: 15),
  ]) async {
    calls.add((method: method, params: params));
    if (refuseWith != null) throw StateError(refuseWith!);
    switch (method) {
      case 'coder.gitCheckout':
        return status(params['branch'] as String);
      case 'coder.gitCreateBranch':
        return status(params['name'] as String);
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

const _project = ProjectInfo(
  id: 'p-1',
  path: '/repo',
  label: 'Repo A',
  hostId: 'local',
  addedAt: '2024-01-01T00:00:00.000Z',
  vcsKind: 'git',
);

class _Opened {
  GitStatusInfo? status;
  List<GitBranchInfo> branches = const [];
}

Future<_Opened> _openSheet(
  WidgetTester tester,
  _StubClient client, {
  required GitStatusInfo status,
  required List<GitBranchInfo> branches,
  Locale? locale,
}) async {
  final opened = _Opened();
  await pumpLocalized(
    tester,
    Scaffold(
      body: Builder(
        builder: (context) => TextButton(
          onPressed: () => unawaited(showProjectBranchesSheet(
            context: context,
            client: client,
            project: _project,
            status: status,
            branches: branches,
            onChanged: (next, list) {
              opened.status = next;
              opened.branches = list;
            },
          )),
          child: const Text('open'),
        ),
      ),
    ),
    locale: locale,
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  return opened;
}

GitStatusInfo _status({String? branch, bool detached = false}) => GitStatusInfo.fromJson({
      'kind': 'git',
      if (branch != null) 'branch': branch,
      'detached': detached,
      'ahead': 0,
      'behind': 0,
      'dirty': 0,
      'conflicted': false,
    });

const _branches = [
  GitBranchInfo(name: 'main', current: false),
  GitBranchInfo(name: 'work', current: true, upstream: 'origin/work'),
];

void main() {
  testWidgets('lists the branches, marks the current one, and switches on a tap', (tester) async {
    final client = _StubClient(_host);
    final opened = await _openSheet(tester, client, status: _status(branch: 'work'), branches: _branches);

    expect(find.text('Branches'), findsOneWidget);
    expect(find.text('main'), findsOneWidget);
    expect(find.text('work'), findsOneWidget);
    expect(find.byIcon(Icons.check), findsOneWidget);
    expect(find.text('origin/work'), findsOneWidget);

    await tester.tap(find.text('main'));
    await tester.pumpAndSettle();

    expect(client.calls.single.method, 'coder.gitCheckout');
    expect(client.calls.single.params, {'projectId': 'p-1', 'branch': 'main'});
    // The caller's chip follows the write, so the row behind the sheet is right without a second read.
    expect(opened.status?.branch, 'main');
    expect(find.text('Switched to main.'), findsOneWidget);

    await client.dispose();
  });

  testWidgets('creates the branch it was given, and shows it as current', (tester) async {
    final client = _StubClient(_host);
    final opened = await _openSheet(tester, client, status: _status(branch: 'work'), branches: _branches);

    await tester.enterText(find.byType(TextField), 'feature/thing');
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Create and switch'));
    await tester.pumpAndSettle();

    expect(client.calls.single.method, 'coder.gitCreateBranch');
    expect(client.calls.single.params, {'projectId': 'p-1', 'name': 'feature/thing'});
    expect(opened.status?.branch, 'feature/thing');
    // Added to the list rather than re-read: the branch git named is the branch the user sees.
    expect(find.text('feature/thing'), findsOneWidget);
    expect(find.text('Created feature/thing and switched to it.'), findsOneWidget);
    expect(tester.widget<TextField>(find.byType(TextField)).controller?.text, '');

    await client.dispose();
  });

  testWidgets('says a detached HEAD out loud', (tester) async {
    final client = _StubClient(_host);
    await _openSheet(
      tester,
      client,
      status: _status(branch: null, detached: true),
      branches: [const GitBranchInfo(name: 'main', current: false)],
    );

    expect(find.text('This repository is on a detached HEAD, so no branch is current.'), findsOneWidget);
    // And no branch is marked as current, because none is.
    expect(find.byIcon(Icons.check), findsNothing);

    await client.dispose();
  });

  testWidgets('shows a repository with no branches yet, rather than an empty list', (tester) async {
    final client = _StubClient(_host);
    await _openSheet(tester, client, status: _status(branch: null), branches: const []);
    expect(find.text('This repository has no branches yet.'), findsOneWidget);
    await client.dispose();
  });

  testWidgets('renders the daemon\'s refusal in place, and keeps the name it refused', (tester) async {
    final client = _StubClient(_host)..refuseWith = 'envoydev.git-branch-invalid: "a..b" cannot be a branch name.';
    await _openSheet(tester, client, status: _status(branch: 'work'), branches: _branches);

    await tester.enterText(find.byType(TextField), 'a..b');
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Create and switch'));
    await tester.pumpAndSettle();

    // The sentence, never the wire format; and the name stays so the user can edit it.
    final shown = tester.widget<Text>(find.textContaining('cannot be a branch name')).data;
    expect(shown, isNotNull);
    expect(shown, isNot(contains('envoydev.')));
    expect(shown, isNot(contains('envoydev.key')));
    expect(tester.widget<TextField>(find.byType(TextField)).controller?.text, 'a..b');

    await client.dispose();
  });

  testWidgets('is the window\'s wording, in the phone\'s language', (tester) async {
    final client = _StubClient(_host);
    await _openSheet(
      tester,
      client,
      status: _status(branch: 'work'),
      branches: _branches,
      locale: const Locale('de'),
    );

    final de = lookupAppLocalizations(const Locale('de'));
    expect(find.text(de.gitBranchesTitle), findsOneWidget);
    expect(find.text(de.gitBranchesCreate), findsOneWidget);
    // Asserted on a sentence that is *worded* differently rather than on a loanword: German keeps
    // "Branches" as the heading, which is correct and would make the obvious check vacuous.
    expect(de.gitBranchesCreate, isNot('Create and switch'));
    expect(de.gitBranchesDetachedChip, isNot('No branch'));

    await client.dispose();
  });
}
