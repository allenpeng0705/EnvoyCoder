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
        {'path': 'src/main.ts', 'kind': 'modified'},
      ],
    };
  }
  throw StateError('unexpected $method');
}

void main() {
  testWidgets('lists folders and files, and hides node_modules', (tester) async {
    await tester.pumpWidget(
      MaterialApp(home: ExplorerScreen(rpc: _rpc, root: '/repo')),
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
      MaterialApp(home: ExplorerScreen(rpc: _rpc, root: '/repo')),
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
}
