/// Detailed EnvoyDev ↔ desktop setup guide.
///
/// Shown automatically after welcome slides on first launch, and anytime via
/// [showSetupGuide] (empty-hosts screen, Settings).
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../../constants/envoy_links.dart';
import '../../l10n/l10n.dart';
import '../../services/onboarding_preferences.dart';
import '../../theme/tokens.dart';
import '../../utils/open_external_url.dart';

class SetupGuideScreen extends StatefulWidget {
  const SetupGuideScreen({
    super.key,
    this.isFirstLaunch = false,
    this.requirePairing = false,
    this.onPairLater,
    this.onPairNow,
  });

  /// When true, closing marks the guide as completed for first-run gating.
  final bool isFirstLaunch;

  /// First-launch gate: the guide is the root content, so it must not pop the
  /// root route and answers [onPairLater] / [onPairNow] instead.
  final bool requirePairing;

  /// Gate mode: the user chose to pair later, so open the app shell.
  final VoidCallback? onPairLater;

  /// Start pairing. Return `true` when the guide should dismiss (successful
  /// pair); `false` to stay on the guide (user cancelled).
  final Future<bool> Function()? onPairNow;

  @override
  State<SetupGuideScreen> createState() => _SetupGuideScreenState();
}

class _SetupGuideScreenState extends State<SetupGuideScreen> {
  bool _closing = false;

  Future<void> _markCompleteIfNeeded() async {
    if (widget.isFirstLaunch) {
      await OnboardingPreferences.setGuideCompleted();
    }
  }

  Future<void> _leave() async {
    await _markCompleteIfNeeded();
    if (!mounted) return;
    final onPairLater = widget.onPairLater;
    if (onPairLater != null) {
      onPairLater();
      return;
    }
    Navigator.of(context).pop();
  }

  Future<void> _finish({bool openPairing = false}) async {
    if (_closing) return;

    if (openPairing) {
      final onPairNow = widget.onPairNow;
      if (onPairNow == null) {
        // Reopened as read-only help with no pairing hook — treat as Done.
        setState(() => _closing = true);
        await _leave();
        return;
      }
      setState(() => _closing = true);
      final ok = await onPairNow();
      if (!mounted) return;
      if (!ok) {
        // Cancelled: stay on the guide and do not mark first-run complete.
        setState(() => _closing = false);
        return;
      }
      await _markCompleteIfNeeded();
      return;
    }

    setState(() => _closing = true);
    await _leave();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final colors = CoderTheme.of(context);
    final text = Theme.of(context).textTheme;
    final canPair = widget.onPairNow != null || widget.requirePairing;

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop || _closing) return;
        await _finish();
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.setupGuideTitle),
          leading: IconButton(
            tooltip: MaterialLocalizations.of(context).closeButtonTooltip,
            icon: const Icon(Icons.close),
            onPressed: _closing ? null : () => unawaited(_finish()),
          ),
        ),
        body: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(
                  CoderSpace.xl,
                  CoderSpace.lg,
                  CoderSpace.xl,
                  CoderSpace.lg,
                ),
                children: [
                  if (widget.requirePairing) ...[
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(CoderSpace.md2),
                      decoration: BoxDecoration(
                        color: colors.accent.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(CoderRadius.xl),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            l10n.setupGuidePairRequiredTitle,
                            style: text.titleMedium?.copyWith(
                              fontWeight: FontWeight.w700,
                              color: colors.foreground,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            l10n.setupGuidePairRequiredBody,
                            style: text.bodyMedium?.copyWith(
                              color: colors.foregroundMuted,
                              height: 1.4,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: CoderSpace.lg),
                  ],
                  Text(
                    l10n.setupGuideIntro,
                    style: text.bodyLarge?.copyWith(
                      color: colors.foregroundMuted,
                      height: 1.45,
                    ),
                  ),
                  const SizedBox(height: CoderSpace.xl),
                  _GuideStep(
                    number: 1,
                    title: l10n.setupGuideStep1Title,
                    body: l10n.setupGuideStep1Body,
                    icon: Icons.computer_outlined,
                  ),
                  _GuideStep(
                    number: 2,
                    title: l10n.setupGuideStep2Title,
                    body: l10n.setupGuideStep2Body,
                    icon: Icons.download_outlined,
                    action: FilledButton.tonalIcon(
                      onPressed: () => unawaited(openExternalUrl(kEnvoyDevDownloadUrl)),
                      icon: const Icon(Icons.open_in_new, size: 18),
                      label: Text(l10n.setupGuideDownloadCta),
                    ),
                  ),
                  _GuideStep(
                    number: 3,
                    title: l10n.setupGuideStep3Title,
                    body: l10n.setupGuideStep3Body,
                    icon: Icons.qr_code_2_outlined,
                  ),
                  _GuideStep(
                    number: 4,
                    title: l10n.setupGuideStep4Title,
                    body: l10n.setupGuideStep4Body,
                    icon: Icons.phonelink_setup_outlined,
                  ),
                  _GuideStep(
                    number: 5,
                    title: l10n.setupGuideStep5Title,
                    body: l10n.setupGuideStep5Body,
                    icon: Icons.check_circle_outline,
                  ),
                  const SizedBox(height: CoderSpace.lg),
                  DecoratedBox(
                    decoration: BoxDecoration(
                      color: colors.surface2,
                      borderRadius: BorderRadius.circular(CoderRadius.lg),
                      border: Border.all(color: colors.border),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(CoderSpace.lg),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(l10n.setupGuideNoHomeTitle, style: text.titleSmall),
                          const SizedBox(height: CoderSpace.sm),
                          Text(
                            l10n.setupGuideNoHomeBody,
                            style: text.bodyMedium?.copyWith(
                              color: colors.foregroundMuted,
                              height: 1.4,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(
                  CoderSpace.xl,
                  CoderSpace.sm,
                  CoderSpace.xl,
                  CoderSpace.lg,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (canPair) ...[
                      SizedBox(
                        height: 48,
                        child: FilledButton(
                          onPressed:
                              _closing ? null : () => unawaited(_finish(openPairing: true)),
                          child: Text(l10n.setupGuidePairCta),
                        ),
                      ),
                      const SizedBox(height: CoderSpace.xs),
                      TextButton(
                        onPressed: _closing ? null : () => unawaited(_finish()),
                        child: Text(
                          widget.requirePairing
                              ? l10n.setupGuidePairLaterCta
                              : (widget.isFirstLaunch
                                  ? l10n.setupGuideSkipCta
                                  : l10n.setupGuideDoneCta),
                        ),
                      ),
                    ] else
                      SizedBox(
                        height: 48,
                        child: FilledButton(
                          onPressed: _closing ? null : () => unawaited(_finish()),
                          child: Text(l10n.setupGuideDoneCta),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _GuideStep extends StatelessWidget {
  const _GuideStep({
    required this.number,
    required this.title,
    required this.body,
    required this.icon,
    this.action,
  });

  final int number;
  final String title;
  final String body;
  final IconData icon;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final colors = CoderTheme.of(context);
    final text = Theme.of(context).textTheme;

    return Padding(
      padding: const EdgeInsets.only(bottom: CoderSpace.xl),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(
            radius: 22,
            backgroundColor: colors.accent.withValues(alpha: 0.14),
            foregroundColor: colors.accent,
            child: Icon(icon, size: 22),
          ),
          const SizedBox(width: CoderSpace.md2),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '$number. $title',
                  style: text.titleMedium?.copyWith(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: CoderSpace.xs),
                Text(
                  body,
                  style: text.bodyMedium?.copyWith(
                    color: colors.foregroundMuted,
                    height: 1.45,
                  ),
                ),
                if (action != null) ...[
                  const SizedBox(height: CoderSpace.md2),
                  action!,
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Push the setup guide (reusable from AppBars, Settings, and first-launch).
Future<void> showSetupGuide(
  BuildContext context, {
  bool isFirstLaunch = false,
  Future<bool> Function()? onPairNow,
}) {
  return Navigator.of(context).push(
    MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) => SetupGuideScreen(
        isFirstLaunch: isFirstLaunch,
        onPairNow: onPairNow == null
            ? null
            : () async {
                final ok = await onPairNow();
                if (ok && context.mounted) Navigator.of(context).pop();
                return ok;
              },
      ),
    ),
  );
}
