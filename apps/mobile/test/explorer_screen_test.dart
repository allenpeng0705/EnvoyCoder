import 'package:envoydev_mobile/screens/explorer_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

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
  });
}
