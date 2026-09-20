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

  /// The pairing this phone holds with the daemon behind [SettingsScreen.client], read once when the
  /// screen opens. A `Future`, not a field, because the read is a keychain call.
  late final Future<PairingState> _pairing = widget.client.pairingState();

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
                _PairingTile(pairing: _pairing, hostLabel: widget.client.host.label),
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

/// The current pairing, in the phone's own words.
///
/// **What it shows, and the one thing it deliberately does not.** The line names the desktop with the
/// *connection's own label* — the name the user chose in this app, read out of the host record the
/// client was built with, not a name the daemon sent — and the last time **this phone** reached it.
///
/// That timestamp is the phone's own record, made when the daemon accepted the token and answered
/// `coder.hello`. The wire carries no client-facing last-seen field (`coder.hello`'s result has no
/// such member), so presenting one would be inventing data. The subtitle says whose clock it is, in
/// the user's language, rather than leaving a bare timestamp that reads as the desktop's report.
class _PairingTile extends StatelessWidget {
  const _PairingTile({required this.pairing, required this.hostLabel});

  final Future<PairingState> pairing;

  /// The connection's own name, from the host record this client was built with. Shown rather than
  /// sent: the daemon has no name for itself in this app's list (`ConnectionsController.renameHost`
  /// is local-only), so the phone's word for the machine is the only one there is.
  final String hostLabel;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return FutureBuilder<PairingState>(
      future: pairing,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return ListTile(
            title: Text(l10n.settingsPairingHeading),
            trailing: const SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
          );
        }
        // A read that threw is a different sentence from "there is no pairing": one says the phone
        // could not read what it stored, the other says there is nothing stored. Collapsing them
        // would tell a user with a pairing that they have none.
        if (snapshot.hasError) {
          return ListTile(
            title: Text(l10n.settingsPairingHeading),
            subtitle: Text(l10n.settingsPairingUnavailable),
          );
        }
        final state = snapshot.data;
        final record = state?.record;
        if (record == null || record.token.isEmpty) {
          return ListTile(
            title: Text(l10n.settingsPairingHeading),
            subtitle: Text(state?.refused == true
                ? l10n.settingsPairingNotPaired
                : l10n.settingsPairingNotReached),
          );
        }
        return ListTile(
          title: Text(l10n.settingsPairingPairedWith(hostLabel)),
          subtitle: Text(
            record.lastSeenAt == null
                ? l10n.settingsPairingNotReached
                : _pairingSeenLabel(context, record.lastSeenAt!),
          ),
        );
      },
    );
  }
}

/// When this phone last reached the paired desktop, as a sentence.
///
/// Buckets rather than a live clock: a Settings page that re-rendered "just now" into "1 minute ago"
/// under the user is churn, and the page is opened to read a fact, not to watch one.
String _pairingSeenLabel(BuildContext context, DateTime seen) {
  final l10n = context.l10n;
  final elapsed = DateTime.now().difference(seen);
  if (elapsed.inMinutes < 1) return l10n.settingsPairingJustNow;
  if (elapsed.inHours < 1) return l10n.settingsPairingMinutesAgo(elapsed.inMinutes);
  if (elapsed.inDays < 1) return l10n.settingsPairingHoursAgo(elapsed.inHours);
  // Older than a day: the date is the fact, formatted by the framework's own localized patterns so
  // the ordering and the separators are the user's, not this app's.
  return l10n.settingsPairingOnDate(MaterialLocalizations.of(context).formatShortDate(seen));
}
