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

  /// What a fetch or a pull brought, as git's own summary. Empty is "nothing new".
  String summary = '';

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

  /// A repository with a merge stopped in it, conflicts and all.
  static Map<String, dynamic> merging(String branch, {required bool resolved}) => {
        ...status(branch),
        'dirty': 1,
        'conflicted': !resolved,
        'merge': {'branch': 'main'},
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
      case 'coder.gitMerge':
        return status('work');
      case 'coder.gitFetch':
        return {...status('work'), 'summary': summary};
      case 'coder.gitPull':
        return {...status('work'), 'summary': summary};
      case 'coder.gitMergeResolve':
        return {
          ...merging('work', resolved: false),
          'outcome': 'resolving',
          'files': ['a.txt'],
          'task': {'title': 'Resolve the merge of ${params['branch']}'},
          'run': {'id': 'r-1'},
        };
      case 'coder.gitMergeContinue':
        return status('work');
      case 'coder.gitMergeAbort':
        return status('work');
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

GitStatusInfo _merging({required bool resolved, String? branch = 'work'}) =>
    GitStatusInfo.fromJson(_StubClient.merging(branch ?? 'work', resolved: resolved));

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

  testWidgets('merges a branch into the one the project is on', (tester) async {
    final client = _StubClient(_host);
    await _openSheet(tester, client, status: _status(branch: 'work'), branches: _branches);

    // Offered on the branch you merge *from*, and never on the current one.
    expect(find.byTooltip('Merge work into work'), findsNothing);
    await tester.tap(find.byTooltip('Merge main into work'));
    await tester.pumpAndSettle();

    expect(client.calls.single.method, 'coder.gitMerge');
    expect(client.calls.single.params, {'projectId': 'p-1', 'branch': 'main'});
    expect(find.text('Merged main into work.'), findsOneWidget);

    await client.dispose();
  });

  testWidgets('shows a conflicted merge in the user\'s language, with the files', (tester) async {
    // The daemon undoes the merge before it answers, so the sentence can promise the repository is untouched.
    // **The fixture has to agree with itself.** `status.branch` and the branch list's `current` flag are two
    // readings of one fact, and a test where they disagree is a test of a state git cannot produce — the sheet
    // offered the merge on one row and refused it, correctly, because the row it was offered on was current.
    final de = lookupAppLocalizations(const Locale('de'));
    final tooltip = de.gitMergeInto('main', 'work');
    final client = _StubClient(_host)
      ..refuseWith =
          'envoydev.git-merge-conflict: main cannot be merged automatically. These files conflict: a.txt. '
          '[envoydev.key] {"key":"error.gitMergeConflict","values":{"branch":"main","files":"a.txt"}}';
    await _openSheet(
      tester,
      client,
      status: _status(branch: 'work'),
      branches: _branches,
      locale: const Locale('de'),
    );

    // The sheet is in German here, so the *tooltip* is German too: found by its glyph, asserted by its words.
    expect(find.byTooltip(tooltip), findsOneWidget);
    await tester.tap(find.byIcon(Icons.merge_outlined));
    await tester.pumpAndSettle();

    expect(client.calls.single.method, 'coder.gitMerge');
    expect(find.text(de.errorGitMergeConflict('main', 'a.txt')), findsOneWidget);
    expect(de.errorGitMergeConflict('main', 'a.txt'), contains('a.txt'));
    // Never the wire format, and never the English fallback for a key this build has.
    expect(find.textContaining('envoydev.'), findsNothing);
    expect(find.textContaining('cannot be merged automatically'), findsNothing);

    await client.dispose();
  });

  testWidgets('fetches and pulls, and says when there was nothing to bring', (tester) async {
    final client = _StubClient(_host);
    final opened = await _openSheet(tester, client, status: _status(branch: 'work'), branches: _branches);

    // Nothing new: git says nothing, and the phone says so in its own words rather than leaving the sentence
    // hanging after "Fetched.".
    await tester.tap(find.text('Fetch'));
    await tester.pumpAndSettle();
    expect(find.text('Fetched. Nothing new.'), findsOneWidget);
    expect(opened.status?.branch, 'work');
    // **Snackbars queue**, so the fetch's has to be gone before the pull's can be read.
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();

    client.summary = 'Fast-forward src/a.txt | 2 +-';
    await tester.tap(find.text('Pull'));
    await tester.pumpAndSettle();
    expect(find.text('Pulled. Fast-forward src/a.txt | 2 +-'), findsOneWidget);

    await client.dispose();
  });

  testWidgets('shows a diverged pull as a choice rather than a failure', (tester) async {
    final client = _StubClient(_host)
      ..refuseWith =
          'envoydev.git-pull-diverged: The branch on the computer and the one on the remote have both '
          'changed. [envoydev.key] {"key":"error.gitPullDiverged"}';
    await _openSheet(
      tester,
      client,
      status: _status(branch: 'main'),
      branches: _branches,
      locale: const Locale('de'),
    );

    await tester.tap(find.text('Pull'));
    await tester.pumpAndSettle();

    final de = lookupAppLocalizations(const Locale('de'));
    expect(find.text(de.errorGitPullDiverged), findsOneWidget);
    expect(find.textContaining('envoydev.'), findsNothing);

    await client.dispose();
  });

  testWidgets('offers to resolve a conflict with an agent, naming the branch that conflicted', (tester) async {
    // The refusal that names the files now has one more act under it. The *key* on the wire is how the sheet
    // knows this is that refusal — reading the prose would be parsing a sentence a translator owns.
    final client = _StubClient(_host)
      ..refuseWith =
          'envoydev.git-merge-conflict: main cannot be merged automatically. These files conflict: a.txt. '
          '[envoydev.key] {"key":"error.gitMergeConflict","values":{"branch":"main","files":"a.txt"}}';
    await _openSheet(tester, client, status: _status(branch: 'work'), branches: _branches);

    await tester.tap(find.byTooltip('Merge main into work'));
    await tester.pumpAndSettle();
    expect(find.textContaining('cannot be merged automatically'), findsOneWidget);

    // The conflict refusal was a *one-off*: the resolve call is the one that now has to get through.
    client.refuseWith = null;
    await tester.tap(find.text('Resolve with an agent'));
    await tester.pumpAndSettle();
    expect(client.calls.any((call) => call.method == 'coder.gitMergeResolve'), isTrue);
    expect(find.text('An agent is resolving this merge: Resolve the merge of main.'), findsOneWidget);
    // And the block that goes with it: a merge is in progress, so Finish and Abort are here.
    expect(find.text('The merge of main stopped with conflicts.'), findsOneWidget);
    // **The offer is gone.** It was about a conflict that is now in an agent's hands; leaving it would offer a
    // press the daemon can only refuse (a second resolve meets the merge the first one started).
    expect(find.text('Resolve with an agent'), findsNothing);

    await client.dispose();
  });

  testWidgets('keeps the merge state on screen, with Finish off until it is resolved', (tester) async {
    final client = _StubClient(_host);
    await _openSheet(
      tester,
      client,
      status: _merging(resolved: false),
      branches: _branches,
    );

    expect(find.text('The merge of main stopped with conflicts.'), findsOneWidget);
    expect(find.text('All conflicts are resolved. Finish the merge to record it.'), findsNothing);
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Finish the merge')).onPressed, isNull);

    await tester.tap(find.text('Abort the merge'));
    await tester.pumpAndSettle();
    expect(client.calls.any((call) => call.method == 'coder.gitMergeAbort'), isTrue);
    expect(find.text('The merge was aborted, and nothing was merged.'), findsOneWidget);

    await client.dispose();
  });

  testWidgets('records a resolved merge, and says so', (tester) async {
    final client = _StubClient(_host);
    await _openSheet(
      tester,
      client,
      // What the agent's work leaves behind: every conflict staged, and `MERGE_HEAD` still there.
      status: _merging(resolved: true),
      branches: _branches,
    );

    expect(find.text('All conflicts are resolved. Finish the merge to record it.'), findsOneWidget);
    await tester.tap(find.text('Finish the merge'));
    await tester.pumpAndSettle();
    expect(client.calls.any((call) => call.method == 'coder.gitMergeContinue'), isTrue);
    expect(find.text('The merge was recorded.'), findsOneWidget);

    await client.dispose();
  });

  testWidgets('a German phone reads the conflict refusal in German', (tester) async {
    final client = _StubClient(_host)
      ..refuseWith =
          'envoydev.git-merge-unresolved: A merge is not finished: a.txt still has conflicts. '
          '[envoydev.key] {"key":"error.gitMergeUnresolved","values":{"files":"a.txt"}}';
    await _openSheet(
      tester,
      client,
      status: _merging(resolved: false),
      branches: _branches,
      locale: const Locale('de'),
    );

    // Abort is refused — the daemon will not take back a merge whose conflicts are still there — and the
    // sentence the user reads is the German one the phone renders from the key, not the daemon's English.
    final de = lookupAppLocalizations(const Locale('de'));
    await tester.tap(find.text(de.gitMergeAbort));
    await tester.pumpAndSettle();

    expect(find.text(de.errorGitMergeUnresolved('a.txt')), findsOneWidget);
    expect(find.textContaining('envoydev.'), findsNothing);

    await client.dispose();
  });
}
