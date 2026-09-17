import 'package:envoydev_mobile/main.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('EnvoyDev opens on the host list', (tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(const EnvoyDevApp());
    await tester.pumpAndSettle();
    expect(find.text('EnvoyDev'), findsWidgets);
    expect(find.text('No desktop paired yet'), findsOneWidget);
    expect(find.text('Add host'), findsOneWidget);
  });
}
