/// The three ways Paseo's phone field attaches something: a photo, a pasted picture, a file.
///
/// Cancel is `null`. A refusal the user should read is [AttachPick]. Reading stops at the size cap
/// so a video chosen by mistake is not pulled into memory.
library;

import 'dart:io';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:image_picker/image_picker.dart';
import 'package:pasteboard/pasteboard.dart';

import '../l10n/l10n.dart';
import '../models/composer_attachment.dart';

/// A refusal raised by a picker itself, before a file ever reaches [ingestAttachments]. The message
/// is built from the catalogue when it is shown, so no English travels in the exception.
class AttachPick implements Exception {
  const AttachPick();
}

Future<List<IncomingFile>?> pickGalleryImages() async {
  final files = await ImagePicker().pickMultiImage(imageQuality: 80);
  if (files.isEmpty) return null;
  final incoming = <IncomingFile>[];
  for (final file in files) {
    incoming.add(await _load(name: file.name, mimeType: file.mimeType, path: file.path));
  }
  return incoming;
}

Future<List<IncomingFile>?> pickDocuments() async {
  final result = await FilePicker.platform.pickFiles(allowMultiple: true, withData: false);
  if (result == null || result.files.isEmpty) return null;
  final incoming = <IncomingFile>[];
  for (final file in result.files) {
    incoming.add(await _load(
      name: file.name,
      mimeType: null,
      path: file.path,
      knownSize: file.size,
      knownBytes: file.bytes,
    ));
  }
  return incoming;
}

Future<List<IncomingFile>?> pasteClipboardImage() async {
  final bytes = await Pasteboard.image;
  if (bytes == null || bytes.isEmpty) throw const AttachPick();
  final mime = _sniff(bytes) ?? 'image/png';
  final ext = mime == 'image/jpeg' ? 'jpg' : mime.split('/').last;
  return [
    IncomingFile(name: 'image.$ext', size: bytes.length, bytes: bytes, mimeType: mime),
  ];
}

Future<void> takeAttachments({
  required List<ComposerAttachment> current,
  required Future<List<IncomingFile>?> Function() pick,
  required bool Function() stillMounted,
  required void Function(List<ComposerAttachment> attachments, String? notice) apply,
  AppLocalizations? l10n,
}) async {
  final t = l10n ?? lookupAppLocalizations(kFallbackLocale);
  try {
    final files = await pick();
    if (!stillMounted() || files == null) return;
    final result = ingestAttachments(current, files);
    apply(
      result.attachments,
      result.notice == null ? null : attachmentNotice(result.notice!, l10n),
    );
  } on AttachPick {
    if (!stillMounted()) return;
    apply(current, t.attachClipboardMissing);
  } catch (_) {
    if (!stillMounted()) return;
    apply(current, t.attachFailed);
  }
}

Future<IncomingFile> _load({
  required String name,
  required String? path,
  String? mimeType,
  int? knownSize,
  Uint8List? knownBytes,
}) async {
  var size = knownSize ?? knownBytes?.length ?? 0;
  if (size <= 0 && path != null) {
    size = await File(path).length();
  }
  Uint8List? bytes = knownBytes;
  if (bytes == null && path != null && size > 0 && size <= imageMaxBytes) {
    bytes = await File(path).readAsBytes();
    size = bytes.length;
  }
  return IncomingFile(name: name, size: size, bytes: bytes, mimeType: mimeType);
}

String? _sniff(Uint8List bytes) {
  if (bytes.length >= 8 &&
      bytes[0] == 0x89 &&
      bytes[1] == 0x50 &&
      bytes[2] == 0x4e &&
      bytes[3] == 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8) return 'image/jpeg';
  if (bytes.length >= 6 && bytes[0] == 0x47 && bytes[1] == 0x49 && bytes[2] == 0x46) return 'image/gif';
  if (bytes.length >= 12 &&
      bytes[0] == 0x52 &&
      bytes[1] == 0x49 &&
      bytes[2] == 0x46 &&
      bytes[3] == 0x46) {
    return 'image/webp';
  }
  return null;
}
