import 'dart:convert';
import 'dart:typed_data';

import 'package:envoydev_mobile/models/composer_attachment.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('keeps the typed sentence first and puts the file after it', () {
    final result = ingestAttachments(const [], [
      IncomingFile(
        name: 'lib.ts',
        size: 20,
        bytes: Uint8List.fromList(utf8.encode('export const n = 1;\n')),
        mimeType: 'text/plain',
      ),
    ]);
    expect(result.notice, isNull);
    final turn = composeTurn('review this', result.attachments);
    expect(turn.prompt.startsWith('review this'), isTrue);
    expect(turn.prompt, contains('--- lib.ts ---'));
    expect(turn.prompt, contains('export const n = 1;'));
    expect(turn.images, isEmpty);
  });

  test('sends a picture when the field is empty', () {
    final bytes = Uint8List.fromList([1, 2, 3, 4]);
    final result = ingestAttachments(const [], [
      IncomingFile(name: 'shot.png', size: bytes.length, bytes: bytes, mimeType: 'image/png'),
    ]);
    final turn = composeTurn('', result.attachments);
    expect(turn.prompt.startsWith('Look at the attached image.'), isTrue);
    expect(turn.prompt, contains('[Image: shot.png]'));
    expect(turn.images, [
      {'mimeType': 'image/png', 'data': base64Encode(bytes)},
    ]);
  });

  test('refuses a file that is neither an image nor text', () {
    final result = ingestAttachments(const [], [
      IncomingFile(name: 'archive.zip', size: 3, bytes: Uint8List.fromList([0, 1, 2])),
    ]);
    expect(result.attachments, isEmpty);
    expect(result.notice, AttachNotice.binary);
    expect(attachmentNotice(AttachNotice.binary), 'Only images and text files can be attached.');
  });
}
