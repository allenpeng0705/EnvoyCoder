/// The app's one "give this thing a name" dialog.
///
/// It exists for the same reason `confirm_dialog.dart` does: two callers (renaming a task, naming or
/// renaming a connection) need exactly one shape — a field prefilled with the name it has now, a
/// Cancel, and a labelled confirm — and two hand-rolled `AlertDialog`s is how one of them ends up
/// without validation or with the wrong button order. The confirmation widget stays separate: this
/// one returns a *name*, that one returns a *decision*, and collapsing them would make every caller
/// carry both a text field and a yes/no.
///
/// ## Blank is two different things, and the caller says which
///
/// * [emptyError] set (renaming something that must have a name) — a blank field is refused **in the
///   dialog**, with that sentence, and the dialog stays open. The old name is untouched.
/// * [emptyError] null (naming a connection while pairing, where a default already exists) — a blank
///   field is not an error; it means "keep the default", and the dialog returns [initialValue]. Naming
///   is never mandatory: a user who scans a code and wants to get on with it taps the confirm and the
///   connection keeps the address as its name.
library;

import 'package:flutter/material.dart';

/// Ask for a name, prefilled with [initialValue]; `null` only when the user backed out.
///
/// The returned string is trimmed. When the field was cleared and [emptyError] is null, the trimmed
/// empty string is replaced by [initialValue] — the default the caller supplied — so a caller never
/// has to re-implement "blank means keep the old name".
Future<String?> showNameDialog(
  BuildContext context, {
  required String title,
  required String fieldLabel,
  required String initialValue,
  required String confirmLabel,
  String? emptyError,
  String? helperText,
}) {
  return showDialog<String>(
    context: context,
    builder: (context) => _NameDialog(
      title: title,
      fieldLabel: fieldLabel,
      initialValue: initialValue,
      confirmLabel: confirmLabel,
      emptyError: emptyError,
      helperText: helperText,
    ),
  );
}

/// A `StatefulWidget` rather than a controller created around `showDialog` **because the field's
/// controller must outlive the pop**: disposing it as soon as the dialog's future completes frees it
/// while the route is still animating out and still rebuilding the `TextField`, and Flutter then
/// throws "A TextEditingController was used after being disposed". Owning it in `State.dispose`
/// disposes it when the route is actually gone. The rejection is worth recording: the shorter version
/// passed a single pump and failed the moment the dialog was closed by a running app.
class _NameDialog extends StatefulWidget {
  const _NameDialog({
    required this.title,
    required this.fieldLabel,
    required this.initialValue,
    required this.confirmLabel,
    this.emptyError,
    this.helperText,
  });

  final String title;
  final String fieldLabel;
  final String initialValue;
  final String confirmLabel;
  final String? emptyError;
  final String? helperText;

  @override
  State<_NameDialog> createState() => _NameDialogState();
}

class _NameDialogState extends State<_NameDialog> {
  late final TextEditingController _controller =
      TextEditingController(text: widget.initialValue);
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    final value = _controller.text.trim();
    if (value.isEmpty && widget.emptyError != null) {
      setState(() => _error = widget.emptyError);
      return;
    }
    // Blank with no `emptyError` is "keep the default", not "name it nothing".
    Navigator.of(context).pop(value.isEmpty ? widget.initialValue : value);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.title),
      content: TextField(
        controller: _controller,
        autofocus: true,
        textInputAction: TextInputAction.done,
        // Enter submits as well as the button — a name typed and then confirmed on the keyboard is
        // still a name the user meant.
        onSubmitted: (_) => _submit(),
        decoration: InputDecoration(
          labelText: widget.fieldLabel,
          helperText: widget.helperText,
          errorText: _error,
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(onPressed: _submit, child: Text(widget.confirmLabel)),
      ],
    );
  }
}
