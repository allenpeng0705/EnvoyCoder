/// Composer control chips — model, mode, thinking — driven by `coder.listHarnesses`.
///
/// ## Why the agent is not one of them
///
/// The agent is a property of the **project**, not of a task: a task starts on its project's agent and
/// follows it when the project changes (the daemon's `updateProject` migrates the project's idle tasks
/// onto the new agent, `apps/desktop/src/daemon/store.ts`; the desktop's task header shows the project
/// picker, not a per-task control). Mobile used to offer an Agent chip here that wrote a task-level
/// `harness` into `coder.createTask` / `coder.updateTask`, which let one task in a project run a
/// different agent from the project's own — the opposite of the owner's rule. So the chip is gone, and
/// [ComposerSelection.harnessId] remains only as the **context** that decides which model / mode /
/// thinking options the other three chips offer.
///
/// ## What each chip says, and why
///
/// The remaining chips are the task-scoped choices, and the owner's report was that they were *"not
/// informative"*: Mode and Thinking showed a category with no value. Every chip reads **`Category:
/// value`** — `Model: Default`, `Mode: Default`, `Thinking: Default` — under a header, with the
/// desktop's own title sentence as the tooltip. The categories are the desktop's words for the same
/// concepts (`task.composer.model.label`, `.agentMode.label`, `.thinking.label`), and the unset value
/// is its `task.composer.value.default` ("Default"), so this surface does not invent a second
/// vocabulary. There is deliberately **no glyph**: at 320pt an icon per chip crowded the row, and the
/// words are the part that informs.
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

  /// The agent this task will run — **read-only context, never a task choice**.
  ///
  /// The new-task sheet resolves it from the project (`project.defaults.harness`, else the app
  /// default); the run screen reads the task's stored value. It selects which model / mode / thinking
  /// options the other chips can offer. [copyWith] deliberately has no `harnessId` parameter: nothing
  /// in this widget may move a task off its project's agent.
  final String? harnessId;
  final String? model;
  final String? agentModeId;
  final String? thinkingLevel;

  ComposerSelection copyWith({
    String? model,
    String? agentModeId,
    String? thinkingLevel,
    bool clearModel = false,
    bool clearMode = false,
    bool clearThinking = false,
  }) {
    return ComposerSelection(
      harnessId: harnessId,
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
    // The agent is the *context* for the three task choices, not a choice of its own: `harnessId` names
    // the project's agent (see the library doc), and an unknown one simply offers no chips.
    final current = harnessById(harnesses, selection.harnessId);

    // **Every chip reads "category: value", and the categories are the desktop's words.** Mode and
    // Thinking used to show a category with no value at all. The tooltip is the desktop's title
    // sentence for the same concept, so the two surfaces explain it in one voice — in particular Mode
    // keeps the word "Mode", not a private synonym for it.
    //
    // **No glyph, and that is a 320pt decision.** The first cut carried the desktop's icons
    // (`icons.tsx:165-193`), but an avatar plus its gap widens each chip by ~24pt and at 320pt that
    // only made the stacking below worse. The desktop can afford glyphs because it has hover for the
    // label and a wide rail; a phone has neither, so the words are what stays on screen.
    final chips = <Widget>[
      if (current != null && current.modelApplicable && current.modelsKind != 'none')
        _ChipButton(
          label: l10n.composerModelValue(_modelLabel(l10n, current, selection.model)),
          tooltip: l10n.composerModelTooltip,
          enabled: enabled,
          colors: colors,
          onTap: () => _pickModel(context, current),
        ),
      if (current != null && current.agentModeApplicable && current.modes.isNotEmpty)
        _ChipButton(
          label: l10n.composerModeValue(_modeLabel(l10n, current, selection.agentModeId)),
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
          label: l10n.composerThinkingValue(_thinkingLabel(l10n, current, selection.thinkingLevel)),
          tooltip: l10n.composerThinkingTooltip,
          enabled: enabled,
          colors: colors,
          onTap: () => _pickThinking(context, current),
        ),
    ];

    // An agent that takes no model, mode or thinking — or a harness list that has not arrived — leaves
    // nothing to set up, and a header over an empty row would spend the sheet on a label. The caller
    // already gates on `harnesses.isNotEmpty`, so this is the "this agent has no options" case.
    if (chips.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // **The header is what makes the row an options block rather than decoration.** The owner's
        // report was that these pills were "not informative"; an unlabelled row of chips gives no clue
        // that it *sets up* the task, so the header says it once and the chips below each carry their
        // own category and current value.
        Text(
          l10n.composerOptionsHeader,
          style: Theme.of(context)
              .textTheme
              .labelMedium
              ?.copyWith(color: colors.foregroundMuted),
        ),
        const SizedBox(height: CoderSpace.sm2),
        // **Two per row, explicitly.** An intrinsic `Wrap` was the first shape, and at 320pt it stacked
        // all four chips one per row — a 216pt block, most of a phone sheet, and the owner's "too
        // crowded" made worse. A half-width column turns them into a 2×2 grid: four options, two rows,
        // ~104pt. The width is forced rather than intrinsic so the grid holds whatever the label font
        // measures; a long value fades inside its chip (`Chip` labels are one line, `TextOverflow.fade`)
        // instead of pushing the grid back apart.
        LayoutBuilder(
          builder: (context, constraints) {
            final column = (constraints.maxWidth - CoderSpace.md) / 2;
            return Wrap(
              spacing: CoderSpace.md,
              runSpacing: CoderSpace.md,
              children: [
                for (final chip in chips) SizedBox(width: column, child: chip),
              ],
            );
          },
        ),
      ],
    );
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
    required this.label,
    required this.tooltip,
    required this.enabled,
    required this.colors,
    required this.onTap,
  });

  /// `Category: value`, both visible: a phone cannot hover, so the category cannot live only in the
  /// tooltip the way the desktop's `aria-label` lets it.
  final String label;

  /// The desktop's title sentence for this concept, on long-press **and** in the semantics tree
  /// (`Chip.tooltip` wraps the chip in a `Tooltip`, which carries `Semantics.tooltip`).
  final String tooltip;

  final bool enabled;
  final CoderColors colors;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ActionChip(
      label: Text(label, style: TextStyle(fontSize: 12, color: colors.foreground)),
      tooltip: tooltip,
      onPressed: enabled ? onTap : null,
      backgroundColor: colors.surface2,
      side: BorderSide(color: colors.border),
    );
  }
}
