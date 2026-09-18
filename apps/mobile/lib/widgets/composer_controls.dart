/// Composer control chips — agent, model, mode, thinking — driven by `coder.listHarnesses`.
library;

import 'package:flutter/material.dart';

import '../models/harness.dart';
import '../theme/tokens.dart';

class ComposerSelection {
  const ComposerSelection({
    this.harnessId,
    this.model,
    this.agentModeId,
    this.thinkingLevel,
  });

  final String? harnessId;
  final String? model;
  final String? agentModeId;
  final String? thinkingLevel;

  ComposerSelection copyWith({
    String? harnessId,
    String? model,
    String? agentModeId,
    String? thinkingLevel,
    bool clearModel = false,
    bool clearMode = false,
    bool clearThinking = false,
  }) {
    return ComposerSelection(
      harnessId: harnessId ?? this.harnessId,
      model: clearModel ? null : (model ?? this.model),
      agentModeId: clearMode ? null : (agentModeId ?? this.agentModeId),
      thinkingLevel: clearThinking ? null : (thinkingLevel ?? this.thinkingLevel),
    );
  }
}

class ComposerControls extends StatelessWidget {
  const ComposerControls({
    super.key,
    required this.harnesses,
    required this.selection,
    required this.onChanged,
    this.enabled = true,
  });

  final List<HarnessInfo> harnesses;
  final ComposerSelection selection;
  final ValueChanged<ComposerSelection> onChanged;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final colors = CoderTheme.of(context);
    final offered = offeredHarnesses(harnesses);
    final current = harnessById(harnesses, selection.harnessId) ??
        (offered.isNotEmpty ? offered.first : null);

    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        _ChipButton(
          label: current?.badge ?? 'Agent',
          enabled: enabled && offered.isNotEmpty,
          colors: colors,
          onTap: () => _pickHarness(context, offered, current),
        ),
        if (current != null && current.modelApplicable && current.modelsKind != 'none')
          _ChipButton(
            label: _modelLabel(current, selection.model),
            enabled: enabled,
            colors: colors,
            onTap: () => _pickModel(context, current),
          ),
        if (current != null &&
            current.agentModeApplicable &&
            current.modes.isNotEmpty)
          _ChipButton(
            label: _modeLabel(current, selection.agentModeId),
            enabled: enabled,
            colors: colors,
            onTap: () => _pickMode(context, current),
          ),
        if (current != null &&
            current.thinkingApplicable &&
            current.thinkingKind == 'listed' &&
            current.thinkingOptions.isNotEmpty)
          _ChipButton(
            label: _thinkingLabel(current, selection.thinkingLevel),
            enabled: enabled,
            colors: colors,
            onTap: () => _pickThinking(context, current),
          ),
      ],
    );
  }

  String _modelLabel(HarnessInfo h, String? model) {
    if (model == null || model.isEmpty) return 'Default model';
    for (final o in h.modelOptions) {
      if (o.id == model) return o.label;
    }
    return model;
  }

  String _modeLabel(HarnessInfo h, String? modeId) {
    if (modeId == null || modeId.isEmpty) return 'Mode';
    for (final o in h.modes) {
      if (o.id == modeId) return o.label;
    }
    return modeId;
  }

  String _thinkingLabel(HarnessInfo h, String? level) {
    if (level == null || level.isEmpty) return 'Thinking';
    for (final o in h.thinkingOptions) {
      if (o.value == level) return o.label;
    }
    return level;
  }

  Future<void> _pickHarness(
    BuildContext context,
    List<HarnessInfo> offered,
    HarnessInfo? current,
  ) async {
    final chosen = await showModalBottomSheet<HarnessInfo>(
      context: context,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            const ListTile(title: Text('Coding agent')),
            for (final h in offered)
              ListTile(
                title: Text(h.label),
                subtitle: Text(h.id),
                trailing: h.id == current?.id ? const Icon(Icons.check) : null,
                onTap: () => Navigator.pop(context, h),
              ),
          ],
        ),
      ),
    );
    if (chosen == null) return;
    onChanged(ComposerSelection(
      harnessId: chosen.id,
      model: null,
      agentModeId: null,
      thinkingLevel: null,
    ));
  }

  Future<void> _pickModel(BuildContext context, HarnessInfo harness) async {
    if (harness.modelsKind == 'free-text') {
      final controller = TextEditingController(text: selection.model ?? '');
      final value = await showDialog<String>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Model'),
          content: TextField(
            controller: controller,
            decoration: const InputDecoration(
              hintText: 'provider/model',
              border: OutlineInputBorder(),
            ),
            autofocus: true,
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, ''),
              child: const Text('Default'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(context, controller.text.trim()),
              child: const Text('Use'),
            ),
          ],
        ),
      );
      if (value == null) return;
      onChanged(selection.copyWith(
        model: value,
        clearModel: value.isEmpty,
      ));
      return;
    }

    final chosen = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            const ListTile(title: Text('Model')),
            ListTile(
              title: const Text('Agent default'),
              trailing: (selection.model == null || selection.model!.isEmpty)
                  ? const Icon(Icons.check)
                  : null,
              onTap: () => Navigator.pop(context, ''),
            ),
            for (final o in harness.modelOptions)
              ListTile(
                title: Text(o.label),
                subtitle: Text(o.id),
                trailing: selection.model == o.id ? const Icon(Icons.check) : null,
                onTap: () => Navigator.pop(context, o.id),
              ),
          ],
        ),
      ),
    );
    if (chosen == null) return;
    onChanged(selection.copyWith(model: chosen, clearModel: chosen.isEmpty));
  }

  Future<void> _pickMode(BuildContext context, HarnessInfo harness) async {
    final chosen = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            const ListTile(title: Text('Mode')),
            for (final o in harness.modes)
              ListTile(
                title: Text(o.label),
                subtitle: o.description != null ? Text(o.description!) : null,
                trailing: selection.agentModeId == o.id ? const Icon(Icons.check) : null,
                onTap: () => Navigator.pop(context, o.id),
              ),
          ],
        ),
      ),
    );
    if (chosen == null) return;
    onChanged(selection.copyWith(agentModeId: chosen));
  }

  Future<void> _pickThinking(BuildContext context, HarnessInfo harness) async {
    final chosen = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            const ListTile(title: Text('Thinking')),
            ListTile(
              title: const Text('Agent default'),
              onTap: () => Navigator.pop(context, ''),
            ),
            for (final o in harness.thinkingOptions)
              ListTile(
                title: Text(o.label),
                trailing: selection.thinkingLevel == o.value ? const Icon(Icons.check) : null,
                onTap: () => Navigator.pop(context, o.value),
              ),
          ],
        ),
      ),
    );
    if (chosen == null) return;
    onChanged(selection.copyWith(thinkingLevel: chosen, clearThinking: chosen.isEmpty));
  }
}

class _ChipButton extends StatelessWidget {
  const _ChipButton({
    required this.label,
    required this.enabled,
    required this.colors,
    required this.onTap,
  });

  final String label;
  final bool enabled;
  final CoderColors colors;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ActionChip(
      label: Text(label, style: TextStyle(fontSize: 12, color: colors.foreground)),
      onPressed: enabled ? onTap : null,
      backgroundColor: colors.surface2,
      side: BorderSide(color: colors.border),
    );
  }
}
