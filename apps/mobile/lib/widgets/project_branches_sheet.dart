/// The phone's branch sheet: which branch the project is on, and how to change it.
///
/// ## Why a sheet, and why the commands still run on the desktop
///
/// Branches belong to the **project folder on the desktop**, so this surface sends two method calls
/// (`coder.gitCheckout`, `coder.gitCreateBranch`) and the daemon builds the argv — the phone never runs git,
/// and it never sends a command line. What it *does* is the part a phone is good at: the list, the current
/// branch, and a field to name a new one.
///
/// ## The two facts it refuses to paper over
///
///   * **A detached HEAD is said out loud.** A repository on a commit with no branch is not "a branch with a
///     strange name"; reading it that way is how somebody commits onto a commit instead of onto a branch.
///   * **A refusal stays in the sheet.** Git's own answer — a name it will not accept, a switch that would
///     overwrite local work — is rendered where the action was taken, in the user's language, rather than
///     dropped into a banner the user has to connect back to this sheet.
///
/// The wording is the window's, verbatim (`tool/desktop-reuse.json`), so the two surfaces say one thing.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/daemon_text.dart';
import '../l10n/l10n.dart';
import '../models/git.dart';
import '../models/project_rail.dart';
import '../services/host_client.dart';
import '../theme/tokens.dart';

/// What a successful write left behind, so the caller's chip can follow it.
typedef GitSnapshot = void Function(GitStatusInfo status, List<GitBranchInfo> branches);

Future<void> showProjectBranchesSheet({
  required BuildContext context,
  required HostClient client,
  required ProjectInfo project,
  required GitStatusInfo status,
  required List<GitBranchInfo> branches,
  required GitSnapshot onChanged,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (context) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: _ProjectBranchesSheet(
        client: client,
        project: project,
        status: status,
        branches: branches,
        onChanged: onChanged,
      ),
    ),
  );
}

class _ProjectBranchesSheet extends StatefulWidget {
  const _ProjectBranchesSheet({
    required this.client,
    required this.project,
    required this.status,
    required this.branches,
    required this.onChanged,
  });

  final HostClient client;
  final ProjectInfo project;
  final GitStatusInfo status;
  final List<GitBranchInfo> branches;
  final GitSnapshot onChanged;

  @override
  State<_ProjectBranchesSheet> createState() => _ProjectBranchesSheetState();
}

class _ProjectBranchesSheetState extends State<_ProjectBranchesSheet> {
  late GitStatusInfo _status = widget.status;
  late List<GitBranchInfo> _branches = widget.branches;
  final _name = TextEditingController();
  bool _busy = false;
  String? _error;
  /// The branch whose merge just conflicted, so the offer to resolve it names the one the user chose.
  String? _conflictedBranch;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  /// The status a write answered with, plus the branch list that write implies.
  ///
  /// A switch cannot change the list, so the list stands; a create adds exactly the branch git named, so it
  /// is added rather than re-read — one fewer call, and no window in which the new branch is missing from a
  /// list the user is looking at.
  void _apply(GitStatusInfo status, {required bool created}) {
    final branch = status.branch;
    final next = created && branch != null && !_branches.any((candidate) => candidate.name == branch)
        ? [
            for (final candidate in _branches) GitBranchInfo(name: candidate.name, current: false, upstream: candidate.upstream),
            GitBranchInfo(name: branch, current: true),
          ]
        : [
            for (final candidate in _branches)
              GitBranchInfo(name: candidate.name, current: candidate.name == branch, upstream: candidate.upstream),
          ];
    setState(() {
      _status = status;
      _branches = next;
    });
    widget.onChanged(status, next);
  }

  /// Merge a branch into the one the project is on, and say where it landed.
  Future<void> _merge(GitBranchInfo branch) async {
    // **"Which branch am I on" is answered once, by the status.** The branch list carries a `current` flag of
    // its own, and the two are readings of one fact: deciding the row's *look* from the status and this guard
    // from the flag is how a button ends up offered on the wrong row and doing nothing when pressed.
    if (branch.name == _status.branch || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await widget.client.call('coder.gitMerge', {
        'projectId': widget.project.id,
        'branch': branch.name,
      });
      final status = GitStatusInfo.fromJson(result);
      _apply(status, created: false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.l10n.gitMergeDone(branch.name, status.branch ?? _status.branch ?? ''))),
        );
      }
    } catch (error) {
      // **A conflicted merge is undone by the daemon before it answers**, so the sentence names the files and
      // the repository is exactly as it was — which is the promise this shows. The *key* is how the offer to
      // resolve it knows this is that refusal: reading the prose would be parsing a sentence a translator owns.
      final conflicted = parseDaemonMessage('$error').key == 'error.gitMergeConflict';
      if (mounted) {
        setState(() {
          _error = daemonErrorText(context.l10n, '$error');
          _conflictedBranch = conflicted ? branch.name : null;
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Merge again — this time keeping the conflict — and let an agent resolve it.
  Future<void> _resolve(String branch) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await widget.client.call('coder.gitMergeResolve', {
        'projectId': widget.project.id,
        'branch': branch,
      });
      final status = GitStatusInfo.fromJson(result);
      _apply(status, created: false);
      if (mounted) {
        final l10n = context.l10n;
        // **Two outcomes, and they are not the same event.** A merge git resolved by itself must not be
        // announced as an agent at work.
        final outcome = result['outcome']?.toString();
        final said = outcome == 'merged'
            ? l10n.gitMergeDone(branch, status.branch ?? _status.branch ?? '')
            : l10n.gitMergeResolving(result['task'] is Map ? (result['task'] as Map)['title']?.toString() ?? '' : '');
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(said)));
      }
    } catch (error) {
      if (mounted) setState(() => _error = daemonErrorText(context.l10n, '$error'));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Finish a resolved merge, or take one back — the two ends of the state the block above reports.
  Future<void> _settleMerge(String method, {required bool finish}) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await widget.client.call(method, {'projectId': widget.project.id});
      final status = GitStatusInfo.fromJson(result);
      _apply(status, created: false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(finish ? context.l10n.gitMergeRecorded : context.l10n.gitMergeAborted)),
        );
      }
    } catch (error) {
      if (mounted) setState(() => _error = daemonErrorText(context.l10n, '$error'));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Fetch and pull, which differ only in the call and in what they say afterwards.
  Future<void> _sync(String method, {required bool fetch}) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await widget.client.call(method, {'projectId': widget.project.id});
      final status = GitStatusInfo.fromJson(result);
      final summary = result['summary']?.toString() ?? '';
      _apply(status, created: false);
      if (mounted) {
        final l10n = context.l10n;
        // **An empty summary is git saying nothing changed** — a fact, and the wording for it is the phone's.
        final said = summary.isEmpty
            ? (fetch ? l10n.gitFetchNothing : l10n.gitPullNothing)
            : (fetch ? l10n.gitFetchDone(summary) : l10n.gitPullDone(summary));
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(said)));
      }
    } catch (error) {
      if (mounted) setState(() => _error = daemonErrorText(context.l10n, '$error'));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _switchTo(GitBranchInfo branch) async {
    if (branch.name == _status.branch || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await widget.client.call('coder.gitCheckout', {
        'projectId': widget.project.id,
        'branch': branch.name,
      });
      _apply(GitStatusInfo.fromJson(result), created: false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.l10n.gitBranchesSwitched(branch.name))),
        );
      }
    } catch (error) {
      if (mounted) {
        setState(() => _error = daemonErrorText(context.l10n, '$error'));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _create() async {
    final name = _name.text.trim();
    if (name.isEmpty || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await widget.client.call('coder.gitCreateBranch', {
        'projectId': widget.project.id,
        'name': name,
      });
      _apply(GitStatusInfo.fromJson(result), created: true);
      _name.clear();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.l10n.gitBranchesCreated(name))),
        );
      }
    } catch (error) {
      // The name stays in the field: the user has to edit it, and retyping it is the work a refusal is
      // supposed to save.
      if (mounted) {
        setState(() => _error = daemonErrorText(context.l10n, '$error'));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final colors = CoderTheme.of(context);
    final current = _status.branch;

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(CoderSpace.lg, CoderSpace.md2, CoderSpace.lg, CoderSpace.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l10n.gitBranchesTitle, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: CoderSpace.sm),
            if (_status.detached)
              // Not a branch with a strange name — a repository on a commit, said out loud.
              Text(l10n.gitBranchesDetached, style: TextStyle(color: colors.statusWarning, fontSize: 13)),
            // **A merge in progress is the state of the repository**, so it reads before the list of branches a
            // user could switch to — and it is where Finish and Abort live, because a merge without them is the
            // state this product refuses to leave behind.
            if (_status.merge != null) ...[
              const SizedBox(height: CoderSpace.sm),
              Container(
                padding: const EdgeInsets.all(CoderSpace.sm),
                decoration: BoxDecoration(
                  color: colors.surface2,
                  borderRadius: BorderRadius.circular(CoderRadius.sm),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      _status.merge!.branch == null
                          ? l10n.gitMergeStopped
                          : l10n.gitMergeStoppedFrom(_status.merge!.branch!),
                      style: TextStyle(color: colors.statusWarning, fontSize: 13),
                    ),
                    if (!_status.conflicted)
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(l10n.gitMergeResolved, style: TextStyle(color: colors.foregroundMuted, fontSize: 12)),
                      ),
                    Row(
                      children: [
                        // Off while files are still in conflict: the daemon would refuse, and the sentence above
                        // is what tells the user what has to happen first.
                        FilledButton(
                          onPressed: _busy || _status.conflicted
                              ? null
                              : () => unawaited(_settleMerge('coder.gitMergeContinue', finish: true)),
                          child: Text(l10n.gitMergeFinish),
                        ),
                        const SizedBox(width: CoderSpace.sm),
                        TextButton(
                          onPressed: _busy ? null : () => unawaited(_settleMerge('coder.gitMergeAbort', finish: false)),
                          child: Text(l10n.gitMergeAbort),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: CoderSpace.md),

            // **One row per branch, the current one marked and not pressable.** A `RadioListTile` would say
            // "pick one and confirm"; switching is the press, and the mark is a fact, not a selection.
            if (_branches.isEmpty)
              Text(l10n.gitBranchesEmpty, style: TextStyle(color: colors.foregroundMuted))
            else
              Flexible(
                child: ListView(
                  shrinkWrap: true,
                  children: [
                    for (final branch in _branches)
                      ListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        enabled: !_busy,
                        title: Text(branch.name),
                        subtitle: branch.upstream == null ? null : Text(branch.upstream!),
                        trailing: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (branch.name == current)
                              Icon(Icons.check, color: colors.statusSuccess)
                            else
                              // **Merge is offered on the branch you would merge *from***, and always into the
                              // one HEAD is on: that is git's own direction, and the workflow's last step.
                              IconButton(
                                tooltip: l10n.gitMergeInto(branch.name, current ?? ''),
                                icon: const Icon(Icons.merge_outlined),
                                onPressed: _busy ? null : () => unawaited(_merge(branch)),
                              ),
                          ],
                        ),
                        onTap: _busy || branch.name == current ? null : () => unawaited(_switchTo(branch)),
                      ),
                  ],
                ),
              ),

            const SizedBox(height: CoderSpace.sm),
            Row(
              children: [
                TextButton(
                  onPressed: _busy ? null : () => unawaited(_sync('coder.gitFetch', fetch: true)),
                  child: Text(l10n.gitFetchCta),
                ),
                TextButton(
                  onPressed: _busy ? null : () => unawaited(_sync('coder.gitPull', fetch: false)),
                  child: Text(l10n.gitPullCta),
                ),
              ],
            ),
            const SizedBox(height: CoderSpace.sm),
            TextField(
              controller: _name,
              enabled: !_busy,
              maxLines: 1,
              textInputAction: TextInputAction.done,
              // The button's enabled state is a function of this text, so the field has to rebuild the sheet
              // as it changes — otherwise the button stays disabled until something else happens to redraw.
              onChanged: (_) => setState(() {}),
              onSubmitted: (_) => _create(),
              decoration: InputDecoration(
                labelText: l10n.gitBranchesNew,
                hintText: l10n.gitBranchesName,
                border: const OutlineInputBorder(),
                isDense: true,
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: CoderSpace.sm),
              Text(_error!, style: TextStyle(color: colors.statusDanger, fontSize: 13)),
            ],
            // The refusal above names the files; this is the act that follows from it.
            if (_conflictedBranch != null) ...[
              const SizedBox(height: CoderSpace.sm),
              OutlinedButton.icon(
                onPressed: _busy ? null : () => unawaited(_resolve(_conflictedBranch!)),
                icon: const Icon(Icons.smart_toy_outlined, size: 18),
                label: Text(l10n.gitMergeResolve),
              ),
            ],
            const SizedBox(height: CoderSpace.md),
            FilledButton(
              onPressed: _busy || _name.text.trim().isEmpty ? null : _create,
              child: Text(l10n.gitBranchesCreate),
            ),
          ],
        ),
      ),
    );
  }
}
