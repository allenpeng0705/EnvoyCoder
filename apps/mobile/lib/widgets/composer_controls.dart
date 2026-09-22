/// Composer control chips — agent, model, mode, thinking — driven by `coder.listHarnesses`.
///
/// ## The agent is this task's
///
/// A new task starts on the project's default agent. After that the task owns the choice: two tasks
/// in one project can run different agents in parallel. The Agent chip writes `harness` on
/// `coder.createTask` / `coder.updateTask`. Model / mode / thinking stay the options of whichever
/// agent is selected; picking a different agent clears those three so a DeepSeek chip does not keep
/// an Envoy mode.
///
/// ## What each chip says, and why it changed twice
///
/// The owner's first report was that these pills were *"not informative"* — Mode and Thinking showed a
/// category with no value — and the answer was a header plus `Category: value` on every chip. The second
/// report was the cost of that answer: *"the buttons above the inputting field occupied too much space.
/// Can we use icon buttons and just use one line for them including the texts. Maybe we don't need the
/// title."* At 320pt the header plus a 2×2 grid was ~106pt above the field, for three controls.
///
/// So the row is **one line of glyph + value** now:
///
///   * the **icon** carries the category, using the window's own glyph per concept
///     (`apps/desktop/src/components/icons.tsx`), so nothing has to be spelled out on screen twice;
///   * the **value** stays visible, which is the half the first report was about;
///   * the **title** is gone — the chips are the options, and a label saying so was a line of height
///     for words no user needed;
///   * and the category is not lost for anyone who cannot see a glyph: it heads the chip's
///     screen-reader label (`Model: Default`, the desktop's own string) and the tooltip is still the
///     desktop's whole sentence for the concept.
///
/// The unset value is the desktop's `task.composer.value.default` ("Default"), so this surface does not
/// invent a second vocabulary.
library;

import 'package:flutter/material.dart';

import '../l10n/l10n.dart';
import '../models/harness.dart';
import '../theme/tokens.dart';

class ComposerSelection {
  const ComposerSelection({
    this.harnessId,
    this.model,
    this.agentModeId,
    this.thinkingLevel,
  });

  /// The agent this task will run. Copied from the project at create, then owned by the task.
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
    final l10n = context.l10n;
    final colors = CoderTheme.of(context);
    final current = harnessById(harnesses, selection.harnessId);

    // **One line, glyphs instead of category words.** Agent first — it decides which of the other
    // three exist — then model, mode, thinking. The category is the screen-reader label, not the
    // visible text.
    final chips = <Widget>[
      if (harnesses.isNotEmpty)
        _ChipButton(
          icon: Icons.smart_toy_outlined,
          label: _agentLabel(l10n, current),
          semanticsLabel: l10n.composerAgentValue(_agentLabel(l10n, current)),
          tooltip: l10n.composerAgentTooltip,
          enabled: enabled,
          colors: colors,
          onTap: () => _pickAgent(context),
        ),
      if (current != null && current.modelApplicable && current.modelsKind != 'none')
        _ChipButton(
          icon: Icons.memory,
          label: _modelLabel(l10n, current, selection.model),
          semanticsLabel: l10n.composerModelValue(_modelLabel(l10n, current, selection.model)),
          tooltip: l10n.composerModelTooltip,
          enabled: enabled,
          colors: colors,
          onTap: () => _pickModel(context, current),
        ),
      if (current != null && current.agentModeApplicable && current.modes.isNotEmpty)
        _ChipButton(
          icon: Icons.tune,
          label: _modeLabel(l10n, current, selection.agentModeId),
          semanticsLabel: l10n.composerModeValue(_modeLabel(l10n, current, selection.agentModeId)),
          tooltip: l10n.composerModeTooltip,
          enabled: enabled,
          colors: colors,
          onTap: () => _pickMode(context, current),
        ),
      if (current != null &&
          current.thinkingApplicable &&
          current.thinkingKind == 'listed' &&
          current.thinkingOptions.isNotEmpty)
        _ChipButton(
          icon: Icons.lightbulb_outline,
          label: _thinkingLabel(l10n, current, selection.thinkingLevel),
          semanticsLabel:
              l10n.composerThinkingValue(_thinkingLabel(l10n, current, selection.thinkingLevel)),
          tooltip: l10n.composerThinkingTooltip,
          enabled: enabled,
          colors: colors,
          onTap: () => _pickThinking(context, current),
        ),
    ];

    // A harness list that has not arrived leaves nothing to set up, and a row of nothing would spend
    // the composer on a gap. An agent with no model / mode / thinking still shows the Agent chip.
    if (chips.isEmpty) return const SizedBox.shrink();

    // **`Flexible`, so it is one line by construction.** Each chip takes what its own text needs and no
    // more, and a value too long for its share ellipsizes inside the chip instead of pushing the row
    // onto a second line — which is what the `Wrap` did, and what the owner asked to stop. Three chips
    // share the width at 320pt with room for a chip glyph and a readable value each.
    return Row(
      children: [
        for (var index = 0; index < chips.length; index += 1) ...[
          if (index > 0) const SizedBox(width: CoderSpace.sm2),
          Flexible(child: chips[index]),
        ],
      ],
    );
  }

  String _agentLabel(AppLocalizations l10n, HarnessInfo? current) {
    if (current != null) return current.label;
    return l10n.composerAgentBare;
  }

  // The unset value is **"Default", the desktop's own word** (`task.composer.value.default`) for "the
  // agent's own choice applies". "Not set" would be read as a missing value or an error; nothing is
  // wrong when a task leaves the agent to decide.
  String _modelLabel(AppLocalizations l10n, HarnessInfo h, String? model) {
    if (model == null || model.isEmpty) return l10n.composerDefault;
    for (final o in h.modelOptions) {
      if (o.id == model) return o.label;
    }
    return model;
  }

  String _modeLabel(AppLocalizations l10n, HarnessInfo h, String? modeId) {
    if (modeId == null || modeId.isEmpty) return l10n.composerDefault;
    for (final o in h.modes) {
      if (o.id == modeId) return o.label;
    }
    return modeId;
  }

  String _thinkingLabel(AppLocalizations l10n, HarnessInfo h, String? level) {
    if (level == null || level.isEmpty) return l10n.composerDefault;
    for (final o in h.thinkingOptions) {
      if (o.value == level) return o.label;
    }
    return level;
  }

  Future<void> _pickAgent(BuildContext context) async {
    final l10n = context.l10n;
    final chosen = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            ListTile(title: Text(l10n.composerAgentBare)),
            for (final harness in offeredHarnesses(harnesses))
              ListTile(
                title: Text(harness.label),
                trailing: selection.harnessId == harness.id ? const Icon(Icons.check) : null,
                onTap: () => Navigator.pop(context, harness.id),
              ),
          ],
        ),
      ),
    );
    if (chosen == null || chosen == selection.harnessId) return;
    // A different agent cannot honour the previous mode / model / thinking. Start clean so the
    // chips match the agent that will actually run.
    onChanged(ComposerSelection(harnessId: chosen));
  }

  Future<void> _pickModel(BuildContext context, HarnessInfo harness) async {
    final l10n = context.l10n;
    if (harness.modelsKind == 'free-text') {
      final controller = TextEditingController(text: selection.model ?? '');
      final value = await showDialog<String>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(l10n.composerModelSheet),
          content: TextField(
            controller: controller,
            decoration: InputDecoration(
              hintText: l10n.composerModelHint,
              border: const OutlineInputBorder(),
            ),
            autofocus: true,
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, ''),
              child: Text(l10n.composerDefault),
            ),
            TextButton(
              onPressed: () => Navigator.pop(context, controller.text.trim()),
              child: Text(l10n.composerUse),
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
            ListTile(title: Text(l10n.composerModelSheet)),
            ListTile(
              title: Text(l10n.composerAgentDefault),
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
    final l10n = context.l10n;
    final chosen = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            ListTile(title: Text(l10n.composerModeSheet)),
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
    final l10n = context.l10n;
    final chosen = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            ListTile(title: Text(l10n.composerThinkingSheet)),
            ListTile(
              title: Text(l10n.composerAgentDefault),
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
    required this.icon,
    required this.label,
    required this.semanticsLabel,
    required this.tooltip,
    required this.enabled,
    required this.colors,
    required this.onTap,
  });

  /// The concept this chip sets, in the window's own glyph (`apps/desktop/src/components/icons.tsx`:
  /// sliders for Mode, a chip for Model, a bulb for Thinking). It is what replaced the category words
  /// the owner asked to drop, so the icon is load-bearing rather than decoration — and it is why a chip
  /// stays readable at a third of a 320pt screen.
  final IconData icon;

  /// The **value**, alone: `Default`, `Plan`, `sonnet-4-6`. The category is not part of the visible
  /// text any more; a phone shows three of these side by side, and `Model: Default` three times over was
  /// the width the owner was paying for.
  final String label;

  /// `Category: value`, for a screen reader — the desktop's own string for the pair, so the category
  /// that left the screen is still announced. The visible text and this label must be kept apart: a
  /// chip that showed the category *and* announced it would spend the width twice.
  final String semanticsLabel;

  /// The desktop's title sentence for this concept, on long-press **and** in the semantics tree
  /// (`Chip.tooltip` wraps the chip in a `Tooltip`, which carries `Semantics.tooltip`).
  final String tooltip;

  final bool enabled;
  final CoderColors colors;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final chip = ActionChip(
      label: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 15, color: colors.foregroundMuted),
          const SizedBox(width: 5),
          // The value is the part that may not fit; the glyph never shrinks.
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 12, color: colors.foreground),
            ),
          ),
        ],
      ),
      // Tighter than the default: the owner's complaint was the space this row costs, and a chip's
      // stock padding is sized for a wide window with a pointer.
      labelPadding: const EdgeInsets.symmetric(horizontal: 2),
      padding: const EdgeInsets.symmetric(horizontal: 8),
      visualDensity: VisualDensity.compact,
      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
      tooltip: tooltip,
      onPressed: enabled ? onTap : null,
      backgroundColor: colors.surface2,
      side: BorderSide(color: colors.border),
    );

    /**
     * **One accessible node per chip, owning the whole of it.**
     *
     * `excludeSemantics` drops the chip's own nodes, so a screen reader hears `Model: Default` once
     * rather than `Default` followed by the tooltip's sentence fragment — and `onTap` here is not
     * decoration: with the child's nodes gone, this is the only thing that lets an assistive tap open
     * the picker.
     */
    return Semantics(
      label: semanticsLabel,
      tooltip: tooltip,
      button: true,
      enabled: enabled,
      onTap: enabled ? onTap : null,
      excludeSemantics: true,
      child: chip,
    );
  }
}
