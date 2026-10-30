/// How Settings → “Ask before risky steps” reaches an agent.
///
/// Mirrors `@envoydev/agent-catalog/asking` so the phone and the window agree.
/// Window-safe table: no probe. Custom / unknown ids are `none` — the daemon
/// never maps Settings Off for them.
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

/// Which mechanism Settings Off uses for this agent id.
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

/// Whether Settings can change how often this agent asks.
bool agentCanControlAsking(String harnessId) =>
    askingControl(harnessId) != AskingControl.none;

/// Mode id Settings Off selects when the wire is unattended-mode.
String? modeForAskingOff(String harnessId) {
  if (askingControl(harnessId) != AskingControl.unattendedMode) return null;
  return unattendedModeId(harnessId);
}

/// Catalogue unattended mode id — metadata, not a delivery guarantee.
/// Prefer [modeForAskingOff] for Settings.
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

/// End-user label for the unattended mode Settings Off would pick.
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
