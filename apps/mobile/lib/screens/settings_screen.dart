/// Settings for the paired home daemon — thin-client configuration, not local agent state.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../models/harness.dart';
import '../services/host_client.dart';
import '../theme/tokens.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({
    super.key,
    required this.client,
    required this.harnesses,
  });

  final HostClient client;
  final List<HarnessInfo> harnesses;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  bool _loading = true;
  bool _saving = false;
  String? _error;

  bool _requireApproval = true;
  bool _keepTranscripts = true;
  String _language = 'system';
  String? _defaultHarness;
  bool _apiKeySet = false;
  bool _clearApiKey = false;
  final _model = TextEditingController();
  final _baseUrl = TextEditingController();
  final _apiKey = TextEditingController();

  @override
  void initState() {
    super.initState();
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
          _language = (settings['language'] as String?) ?? 'system';
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
        _error = 'Could not load settings.';
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
        const SnackBar(content: Text('Could not save settings.')),
      );
      return;
    }

    final model = _model.text.trim();
    if (model.isEmpty) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Settings saved. Enter a model to save LLM settings.')),
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
        const SnackBar(content: Text('Settings saved on the computer.')),
      );
      await _load();
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Settings saved, but the LLM settings were not.')),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = CoderTheme.of(context);
    final offered = offeredHarnesses(widget.harnesses);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
        actions: [
          TextButton(
            onPressed: _saving || _loading ? null : () => unawaited(_save()),
            child: Text(_saving ? 'Saving…' : 'Save'),
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
                const ListTile(
                  title: Text('On the computer'),
                  subtitle: Text(
                    'These settings live on the paired machine. The phone only changes them.',
                  ),
                ),
                SwitchListTile(
                  title: const Text('Ask before anything destructive'),
                  value: _requireApproval,
                  onChanged: (v) => setState(() => _requireApproval = v),
                ),
                SwitchListTile(
                  title: const Text('Keep transcripts after a task ends'),
                  value: _keepTranscripts,
                  onChanged: (v) => setState(() => _keepTranscripts = v),
                ),
                ListTile(
                  title: const Text('Language'),
                  trailing: DropdownButton<String>(
                    value: _language,
                    items: const [
                      DropdownMenuItem(value: 'system', child: Text('System')),
                      DropdownMenuItem(value: 'en', child: Text('English')),
                      DropdownMenuItem(value: 'zh', child: Text('中文')),
                      DropdownMenuItem(value: 'ja', child: Text('日本語')),
                      DropdownMenuItem(value: 'ko', child: Text('한국어')),
                      DropdownMenuItem(value: 'de', child: Text('Deutsch')),
                      DropdownMenuItem(value: 'fr', child: Text('Français')),
                      DropdownMenuItem(value: 'it', child: Text('Italiano')),
                    ],
                    onChanged: (v) {
                      if (v != null) setState(() => _language = v);
                    },
                  ),
                ),
                ListTile(
                  title: const Text('Default coding agent'),
                  trailing: DropdownButton<String>(
                    value: offered.any((h) => h.id == _defaultHarness) ? _defaultHarness : null,
                    hint: const Text('Not set'),
                    items: [
                      for (final h in offered)
                        DropdownMenuItem(value: h.id, child: Text(h.label)),
                    ],
                    onChanged: (v) => setState(() => _defaultHarness = v),
                  ),
                ),
                const Divider(),
                const ListTile(
                  title: Text('LLM'),
                  subtitle: Text(
                    'Base URL, model and API key for Envoy Harness. Other agents keep their own sign-in.',
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  child: TextField(
                    controller: _baseUrl,
                    decoration: const InputDecoration(
                      labelText: 'Base URL',
                      hintText: 'Optional — leave empty for the provider default',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  child: TextField(
                    controller: _model,
                    decoration: const InputDecoration(
                      labelText: 'Model',
                      hintText: 'gpt-4o or anthropic/claude-sonnet-4-5',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
                if (_apiKeySet && !_clearApiKey)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                    child: Row(
                      children: [
                        const Expanded(child: Text('API key saved on this computer.')),
                        TextButton(
                          onPressed: _saving
                              ? null
                              : () => setState(() {
                                    _clearApiKey = true;
                                    _apiKey.clear();
                                  }),
                          child: const Text('Clear'),
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
                      decoration: const InputDecoration(
                        labelText: 'API key',
                        hintText: 'Paste a new key to replace the saved one',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                  ),
              ],
            ),
    );
  }
}
