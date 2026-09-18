import 'package:envoydev_mobile/widgets/home_folder_browser.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Future<Map<String, dynamic>> _stubRpc(String method, [Map<String, dynamic> params = const {}]) async {
  if (method == 'coder.getHomeFsInfo') {
    return {
      'platform': 'darwin',
      'pathSep': '/',
      'homeDir': '/Users/ada',
      'roots': ['/'],
    };
  }
  if (method == 'coder.listHomeFsEntries') {
    final path = params['path'] as String? ?? '/Users/ada';
    if (path == '/Users/ada') {
      return {
        'path': '/Users/ada',
        'parent': '/Users',
        'entries': [
          {'name': 'work', 'kind': 'dir', 'path': '/Users/ada/work'},
          {'name': '.hidden', 'kind': 'dir', 'path': '/Users/ada/.hidden'},
          {'name': 'readme.md', 'kind': 'file', 'path': '/Users/ada/readme.md'},
        ],
      };
    }
    if (path == '/Users/ada/work') {
      return {
        'path': '/Users/ada/work',
        'parent': '/Users/ada',
        'entries': [
          {'name': 'repo', 'kind': 'dir', 'path': '/Users/ada/work/repo'},
        ],
      };
    }
    return {'path': path, 'entries': <Map<String, dynamic>>[]};
  }
  throw StateError('unexpected $method');
}

void main() {
  testWidgets('home folder browser lists dirs and confirms the current path', (tester) async {
    String? picked;

    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () async {
                picked = await HomeFolderBrowser.open(context, rpc: _stubRpc);
              },
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    expect(find.text('/Users/ada'), findsOneWidget);
    expect(find.text('work'), findsOneWidget);
    expect(find.text('.hidden'), findsNothing);

    await tester.tap(find.text('work'));
    await tester.pumpAndSettle();
    expect(find.text('/Users/ada/work'), findsOneWidget);
    expect(find.text('repo'), findsOneWidget);

    await tester.tap(find.text('Use this folder'));
    await tester.pumpAndSettle();
    expect(picked, '/Users/ada/work');
  });
}
