/// Agents as `coder.listHarnesses` returns them — enough for pickers on the phone.
library;

class HarnessInfo {
  const HarnessInfo({
    required this.id,
    required this.label,
    required this.modes,
    required this.modelsKind,
    required this.modelOptions,
    required this.thinkingKind,
    required this.thinkingOptions,
    required this.agentModeApplicable,
    required this.modelApplicable,
    required this.thinkingApplicable,
    required this.ready,
  });

  final String id;
  final String label;
  final List<AgentModeOption> modes;
  /// `listed` | `free-text` | `none` | `unknown`
  final String modelsKind;
  final List<AgentModelOption> modelOptions;
  /// `listed` | `session` | `none` | `unknown`
  final String thinkingKind;
  final List<AgentThinkingOption> thinkingOptions;
  final bool agentModeApplicable;
  final bool modelApplicable;
  final bool thinkingApplicable;
  final bool ready;

  factory HarnessInfo.fromJson(Map<String, dynamic> json) {
    final caps = json['capabilities'];
    final modesRaw = json['modes'];
    final models = json['models'];
    final thinking = json['thinking'];
    final availability = json['availability'];

    final modes = <AgentModeOption>[];
    if (modesRaw is List) {
      for (final raw in modesRaw) {
        if (raw is! Map) continue;
        final id = raw['id'] as String?;
        if (id == null || id.isEmpty) continue;
        modes.add(AgentModeOption(
          id: id,
          label: (raw['label'] as String?) ?? id,
          description: raw['description'] as String?,
        ));
      }
    }

    var modelsKind = 'unknown';
    final modelOptions = <AgentModelOption>[];
    if (models is Map) {
      modelsKind = (models['kind'] as String?) ?? 'unknown';
      final options = models['options'];
      if (options is List) {
        for (final raw in options) {
          if (raw is! Map) continue;
          final id = raw['id'] as String?;
          if (id == null || id.isEmpty) continue;
          modelOptions.add(AgentModelOption(
            id: id,
            label: (raw['label'] as String?) ?? id,
          ));
        }
      }
    }

    var thinkingKind = 'unknown';
    final thinkingOptions = <AgentThinkingOption>[];
    if (thinking is Map) {
      thinkingKind = (thinking['kind'] as String?) ?? 'unknown';
      final options = thinking['options'];
      if (options is List) {
        for (final raw in options) {
          if (raw is! Map) continue;
          final value = (raw['value'] as String?) ?? (raw['id'] as String?);
          if (value == null || value.isEmpty) continue;
          thinkingOptions.add(AgentThinkingOption(
            value: value,
            label: (raw['label'] as String?) ?? value,
          ));
        }
      }
    }

    final ready = availability is Map
        ? availability['state'] == 'ready'
        : json['available'] == true;

    return HarnessInfo(
      id: (json['id'] as String?) ?? '',
      label: (json['label'] as String?) ?? (json['id'] as String?) ?? 'agent',
      modes: modes,
      modelsKind: modelsKind,
      modelOptions: modelOptions,
      thinkingKind: thinkingKind,
      thinkingOptions: thinkingOptions,
      agentModeApplicable: caps is Map && caps['agentMode'] == true,
      modelApplicable: caps is Map && caps['model'] == true,
      thinkingApplicable: caps is Map && caps['thinking'] == true,
      ready: ready,
    );
  }

  String get badge {
    if (label.length <= 12) return label;
    final parts = id.split('-');
    if (parts.isNotEmpty && parts.first.isNotEmpty) {
      return parts.first[0].toUpperCase() + parts.first.substring(1);
    }
    return label;
  }
}

class AgentModeOption {
  const AgentModeOption({required this.id, required this.label, this.description});
  final String id;
  final String label;
  final String? description;
}

class AgentModelOption {
  const AgentModelOption({required this.id, required this.label});
  final String id;
  final String label;
}

class AgentThinkingOption {
  const AgentThinkingOption({required this.value, required this.label});
  final String value;
  final String label;
}

/// Agents a user may pick — ready ones first; others still listed with a reason.
List<HarnessInfo> offeredHarnesses(List<HarnessInfo> all) {
  final ready = all.where((h) => h.ready && h.id.isNotEmpty).toList();
  if (ready.isNotEmpty) return ready;
  return all.where((h) => h.id.isNotEmpty).toList();
}

HarnessInfo? harnessById(List<HarnessInfo> all, String? id) {
  if (id == null || id.isEmpty) return null;
  for (final h in all) {
    if (h.id == id) return h;
  }
  return null;
}
