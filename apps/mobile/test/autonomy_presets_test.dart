import 'package:envoydev_mobile/models/autonomy_presets.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('activeAutonomyPreset maps Settings + mode', () {
    expect(
      activeAutonomyPreset(
        requireApproval: true,
        modeUnattended: false,
        modeReadOnly: false,
      ),
      AutonomyPresetId.default_,
    );
    expect(
      activeAutonomyPreset(
        requireApproval: true,
        modeUnattended: false,
        modeReadOnly: true,
      ),
      AutonomyPresetId.readOnly,
    );
    expect(
      activeAutonomyPreset(
        requireApproval: false,
        modeUnattended: false,
        modeReadOnly: false,
      ),
      AutonomyPresetId.fullAccess,
    );
  });

  test('modeIdForPreset prefers plan for read-only and unattended for full access', () {
    final modes = [
      (id: 'plan', unattended: false),
      (id: 'default', unattended: false),
      (id: 'yolo', unattended: true),
    ];
    expect(modeIdForPreset(AutonomyPresetId.readOnly, modes), 'plan');
    expect(modeIdForPreset(AutonomyPresetId.default_, modes), 'default');
    expect(modeIdForPreset(AutonomyPresetId.fullAccess, modes), 'yolo');
  });
}
