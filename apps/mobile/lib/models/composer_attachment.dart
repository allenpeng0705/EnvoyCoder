/// What a message on the phone can carry besides words.
///
/// Pictures travel as image blocks. Text files are written into the prompt under their name.
/// Anything else is refused: the file is on the phone, and the agent on the computer cannot open it.
library;

import 'dart:convert';
import 'dart:typed_data';

import '../l10n/l10n.dart';

const int maxAttachments = 8;
const int imageMaxBytes = 4 * 1024 * 1024;
const int textMaxBytes = 256 * 1024;

enum AttachmentKind { image, text }

enum AttachNotice { tooBig, binary, unreadable, empty, limit }

class ComposerAttachment {
  const ComposerAttachment({
    required this.id,
    required this.name,
    required this.mimeType,
    required this.kind,
    this.data,
    this.text,
  });

  final String id;
  final String name;
  final String mimeType;
  final AttachmentKind kind;

  /// Base64, no `data:` prefix. Images only.
  final String? data;

  /// Text files only.
  final String? text;
}

class IncomingFile {
  const IncomingFile({
    required this.name,
    required this.size,
    this.bytes,
    this.mimeType,
  });

  final String name;
  final int size;
  final Uint8List? bytes;
  final String? mimeType;
}

class ComposerTurn {
  const ComposerTurn({required this.prompt, required this.images});

  final String prompt;

  /// `{mimeType, data}` objects, ready for `coder.startRun` / `coder.sendToRun`.
  final List<Map<String, String>> images;
}

class IngestResult {
  const IngestResult({required this.attachments, this.notice});

  final List<ComposerAttachment> attachments;
  final AttachNotice? notice;
}

const _imageMime = <String, String>{
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'gif': 'image/gif',
  'webp': 'image/webp',
  'bmp': 'image/bmp',
};

const _textExtensions = <String>{
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'md', 'mdx', 'txt', 'css', 'scss', 'html', 'htm',
  'xml', 'yml', 'yaml', 'toml', 'rs', 'py', 'go', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp',
  'cs', 'rb', 'php', 'sh', 'bash', 'zsh', 'sql', 'csv', 'vue', 'svelte', 'graphql', 'proto', 'lua',
  'dart', 'zig', 'ini', 'env', 'lock',
};

const _textNames = <String>{
  'dockerfile', 'makefile', 'license', 'readme', 'gemfile', 'rakefile',
};

/// The refusal in the user's language.
///
/// [l10n] is optional only so a unit test can call this without a widget tree; the English it then
/// falls back to is the generated catalogue, not a second copy.
String attachmentNotice(AttachNotice notice, [AppLocalizations? l10n]) {
  final t = l10n ?? lookupAppLocalizations(kFallbackLocale);
  switch (notice) {
    case AttachNotice.tooBig:
      return t.attachTooBig;
    case AttachNotice.binary:
      return t.attachBinary;
    case AttachNotice.unreadable:
      return t.attachUnreadable;
    case AttachNotice.empty:
      return t.attachEmpty;
    case AttachNotice.limit:
      return t.attachLimit(maxAttachments);
  }
}

String _extensionOf(String name) {
  final base = name.split(RegExp(r'[/\\]')).last;
  final dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.substring(dot + 1).toLowerCase();
}

String? _imageMimeOf(String name, String? mimeType) {
  final type = (mimeType ?? '').toLowerCase();
  if (type == 'image/jpg') return 'image/jpeg';
  if (_imageMime.containsValue(type)) return type;
  return _imageMime[_extensionOf(name)];
}

bool _isText(String name, String? mimeType) {
  final type = (mimeType ?? '').toLowerCase();
  if (type.startsWith('text/')) return true;
  if (type == 'application/json' ||
      type == 'application/javascript' ||
      type == 'application/xml' ||
      type == 'application/yaml' ||
      type == 'application/x-yaml' ||
      type == 'application/toml') {
    return true;
  }
  final base = name.split(RegExp(r'[/\\]')).last.toLowerCase();
  if (base.startsWith('.') || _textNames.contains(base)) return true;
  return _textExtensions.contains(_extensionOf(name));
}

AttachNotice? _readOne(IncomingFile file, List<ComposerAttachment> into, int index) {
  final size = file.bytes?.length ?? file.size;
  if (size <= 0) return AttachNotice.empty;
  final imageMime = _imageMimeOf(file.name, file.mimeType);
  if (imageMime != null) {
    if (size > imageMaxBytes) return AttachNotice.tooBig;
    final bytes = file.bytes;
    if (bytes == null) return AttachNotice.unreadable;
    into.add(ComposerAttachment(
      id: 'a${DateTime.now().microsecondsSinceEpoch}-$index',
      name: file.name.isEmpty ? 'image' : file.name,
      mimeType: imageMime,
      kind: AttachmentKind.image,
      data: base64Encode(bytes),
    ));
    return null;
  }
  if (!_isText(file.name, file.mimeType)) return AttachNotice.binary;
  if (size > textMaxBytes) return AttachNotice.tooBig;
  final bytes = file.bytes;
  if (bytes == null) return AttachNotice.unreadable;
  if (bytes.contains(0)) return AttachNotice.binary;
  try {
    into.add(ComposerAttachment(
      id: 'a${DateTime.now().microsecondsSinceEpoch}-$index',
      name: file.name.isEmpty ? 'file' : file.name,
      mimeType: (file.mimeType == null || file.mimeType!.isEmpty) ? 'text/plain' : file.mimeType!,
      kind: AttachmentKind.text,
      text: utf8.decode(bytes),
    ));
  } on FormatException {
    return AttachNotice.unreadable;
  }
  return null;
}

/// Fold new files into the list the field is already holding. The last refusal is the one shown.
IngestResult ingestAttachments(List<ComposerAttachment> current, List<IncomingFile> incoming) {
  final next = List<ComposerAttachment>.of(current);
  AttachNotice? notice;
  var index = 0;
  for (final file in incoming) {
    if (next.length >= maxAttachments) {
      notice = AttachNotice.limit;
      break;
    }
    final reason = _readOne(file, next, index);
    index += 1;
    if (reason != null) notice = reason;
  }
  return IngestResult(attachments: next, notice: notice);
}

/// The words the agent receives, plus any pictures beside them.
///
/// The first line stays the user's own sentence when they typed one, because that line is also the
/// task's name. A turn that is only pictures still has a sentence, so the prompt is never empty.
/// That generated sentence is translated, exactly as the desktop translates it — the agent is told
/// what the user meant in the language the user is working in.
///
/// [l10n] is optional only so a unit test can call this without a widget tree.
ComposerTurn composeTurn(String text, List<ComposerAttachment> attachments, [AppLocalizations? l10n]) {
  final t = l10n ?? lookupAppLocalizations(kFallbackLocale);
  final images = <Map<String, String>>[];
  final files = <ComposerAttachment>[];
  for (final attachment in attachments) {
    if (attachment.kind == AttachmentKind.image && attachment.data != null && attachment.data!.isNotEmpty) {
      images.add({'mimeType': attachment.mimeType, 'data': attachment.data!});
    } else if (attachment.kind == AttachmentKind.text && attachment.text != null) {
      files.add(attachment);
    }
  }
  final trimmed = text.trim();
  final names = attachments.map((attachment) => attachment.name).join(', ');
  final lead = trimmed.isNotEmpty
      ? trimmed
      : files.isEmpty && images.length == 1
          ? t.attachImagesOnly
          : files.isEmpty && images.length > 1
              ? t.attachImagesOnlyMany
              : attachments.isNotEmpty
                  ? t.attachNamed(names)
                  : '';
  final notes = attachments
      .where((attachment) => attachment.kind == AttachmentKind.image)
      .map((attachment) => '[Image: ${attachment.name}]');
  final bodies = files.map((file) => '--- ${file.name} ---\n${file.text ?? ''}');
  final prompt = [lead, ...notes, ...bodies].where((part) => part.isNotEmpty).join('\n\n');
  return ComposerTurn(prompt: prompt, images: images);
}

bool canSendComposer(String text, List<ComposerAttachment> attachments) {
  return text.trim().isNotEmpty || attachments.isNotEmpty;
}
