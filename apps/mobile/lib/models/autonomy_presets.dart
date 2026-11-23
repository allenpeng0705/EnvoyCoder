/// Codex-inspired autonomy presets — Read only / Default / Full access.
library;

import 'asking_control.dart';

enum AutonomyPresetId { readOnly, default_, fullAccess }

AutonomyPresetId activeAutonomyPreset({
  required bool requireApproval,
  required bool modeUnattended,
  required bool modeReadOnly,
  /// False for agents (e.g. Cursor) that cannot receive Asking Off / YOLO.
  bool askingDeliverable = true,
}) {
  if (modeUnattended) return AutonomyPresetId.fullAccess;
  if (!requireApproval && askingDeliverable) return AutonomyPresetId.fullAccess;
  if (modeReadOnly) return AutonomyPresetId.readOnly;
  return AutonomyPresetId.default_;
}

/// Whether Full access / Asking Off can reach this agent.
///
/// Matches desktop `askingIsDeliverable`: shipped wire or catalogue YOLO — not a
/// catalogue `unattended` mode we cannot deliver (Copilot / OMP).
bool askingIsDeliverable({
  required String? harnessId,
  String? catalogEntryId,
}) {
  if (harnessId == null || harnessId.isEmpty) return false;
  if (agentCanControlAsking(harnessId)) return true;
  if (isShippedAskingAgent(harnessId)) return false;
  return cataloguedUnattendedModeId(catalogEntryId ?? harnessId) != null;
}

bool modeLooksReadOnly(String? modeId) {
  if (modeId == null || modeId.isEmpty) return false;
  final id = modeId.toLowerCase().replaceAll('_', '-');
  return id == 'plan' ||
      id == 'read-only' ||
      id == 'readonly' ||
      id == 'ask' ||
      id == 'review' ||
      id.contains('read-only');
}

String? modeIdForPreset(
  AutonomyPresetId preset,
  Iterable<({String id, bool unattended})> modes, {
  String? unattendedFallback,
}) {
  final list = modes.toList();
  if (list.isEmpty) {
    if (preset == AutonomyPresetId.fullAccess) return unattendedFallback;
    return null;
  }
  if (preset == AutonomyPresetId.fullAccess) {
    for (final mode in list) {
      if (mode.unattended) return mode.id;
    }
    return unattendedFallback;
  }
  if (preset == AutonomyPresetId.readOnly) {
    const preferred = ['plan', 'read-only', 'ask', 'review'];
    for (final id in preferred) {
      for (final mode in list) {
        if (mode.id.toLowerCase().replaceAll('_', '-') == id) return mode.id;
      }
    }
    for (final mode in list) {
      if (modeLooksReadOnly(mode.id) && !mode.unattended) return mode.id;
    }
    return null;
  }
  for (final mode in list) {
    if (!mode.unattended && !modeLooksReadOnly(mode.id)) return mode.id;
  }
  for (final mode in list) {
    if (!mode.unattended) return mode.id;
  }
  return null;
}
