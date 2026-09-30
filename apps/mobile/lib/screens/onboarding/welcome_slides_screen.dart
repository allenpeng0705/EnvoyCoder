/// First-launch carousel introducing EnvoyDev, the desktop host, and pairing.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../../l10n/l10n.dart';
import '../../services/onboarding_preferences.dart';
import '../../theme/tokens.dart';

class WelcomeSlidesScreen extends StatefulWidget {
  const WelcomeSlidesScreen({
    super.key,
    required this.onFinished,
  });

  /// Called after slides are marked complete (the setup guide may still follow).
  final VoidCallback onFinished;

  @override
  State<WelcomeSlidesScreen> createState() => _WelcomeSlidesScreenState();
}

class _WelcomeSlidesScreenState extends State<WelcomeSlidesScreen> {
  final _pageController = PageController();
  int _index = 0;
  bool _finishing = false;

  static const _pageCount = 4;

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  Future<void> _finish() async {
    if (_finishing) return;
    setState(() => _finishing = true);
    await OnboardingPreferences.setSlidesCompleted();
    if (!mounted) return;
    widget.onFinished();
  }

  void _next() {
    if (_finishing) return;
    if (_index >= _pageCount - 1) {
      unawaited(_finish());
      return;
    }
    _pageController.nextPage(
      duration: const Duration(milliseconds: 280),
      curve: Curves.easeOutCubic,
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final colors = CoderTheme.of(context);
    final pages = [
      _SlideData(
        icon: Icons.phone_iphone_outlined,
        title: l10n.welcomeSlide1Title,
        body: l10n.welcomeSlide1Body,
        showBrand: true,
      ),
      _SlideData(
        icon: Icons.computer_outlined,
        title: l10n.welcomeSlide2Title,
        body: l10n.welcomeSlide2Body,
      ),
      _SlideData(
        icon: Icons.qr_code_scanner_outlined,
        title: l10n.welcomeSlide3Title,
        body: l10n.welcomeSlide3Body,
      ),
      _SlideData(
        icon: Icons.link_outlined,
        title: l10n.welcomeSlideRequiredTitle,
        body: l10n.welcomeSlideRequiredBody,
      ),
    ];

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                onPressed: _finishing ? null : () => unawaited(_finish()),
                child: Text(l10n.welcomeSkip),
              ),
            ),
            Expanded(
              child: PageView.builder(
                controller: _pageController,
                itemCount: pages.length,
                onPageChanged: (i) => setState(() => _index = i),
                itemBuilder: (context, i) {
                  final page = pages[i];
                  return LayoutBuilder(
                    builder: (context, constraints) {
                      return SingleChildScrollView(
                        padding: const EdgeInsets.symmetric(horizontal: CoderSpace.xl),
                        child: ConstrainedBox(
                          constraints: BoxConstraints(minHeight: constraints.maxHeight),
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              if (page.showBrand) ...[
                                Container(
                                  width: 88,
                                  height: 88,
                                  decoration: BoxDecoration(
                                    color: colors.accent.withValues(alpha: 0.14),
                                    borderRadius: BorderRadius.circular(CoderRadius.xl2),
                                  ),
                                  child: Icon(Icons.code, size: 44, color: colors.accent),
                                ),
                                const SizedBox(height: CoderSpace.xl),
                              ] else ...[
                                Container(
                                  width: 96,
                                  height: 96,
                                  decoration: BoxDecoration(
                                    color: colors.accent.withValues(alpha: 0.14),
                                    shape: BoxShape.circle,
                                  ),
                                  child: Icon(page.icon, size: 48, color: colors.accent),
                                ),
                                const SizedBox(height: CoderSpace.xl),
                              ],
                              Text(
                                page.title,
                                textAlign: TextAlign.center,
                                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                                      fontWeight: FontWeight.w700,
                                      color: colors.foreground,
                                    ),
                              ),
                              const SizedBox(height: CoderSpace.lg),
                              Text(
                                page.body,
                                textAlign: TextAlign.center,
                                style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                                      color: colors.foregroundMuted,
                                      height: 1.5,
                                    ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  );
                },
              ),
            ),
            Semantics(
              label: '${_index + 1} / ${pages.length}',
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(pages.length, (i) {
                  final active = i == _index;
                  return AnimatedContainer(
                    duration: const Duration(milliseconds: 180),
                    margin: const EdgeInsets.symmetric(horizontal: 4),
                    width: active ? 20 : 8,
                    height: 8,
                    decoration: BoxDecoration(
                      color: active ? colors.accent : colors.border,
                      borderRadius: BorderRadius.circular(999),
                    ),
                  );
                }),
              ),
            ),
            const SizedBox(height: CoderSpace.xl),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                CoderSpace.xl,
                0,
                CoderSpace.xl,
                CoderSpace.xl,
              ),
              child: SizedBox(
                width: double.infinity,
                height: 48,
                child: FilledButton(
                  onPressed: _finishing ? null : _next,
                  child: Text(
                    _index >= _pageCount - 1 ? l10n.commonContinue : l10n.welcomeNext,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SlideData {
  const _SlideData({
    required this.icon,
    required this.title,
    required this.body,
    this.showBrand = false,
  });

  final IconData icon;
  final String title;
  final String body;
  final bool showBrand;
}
