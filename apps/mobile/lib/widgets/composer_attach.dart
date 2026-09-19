/// The attach control on the phone composer: a button, three actions, and the pills above the field.
library;

import 'dart:convert';

import 'package:flutter/material.dart';

import '../models/composer_attachment.dart';
import '../theme/tokens.dart';

class AttachmentTray extends StatelessWidget {
  const AttachmentTray({
    super.key,
    required this.attachments,
    required this.onRemove,
    this.notice,
  });

  final List<ComposerAttachment> attachments;
  final ValueChanged<String> onRemove;
  final String? notice;

  @override
  Widget build(BuildContext context) {
    final colors = CoderTheme.of(context);
    if (attachments.isEmpty && (notice == null || notice!.isEmpty)) {
      return const SizedBox.shrink();
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (attachments.isNotEmpty)
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final attachment in attachments)
                  InputChip(
                    label: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 180),
                      child: Text(attachment.name, overflow: TextOverflow.ellipsis),
                    ),
                    avatar: attachment.kind == AttachmentKind.image && attachment.data != null
                        ? ClipRRect(
                            borderRadius: BorderRadius.circular(4),
                            child: Image.memory(
                              base64Decode(attachment.data!),
                              width: 18,
                              height: 18,
                              fit: BoxFit.cover,
                              gaplessPlayback: true,
                              errorBuilder: (_, __, ___) => const Icon(Icons.image, size: 16),
                            ),
                          )
                        : const Icon(Icons.insert_drive_file_outlined, size: 16),
                    onDeleted: () => onRemove(attachment.id),
                    deleteButtonTooltipMessage: 'Remove ${attachment.name}',
                  ),
              ],
            ),
          if (notice != null && notice!.isNotEmpty) ...[
            if (attachments.isNotEmpty) const SizedBox(height: 6),
            Text(notice!, style: TextStyle(color: colors.statusDanger, fontSize: 13)),
          ],
        ],
      ),
    );
  }
}

class AttachMenuButton extends StatelessWidget {
  const AttachMenuButton({
    super.key,
    required this.enabled,
    required this.onImage,
    required this.onPaste,
    required this.onFile,
  });

  final bool enabled;
  final VoidCallback onImage;
  final VoidCallback onPaste;
  final VoidCallback onFile;

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<String>(
      enabled: enabled,
      tooltip: 'Attach',
      icon: const Icon(Icons.attach_file),
      onSelected: (value) {
        switch (value) {
          case 'image':
            onImage();
          case 'paste':
            onPaste();
          case 'file':
            onFile();
        }
      },
      itemBuilder: (context) => const [
        PopupMenuItem(value: 'image', child: Text('Add image')),
        PopupMenuItem(value: 'paste', child: Text('Paste image')),
        PopupMenuItem(value: 'file', child: Text('Add file')),
      ],
    );
  }
}
