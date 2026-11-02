/// How Settings → “Ask before risky steps” reaches an agent.
///
/// Mirrors `@envoydev/agent-catalog/asking` (+ catalogue YOLO from `acp-catalog`) so the phone
/// and the window agree. Custom / unknown ids without a documented YOLO mode are `none`.
library;

enum AskingControl {
  /// `session/set_policy` / `autoRun` (Envoy Harness).
  policy,

  /// Catalogue unattended mode this build can deliver (`session/set_mode` or
  /// DeepSeek’s `DSH_PERMISSION_MODE`).
  unattendedMode,

  /// No deliverable wire — Copilot/OMP list modes but cannot take them here.
  none,
}

/// Which mechanism Settings Off uses for this shipped agent id.
AskingControl askingControl(String harnessId) {
  switch (harnessId) {
    case 'envoy-harness':
      return AskingControl.policy;
    case 'deepseek-harness':
    case 'claudecode':
    case 'codex':
      return AskingControl.unattendedMode;
    case 'copilot':
    case 'opencode':
    case 'cursor':
    case 'pi':
    case 'omp':
      return AskingControl.none;
    default:
      return AskingControl.none;
  }
}

/// Whether Settings can change how often this shipped agent asks.
bool agentCanControlAsking(String harnessId) =>
    askingControl(harnessId) != AskingControl.none;

/// Mode id Settings Off selects when the wire is unattended-mode.
String? modeForAskingOff(String harnessId) {
  if (askingControl(harnessId) != AskingControl.unattendedMode) return null;
  return unattendedModeId(harnessId);
}

/// Catalogue unattended mode id — metadata, not a delivery guarantee.
/// Prefer [modeForAskingOff] for Settings on shipped agents.
String? unattendedModeId(String harnessId) {
  switch (harnessId) {
    case 'envoy-harness':
    case 'deepseek-harness':
      return 'danger-full-access';
    case 'claudecode':
      return 'bypassPermissions';
    case 'codex':
      return 'agent-full-access';
    case 'copilot':
      return 'allow-all';
    case 'omp':
      return 'full';
    default:
      return null;
  }
}

/// Unattended / YOLO mode for a catalogue entry id (Gemini, Qwen, …).
///
/// Same table as `@envoydev/agent-catalog` `cataloguedUnattendedModeId`.
String? cataloguedUnattendedModeId(String? entryId) {
  if (entryId == null || entryId.isEmpty) return null;
  switch (entryId) {
    case 'gemini':
    case 'qwen-code':
      return 'yolo';
    default:
      return null;
  }
}

/// End-user label for the unattended mode Settings Off would pick (shipped agents).
String? modeLabelForAskingOff(String harnessId) {
  final id = modeForAskingOff(harnessId);
  if (id == null) return null;
  switch (id) {
    case 'danger-full-access':
      return 'Full access';
    case 'bypassPermissions':
      return 'Bypass permissions';
    case 'agent-full-access':
      return 'Full Access';
    case 'allow-all':
      return 'Allow all';
    case 'full':
      return 'Full access';
    default:
      return id;
  }
}

/// Label for a catalogue YOLO mode id.
String? cataloguedUnattendedModeLabel(String? entryId) {
  final id = cataloguedUnattendedModeId(entryId);
  if (id == null) return null;
  switch (id) {
    case 'yolo':
      return 'YOLO';
    default:
      return id;
  }
}

/// Whether the permission card may offer “Allow and don't ask again”.
///
/// Matches desktop `canStopAskingApprovals`: policy, unattended-mode, or catalogue YOLO.
bool canStopAskingApprovals({
  required String? harnessId,
  required bool requireApproval,
  String? catalogEntryId,
}) {
  if (!requireApproval) return false;
  if (harnessId == null || harnessId.isEmpty) return false;
  if (askingControl(harnessId) != AskingControl.none) return true;
  return cataloguedUnattendedModeId(catalogEntryId ?? harnessId) != null;
}

/// Whether Settings can flip asking for this agent (shipped wire or catalogue YOLO).
bool agentOrCatalogueCanControlAsking({
  required String? harnessId,
  String? catalogEntryId,
}) {
  if (harnessId == null || harnessId.isEmpty) return false;
  if (agentCanControlAsking(harnessId)) return true;
  if (isShippedAskingAgent(harnessId)) return false;
  return cataloguedUnattendedModeId(catalogEntryId ?? harnessId) != null;
}

/// Shipped agent ids in the asking-control table (including `none`).
bool isShippedAskingAgent(String harnessId) {
  switch (harnessId) {
    case 'envoy-harness':
    case 'deepseek-harness':
    case 'claudecode':
    case 'codex':
    case 'copilot':
    case 'opencode':
    case 'cursor':
    case 'pi':
    case 'omp':
      return true;
    default:
      return false;
  }
}

/// Option id stop-asking should send — prefer explicit allow-* ids (desktop twin).
String? stopAskingAllowId(Iterable<({String id, bool destructive})> options) {
  final allows = [
    for (final option in options)
      if (!option.destructive) option,
  ];
  if (allows.isEmpty) return null;
  for (final option in allows) {
    final id = option.id.toLowerCase().replaceAll('_', '-');
    if (id == 'allow' ||
        id == 'allow-once' ||
        id == 'allow-always' ||
        id.startsWith('allow-')) {
      return option.id;
    }
  }
  return allows.first.id;
}
