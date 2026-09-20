// The phone's install id: stable, random, and kept.
//
// It exists to be sent in `coder.hello`, and the property that matters is *stability* — an id that changed per
// launch would make every connection look like a new device, which is worse than sending none at all.

import 'package:envoydev_mobile/services/install_id.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  test('is created once and then reused', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final first = await installId();
    final second = await installId();
    expect(second, first);
    // 16 bytes as hex: 32 characters, and lowercase hex only.
    expect(first.length, 32);
    expect(RegExp(r'^[0-9a-f]{32}$').hasMatch(first), isTrue);
  });

  test('a stored id is kept rather than replaced', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final preferences = await SharedPreferences.getInstance();
    await preferences.setString(kInstallIdKey, 'stored-install-id');

    expect(await installId(), 'stored-install-id');
    // And it was not overwritten with a fresh one.
    expect(preferences.getString(kInstallIdKey), 'stored-install-id');
  });

  test('two fresh installations do not share an id', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final first = await installId();
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final second = await installId();
    expect(second, isNot(first));
  });
}
