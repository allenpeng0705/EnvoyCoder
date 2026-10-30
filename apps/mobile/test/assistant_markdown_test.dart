/// Assistant markdown tables: content-sized columns, sideways scroll, visible thumb.
///
/// Matches the desktop `.md__table-wrap` contract — FlexColumnWidth on a phone was
/// shredding cells into mid-token stacks the same way `overflow-wrap: anywhere` did
/// in the window UI.
library;

import 'package:envoydev_mobile/theme/tokens.dart';
import 'package:envoydev_mobile/widgets/assistant_markdown.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('wide tables scroll sideways with a visible scrollbar thumb', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 280,
            child: AssistantMarkdown(
              colors: CoderColors.dark,
              text: '| Option | Tradeoff |\n'
                  '| --- | --- |\n'
                  '| Keep current path | Very long cell that must stay on one line |\n'
                  '| Alternate | Another long cell that must not wrap mid-token |\n',
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(Scrollbar), findsOneWidget);
    expect(find.byType(SingleChildScrollView), findsWidgets);

    final scrollbar = tester.widget<Scrollbar>(find.byType(Scrollbar));
    expect(scrollbar.thumbVisibility, isTrue);

    final scrollView = tester
        .widgetList<SingleChildScrollView>(find.byType(SingleChildScrollView))
        .firstWhere((v) => v.scrollDirection == Axis.horizontal);
    expect(scrollView.scrollDirection, Axis.horizontal);

    expect(find.textContaining('Keep current path'), findsOneWidget);
    expect(find.textContaining('Very long cell that must stay on one line'), findsOneWidget);
  });
}
