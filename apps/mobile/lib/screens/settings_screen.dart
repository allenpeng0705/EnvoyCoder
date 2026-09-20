/// Settings for the paired home daemon — thin-client configuration, not local agent state.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/l10n.dart';
import '../l10n/locale_controller.dart';
import '../models/harness.dart';
import '../services/host_client.dart';
import '../theme/tokens.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({
    super.key,
    required this.client,
    required this.harnesses,
    this.localeController,
  });

  final HostClient client;
  final List<HarnessInfo> harnesses;

  /// The phone's own language preference. Null only in tests that are not exercising the picker.
  final LocaleController? localeController;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  bool _loading = true;
  bool _saving = false;
  String? _error;

  bool _requireApproval = true;
  bool _keepTranscripts = true;
  String _language = kSystemLanguagePreference;
  String? _defaultHarness;
  bool _apiKeySet = false;
  bool _clearApiKey = false;
  final _model = TextEditingController();
  final _baseUrl = TextEditingController();
  final _apiKey = TextEditingController();

  @override
  void initState() {
    super.initState();
    // The phone's own preference owns the picker's value; the daemon's `language` is only the
    // fallback for a build with no `LocaleController` injected (a widget test).
    _language = widget.localeController?.preference ?? kSystemLanguagePreference;
    unawaited(_load());
  }

  @override
  void dispose() {
    _model.dispose();
    _baseUrl.dispose();
    _apiKey.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final settingsResult = await widget.client.call('coder.getSettings', {});
      final settings = settingsResult['settings'];
      Map<String, dynamic>? llm;
      try {
        llm = await widget.client.call('coder.getEnvoyLlm', {});
      } catch (_) {
        llm = null;
      }
      if (!mounted) return;
      setState(() {
        if (settings is Map) {
          _requireApproval = settings['requireApprovalForDestructive'] != false;
          _keepTranscripts = settings['keepTranscripts'] != false;
          if (widget.localeController == null) {
            _language = (settings['language'] as String?) ?? kSystemLanguagePreference;
          }
          final defaults = settings['defaults'];
          if (defaults is Map) {
            _defaultHarness = defaults['harness'] as String?;
          }
        }
        if (llm != null) {
          final provider = (llm['provider'] as String?) ?? '';
          final model = (llm['model'] as String?) ?? '';
          _model.text = provider.isEmpty || provider == 'openai' ? model : '$provider/$model';
          _baseUrl.text = (llm['baseUrl'] as String?) ?? '';
          _apiKeySet = llm['apiKeySet'] == true;
          _clearApiKey = false;
          _apiKey.clear();
        }
        _loading = false;
        _error = null;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = context.l10n.settingsLoadFailed;
      });
    }
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await widget.client.call('coder.updateSettings', {
        'settings': {
          'requireApprovalForDestructive': _requireApproval,
          'keepTranscripts': _keepTranscripts,
          'language': _language,
          'defaults': {
            if (_defaultHarness != null && _defaultHarness!.isNotEmpty) 'harness': _defaultHarness,
          },
        },
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.settingsSaveFailed)),
      );
      return;
    }

    final model = _model.text.trim();
    if (model.isEmpty) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.settingsSaveNoModel)),
      );
      return;
    }

    try {
      await widget.client.call('coder.setEnvoyLlm', {
        // The daemon re-derives the provider from the model string.
        'provider': 'openai',
        'model': model,
        'baseUrl': _baseUrl.text.trim(),
        if (_clearApiKey && _apiKey.text.trim().isEmpty) 'clearApiKey': true,
        if (_apiKey.text.trim().isNotEmpty) 'apiKey': _apiKey.text.trim(),
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.settingsSavedOnComputer)),
      );
      await _load();
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.settingsSavedLlmFailed)),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  /// Change the phone's language **now**, and tell the daemon so the desktop follows.
  ///
  /// The order is the point. The local write is what the user sees, and it happens first and alone
  /// decides the UI; the daemon patch is a second, best-effort step (`coder.updateSettings` merges a
  /// patch, so sending only `language` cannot disturb the other settings). If the daemon refuses —
  /// offline, an older build — the phone keeps the language the user picked and says which half did
  /// not save, rather than silently splitting the two surfaces or rolling the UI back.
  Future<void> _changeLanguage(String value) async {
    setState(() => _language = value);
    await widget.localeController?.setPreference(value);
    try {
      await widget.client.call('coder.updateSettings', {
        'settings': {'language': value},
      });
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.settingsLanguageDaemonFailed)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final colors = CoderTheme.of(context);
    final offered = offeredHarnesses(widget.harnesses);
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.settingsTitle),
        actions: [
          TextButton(
            onPressed: _saving || _loading ? null : () => unawaited(_save()),
            child: Text(_saving ? l10n.commonSaving : l10n.commonSave),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              children: [
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: Text(_error!, style: TextStyle(color: colors.statusDanger)),
                  ),
                ListTile(
                  title: Text(l10n.settingsComputerHeading),
                  subtitle: Text(l10n.settingsComputerDetail),
                ),
                SwitchListTile(
                  title: Text(l10n.settingsApprovals),
                  value: _requireApproval,
                  onChanged: (v) => setState(() => _requireApproval = v),
                ),
                SwitchListTile(
                  title: Text(l10n.settingsTranscripts),
                  value: _keepTranscripts,
                  onChanged: (v) => setState(() => _keepTranscripts = v),
                ),
                ListTile(
                  title: Text(l10n.settingsLanguage),
                  trailing: DropdownButton<String>(
                    value: _language,
                    items: [
                      DropdownMenuItem(
                        value: kSystemLanguagePreference,
                        child: Text(l10n.settingsLanguageSystem),
                      ),
                      for (final locale in AppLocalizations.supportedLocales)
                        DropdownMenuItem(
                          value: locale.languageCode,
                          child: Text(kLocaleEndonyms[locale.languageCode] ?? locale.languageCode),
                        ),
                    ],
                    onChanged: (v) {
                      if (v != null) unawaited(_changeLanguage(v));
                    },
                  ),
                ),
                ListTile(
                  title: Text(l10n.settingsDefaultAgent),
                  trailing: DropdownButton<String>(
                    value: offered.any((h) => h.id == _defaultHarness) ? _defaultHarness : null,
                    hint: Text(l10n.commonNotSet),
                    items: [
                      for (final h in offered)
                        DropdownMenuItem(value: h.id, child: Text(h.label)),
                    ],
                    onChanged: (v) => setState(() => _defaultHarness = v),
                  ),
                ),
                const Divider(),
                ListTile(
                  title: Text(l10n.settingsLlmHeading),
                  subtitle: Text(l10n.settingsLlmDetail),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  child: TextField(
                    controller: _baseUrl,
                    decoration: InputDecoration(
                      labelText: l10n.settingsBaseUrl,
                      hintText: l10n.settingsBaseUrlHint,
                      border: const OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  child: TextField(
                    controller: _model,
                    decoration: InputDecoration(
                      labelText: l10n.settingsModel,
                      hintText: l10n.settingsModelHint,
                      border: const OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
                if (_apiKeySet && !_clearApiKey)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                    child: Row(
                      children: [
                        Expanded(child: Text(l10n.settingsApiKeySaved)),
                        TextButton(
                          onPressed: _saving
                              ? null
                              : () => setState(() {
                                    _clearApiKey = true;
                                    _apiKey.clear();
                                  }),
                          child: Text(l10n.commonClear),
                        ),
                      ],
                    ),
                  )
                else
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                    child: TextField(
                      controller: _apiKey,
                      obscureText: true,
                      decoration: InputDecoration(
                        labelText: l10n.settingsApiKey,
                        hintText: l10n.settingsApiKeyHint,
                        border: const OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                  ),
              ],
            ),
    );
  }
}
