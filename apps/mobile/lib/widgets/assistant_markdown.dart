/// Highlighted fenced code + Mermaid source block for assistant markdown.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_highlight/flutter_highlight.dart';
import 'package:flutter_highlight/themes/atom-one-dark.dart';
import 'package:flutter_highlight/themes/atom-one-light.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:markdown/markdown.dart' as md;

import '../theme/tokens.dart';

class AssistantMarkdown extends StatelessWidget {
  const AssistantMarkdown({
    super.key,
    required this.text,
    required this.colors,
    this.streaming = false,
  });

  final String text;
  final CoderColors colors;
  final bool streaming;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final prepared = streaming ? _closeOpenFence(text) : text;
    final dark = theme.brightness == Brightness.dark;
    return MarkdownBody(
      data: prepared,
      selectable: true,
      builders: {
        'code': _CodeBuilder(colors: colors, dark: dark),
      },
      styleSheet: MarkdownStyleSheet.fromTheme(theme).copyWith(
        p: theme.textTheme.bodyLarge?.copyWith(color: colors.foreground, height: 1.4),
        h1: theme.textTheme.headlineSmall?.copyWith(color: colors.foreground, fontWeight: FontWeight.bold),
        h2: theme.textTheme.titleLarge?.copyWith(color: colors.foreground, fontWeight: FontWeight.bold),
        h3: theme.textTheme.titleMedium?.copyWith(color: colors.foreground, fontWeight: FontWeight.w600),
        code: TextStyle(
          fontFamily: 'monospace',
          fontSize: 12,
          color: colors.foreground,
          backgroundColor: colors.surface2,
        ),
        codeblockDecoration: const BoxDecoration(),
        codeblockPadding: EdgeInsets.zero,
        blockquoteDecoration: BoxDecoration(
          border: Border(left: BorderSide(color: colors.border, width: 3)),
        ),
        a: TextStyle(color: colors.accentBright),
        listBullet: TextStyle(color: colors.foreground),
      ),
    );
  }
}

String _closeOpenFence(String text) {
  var open = false;
  String? marker;
  for (final line in text.split('\n')) {
    final match = RegExp(r'^(`{3,}|~{3,})').firstMatch(line);
    if (match == null) continue;
    final m = match.group(1)!;
    if (!open) {
      open = true;
      marker = m;
    } else if (marker != null && m[0] == marker[0] && m.length >= marker.length) {
      open = false;
      marker = null;
    }
  }
  return open && marker != null ? '$text\n$marker' : text;
}

class _CodeBuilder extends MarkdownElementBuilder {
  _CodeBuilder({required this.colors, required this.dark});

  final CoderColors colors;
  final bool dark;

  @override
  Widget? visitElementAfter(md.Element element, TextStyle? preferredStyle) {
    final language = element.attributes['class']?.replaceFirst('language-', '');
    final code = element.textContent.replaceFirst(RegExp(r'\n$'), '');
    final isBlock = language != null || code.contains('\n');
    if (!isBlock) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
        decoration: BoxDecoration(
          color: colors.surface2,
          borderRadius: BorderRadius.circular(4),
        ),
        child: Text(
          code,
          style: TextStyle(fontFamily: 'monospace', fontSize: 12, color: colors.foreground),
        ),
      );
    }

    final isMermaid = (language ?? '').toLowerCase() == 'mermaid';
    return _FenceBlock(
      code: code,
      language: language ?? (isMermaid ? 'mermaid' : 'text'),
      colors: colors,
      dark: dark,
      mermaid: isMermaid,
    );
  }
}

class _FenceBlock extends StatelessWidget {
  const _FenceBlock({
    required this.code,
    required this.language,
    required this.colors,
    required this.dark,
    required this.mermaid,
  });

  final String code;
  final String language;
  final CoderColors colors;
  final bool dark;
  final bool mermaid;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: colors.surface2,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: colors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    language,
                    style: TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 11,
                      color: colors.foregroundMuted,
                    ),
                  ),
                ),
                InkWell(
                  onTap: () async {
                    await Clipboard.setData(ClipboardData(text: code));
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Copied'), duration: Duration(seconds: 1)),
                      );
                    }
                  },
                  child: Text('Copy', style: TextStyle(fontSize: 11, color: colors.foregroundMuted)),
                ),
              ],
            ),
          ),
          if (mermaid)
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 0, 10, 6),
              child: Text(
                'Mermaid diagram — source shown here; the computer renders the chart in the desktop app.',
                style: TextStyle(fontSize: 11, color: colors.foregroundMuted),
              ),
            ),
          ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 360),
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(10, 0, 10, 10),
              child: HighlightView(
                code,
                language: _hljsLang(language),
                theme: dark ? atomOneDarkTheme : atomOneLightTheme,
                textStyle: const TextStyle(fontFamily: 'monospace', fontSize: 12, height: 1.45),
                padding: EdgeInsets.zero,
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _hljsLang(String language) {
    switch (language.toLowerCase()) {
      case 'ts':
      case 'tsx':
      case 'typescript':
        return 'typescript';
      case 'js':
      case 'jsx':
      case 'javascript':
        return 'javascript';
      case 'py':
      case 'python':
        return 'python';
      case 'sh':
      case 'shell':
      case 'zsh':
      case 'bash':
        return 'bash';
      case 'yml':
        return 'yaml';
      case 'mermaid':
        return 'plaintext';
      default:
        return language.toLowerCase();
    }
  }
}
