import 'package:envoydev_mobile/screens/explorer_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/l10n.dart';

Future<Map<String, dynamic>> _rpc(String method, [Map<String, dynamic> params = const {}]) async {
  if (method == 'coder.listHomeFsEntries') {
    final path = params['path'] as String? ?? '/repo';
    if (path == '/repo') {
      return {
        'path': '/repo',
        'entries': [
          {'name': 'src', 'kind': 'dir', 'path': '/repo/src'},
          {'name': 'node_modules', 'kind': 'dir', 'path': '/repo/node_modules'},
          {'name': '.git', 'kind': 'dir', 'path': '/repo/.git'},
          {'name': 'README.md', 'kind': 'file', 'path': '/repo/README.md'},
        ],
      };
    }
    if (path == '/repo/src') {
      return {
        'path': '/repo/src',
        'entries': [
          {'name': 'main.ts', 'kind': 'file', 'path': '/repo/src/main.ts'},
        ],
      };
    }
    return {'path': path, 'entries': <Map<String, dynamic>>[]};
  }
  if (method == 'coder.listWorktreeChanges') {
    return {
      'path': '/repo',
      'repo': true,
      'changes': [
        {'path': 'src/main.ts', 'kind': 'modified', 'staged': false, 'unstaged': true},
      ],
    };
  }
  if (method == 'coder.gitStashList') {
    return {'stashes': <Map<String, dynamic>>[]};
  }
  if (method == 'coder.gitStage' || method == 'coder.gitUnstage') {
    final staging = method == 'coder.gitStage';
    return {
      'changes': [
        {
          'path': 'src/main.ts',
          'kind': 'modified',
          'staged': staging,
          'unstaged': !staging,
        },
      ],
    };
  }
  if (method == 'coder.gitCommit') {
    return {
      'sha': 'abc1234def5678',
      'status': {'kind': 'git', 'branch': 'work', 'detached': false, 'ahead': 0, 'behind': 0, 'dirty': 0, 'conflicted': false},
      'changes': <Map<String, dynamic>>[],
    };
  }
  throw StateError('unexpected $method');
}

void main() {
  testWidgets('lists folders and files, and hides node_modules', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: ExplorerScreen(rpc: _rpc, root: '/repo')),
    );
    await tester.pumpAndSettle();

    expect(find.text('README.md'), findsOneWidget);
    expect(find.text('src'), findsOneWidget);
    expect(find.text('node_modules'), findsNothing);
    expect(find.text('.git'), findsNothing);

    await tester.tap(find.text('src'));
    await tester.pumpAndSettle();
    expect(find.text('main.ts'), findsOneWidget);

    await tester.tap(find.text('Parent folder'));
    await tester.pumpAndSettle();
    expect(find.text('README.md'), findsOneWidget);
  });

  testWidgets('lists changes, and says when the folder is not a git repository', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: ExplorerScreen(rpc: _rpc, root: '/repo')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Changes'));
    await tester.pumpAndSettle();
    expect(find.text('src/main.ts'), findsOneWidget);
    expect(find.text('Modified'), findsOneWidget);
  });

  testWidgets('says when the folder is not a git repository', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: ExplorerScreen(
          rpc: (method, [params = const {}]) async {
            if (method == 'coder.listHomeFsEntries') {
              return {'path': '/plain', 'entries': <Map<String, dynamic>>[]};
            }
            return {'path': '/plain', 'repo': false, 'changes': <Map<String, dynamic>>[]};
          },
          root: '/plain',
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Changes'));
    await tester.pumpAndSettle();
    expect(find.text('This folder is not a git repository.'), findsOneWidget);
  });

  testWidgets('the Changes tab stages, commits, and keeps the confirmation on screen', (tester) async {
    // The phone sends method calls; the desktop builds the argv. What is pinned here is that the tab offers
    // exactly the actions that would do something, and that a commit that empties the list still says so.
    await tester.pumpWidget(
      const MaterialApp(home: ExplorerScreen(rpc: _rpc, root: '/repo', projectId: 'p-1')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Changes'));
    await tester.pumpAndSettle();
    expect(find.text('src/main.ts'), findsOneWidget);

    // Unstaged, so the stage control is offered and the unstage one is not.
    expect(find.byTooltip('Stage src/main.ts'), findsOneWidget);
    expect(find.byTooltip('Unstage src/main.ts'), findsNothing);

    await tester.tap(find.byTooltip('Stage src/main.ts'));
    await tester.pumpAndSettle();
    expect(find.byTooltip('Unstage src/main.ts'), findsOneWidget);

    // The commit button is off until both facts hold: a message, and something in the index.
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Commit')).onPressed, isNull);
    await tester.enterText(find.byType(TextField), 'add the keys');
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Commit'));
    await tester.pumpAndSettle();

    // The list is empty now, and the confirmation is still there — it belongs to the repository, not the list.
    expect(find.text('No changes in this folder.'), findsOneWidget);
    expect(find.text('Committed abc1234.'), findsOneWidget);
  });

  testWidgets('without a project id the tab lists and diffs but offers no writes', (tester) async {
    // An embedded or older caller: the list is still worth showing, and a control whose press cannot work is
    // not offered at all.
    await tester.pumpWidget(
      const MaterialApp(home: ExplorerScreen(rpc: _rpc, root: '/repo')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Changes'));
    await tester.pumpAndSettle();

    expect(find.text('src/main.ts'), findsOneWidget);
    expect(find.byType(TextField), findsNothing);
    expect(find.byTooltip('Stage src/main.ts'), findsNothing);
    expect(find.text('Stash'), findsNothing);
  });

  testWidgets('sets the tree aside, and lists what is set aside', (tester) async {
    // The phone sends the method and the project; the desktop builds `git stash push -u` and measures the
    // repository afterwards. What is pinned here is that the answer *is* the screen's new state.
    final stashed = {
      'index': 0,
      'ref': 'stash@{0}',
      'message': 'WIP on work: 3c3a2b9 one',
      'at': DateTime.now().toUtc().toIso8601String(),
    };
    await tester.pumpWidget(
      localizedApp(
        ExplorerScreen(
          root: '/repo',
          projectId: 'p-1',
          rpc: (method, [params = const {}]) async {
            if (method == 'coder.gitStashPush') {
              return {
                'status': {'kind': 'git', 'branch': 'work', 'detached': false, 'ahead': 0, 'behind': 0, 'dirty': 0, 'conflicted': false},
                'changes': <Map<String, dynamic>>[],
                'stashes': [stashed],
              };
            }
            return _rpc(method, params);
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Changes'));
    await tester.pumpAndSettle();
    expect(find.text('src/main.ts'), findsOneWidget);

    await tester.tap(find.text('Stash'));
    await tester.pumpAndSettle();

    // The tree is empty, the confirmation says where the work went, and git's own subject is the row.
    expect(find.text('No changes in this folder.'), findsOneWidget);
    expect(find.text('Stashed.'), findsOneWidget);
    expect(find.text('Stashes'), findsOneWidget);
    expect(find.text('WIP on work: 3c3a2b9 one'), findsOneWidget);
  });

  testWidgets('puts a stash back, and asks before discarding one', (tester) async {
    const first = {'index': 0, 'ref': 'stash@{0}', 'message': 'WIP on work: 3c3a2b9 one'};
    const second = {'index': 1, 'ref': 'stash@{1}', 'message': 'WIP on work: 3c3a2b9 two'};
    final calls = <String>[];
    await tester.pumpWidget(
      localizedApp(
        ExplorerScreen(
          root: '/repo',
          projectId: 'p-1',
          rpc: (method, [params = const {}]) async {
            calls.add('$method ${params['index'] ?? ''}'.trim());
            if (method == 'coder.gitStashList') {
              return {'stashes': [first, second]};
            }
            if (method == 'coder.gitStashPop') {
              return {
                'status': {'kind': 'git', 'branch': 'work', 'detached': false, 'ahead': 0, 'behind': 0, 'dirty': 1, 'conflicted': false},
                'changes': [
                  {'path': 'src/main.ts', 'kind': 'modified', 'staged': false, 'unstaged': true},
                ],
                // **Renumbered**, exactly as git does: the stash that was second is now `stash@{0}`. The
                // screen must act on the list the daemon just answered with, never on a stale index.
                'stashes': [
                  {'index': 0, 'ref': 'stash@{0}', 'message': 'WIP on work: 3c3a2b9 two'},
                ],
              };
            }
            if (method == 'coder.gitStashDrop') {
              return {
                'status': {'kind': 'git', 'branch': 'work', 'detached': false, 'ahead': 0, 'behind': 0, 'dirty': 1, 'conflicted': false},
                'changes': <Map<String, dynamic>>[],
                'stashes': <Map<String, dynamic>>[],
              };
            }
            return _rpc(method, params);
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Changes'));
    await tester.pumpAndSettle();

    /// One control of one row: two stashes are on screen, and each has its own Put back and Discard.
    Finder action(String message, String label) => find.descendant(
          of: find.ancestor(of: find.text(message), matching: find.byType(ListTile)),
          matching: find.text(label),
        );

    // Putting the newest one back is one press; the daemon answers with both lists, and the row it was
    // about is gone while the older stash stays.
    await tester.tap(action('WIP on work: 3c3a2b9 one', 'Put back'));
    await tester.pumpAndSettle();
    expect(calls, contains('coder.gitStashPop 0'));
    expect(find.text('WIP on work: 3c3a2b9 one'), findsNothing);
    expect(find.text('WIP on work: 3c3a2b9 two'), findsOneWidget);

    // Discarding asks first — the question names the stash it is about, with that stash still on screen.
    await tester.tap(action('WIP on work: 3c3a2b9 two', 'Discard'));
    await tester.pumpAndSettle();
    expect(find.text('Discard this stash?'), findsOneWidget);
    expect(find.text('WIP on work: 3c3a2b9 two'), findsWidgets);
    expect(calls.where((call) => call.startsWith('coder.gitStashDrop')), isEmpty);

    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(calls.where((call) => call.startsWith('coder.gitStashDrop')), isEmpty);

    // And the second time, confirming destroys it.
    await tester.tap(action('WIP on work: 3c3a2b9 two', 'Discard'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Discard'));
    await tester.pumpAndSettle();
    expect(calls, contains('coder.gitStashDrop 0'));
    expect(find.text('WIP on work: 3c3a2b9 two'), findsNothing);
  });

  testWidgets('a stash refusal arrives in the phone\'s own language', (tester) async {
    // The daemon's English travels with its key; a German phone must read German. Before the renderer
    // existed this line was the daemon's English sentence on a German screen.
    await pumpLocalized(
      tester,
      ExplorerScreen(
        root: '/repo',
        projectId: 'p-1',
        rpc: (method, [params = const {}]) async {
          if (method == 'coder.gitStashList') {
            return {
              'stashes': [
                {'index': 0, 'ref': 'stash@{0}', 'message': 'WIP on work: 3c3a2b9 one'},
              ],
            };
          }
          if (method == 'coder.gitStashPop') {
            // Exactly what the daemon puts on the wire: the English sentence, the marker, the key.
            throw StateError(
              'envoydev.git-stash-dirty: Putting a stash back needs a clean working tree. '
              'Commit or stash the changes in this folder first.'
              ' [envoydev.key] {"key":"error.gitStashDirty"}',
            );
          }
          return _rpc(method, params);
        },
      ),
      locale: const Locale('de'),
    );
    await tester.tap(find.text('Änderungen'));
    await tester.pumpAndSettle();

    final de = catalogue('de');
    await tester.tap(find.text(de.gitStashPop));
    await tester.pumpAndSettle();

    expect(find.text(de.errorGitStashDirty), findsOneWidget);
    // Not the daemon's English, and not the marker: the key was resolved, not passed through.
    expect(find.textContaining('Putting a stash back needs'), findsNothing);
    expect(find.textContaining('envoydev.key'), findsNothing);
    // The stash is still listed: the refusal is about an attempt, not about the stash being gone.
    expect(find.text('WIP on work: 3c3a2b9 one'), findsOneWidget);
  });
}
