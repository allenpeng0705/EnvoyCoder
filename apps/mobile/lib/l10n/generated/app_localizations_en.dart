// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appName => 'EnvoyDev';

  @override
  String get commonAdd => 'Add';

  @override
  String get commonCancel => 'Cancel';

  @override
  String get commonClear => 'Clear';

  @override
  String get commonConfirm => 'Confirm';

  @override
  String get commonContinue => 'Continue';

  @override
  String get commonNone => 'none';

  @override
  String get commonNotSet => 'Not set';

  @override
  String get commonOk => 'OK';

  @override
  String get commonRemove => 'Remove';

  @override
  String get commonRename => 'Rename';

  @override
  String get commonSave => 'Save';

  @override
  String get commonSaving => 'Saving…';

  @override
  String get connectionStateConnected => 'Connected';

  @override
  String get connectionStateConnecting => 'Connecting';

  @override
  String get connectionStateReconnecting =>
      'Reconnecting — your tasks are still running';

  @override
  String get connectionStateFailed => 'Unreachable';

  @override
  String get connectionStateIdle => 'Not connected yet';

  @override
  String get connectionsTitle => 'Connections';

  @override
  String connectionsCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count computers',
      one: '1 computer',
    );
    return '$_temp0';
  }

  @override
  String get connectionsAddHost => 'Add host';

  @override
  String get connectionsAddHostSubtitle => 'Scan a code, or enter an address';

  @override
  String get connectionsEmpty => 'No desktop paired yet.';

  @override
  String connectionsCurrent(String name) {
    return '$name · current';
  }

  @override
  String connectionsRowDetail(String endpoint, String state) {
    return '$endpoint · $state';
  }

  @override
  String connectionsRowDetailVia(String endpoint, String state, String route) {
    return '$endpoint · $state · via $route';
  }

  @override
  String get connectionsRenameTitle => 'Rename connection';

  @override
  String get connectionsRenameField => 'Connection name';

  @override
  String get connectionsRenameEmpty => 'Enter a name for this connection.';

  @override
  String connectionsForgetTitle(String name) {
    return 'Forget $name?';
  }

  @override
  String get connectionsForgetMessage =>
      'This phone will stop connecting to that computer and forget its pairing. Tasks already running there keep running.';

  @override
  String get connectionsForgetConfirm => 'Forget';

  @override
  String connectionsMenuAria(String name) {
    return 'More actions for $name';
  }

  @override
  String get connectionsMenuForget => 'Forget host';

  @override
  String get hostScanQr => 'Scan QR';

  @override
  String get hostScanQrSubtitle => 'Pair with the code on your computer';

  @override
  String get hostPasteLink => 'Paste link';

  @override
  String get hostPasteLinkSubtitle => 'Paste the pairing link from EnvoyDev';

  @override
  String get hostPasteLinkTitle => 'Paste pairing link';

  @override
  String get hostPasteLinkHint => 'envoy://pair?…';

  @override
  String get hostDirectTcp => 'Direct TCP';

  @override
  String get hostDirectTcpSubtitle => 'Host, port, and optional token';

  @override
  String get hostRemoteSsh => 'Remote SSH';

  @override
  String get hostRemoteSshSubtitle => 'Reach the daemon through an SSH hop';

  @override
  String get hostFieldHostPort => 'Host:port';

  @override
  String get hostFieldToken => 'Token (optional if already paired)';

  @override
  String get hostFieldTokenHelper =>
      'Kept only on this phone — never shown in the list.';

  @override
  String get hostFieldLabel => 'Label (optional)';

  @override
  String get hostFieldSshHost => 'SSH host';

  @override
  String get hostFieldUser => 'User';

  @override
  String get hostFieldSshPort => 'SSH port';

  @override
  String get hostFieldPassword => 'Password';

  @override
  String get hostFieldDaemon => 'Daemon on remote (host:port)';

  @override
  String get hostFieldDaemonHelper => 'Usually 127.0.0.1:4770 on that machine';

  @override
  String get hostFieldPairingToken => 'Pairing token (optional over SSH)';

  @override
  String get hostFieldPairingTokenHelper =>
      'The tunnel arrives as the machine itself, so it is trusted';

  @override
  String get hostRefusedTitle => 'That did not add a machine';

  @override
  String get hostScanTitle => 'Scan pairing code';

  @override
  String get hostScanHint => 'Point the camera at the QR on your computer.';

  @override
  String get hostNoHostsTitle => 'No desktop paired yet';

  @override
  String get hostNoHostsBody =>
      'On your computer, open EnvoyDev → Pair a phone, then scan the code. Your agents keep running whether or not the phone is connected.';

  @override
  String get errorPairingEmpty => 'That pairing code is empty.';

  @override
  String get errorPairingMalformed => 'That does not look like a pairing code.';

  @override
  String get errorPairingUnreadable =>
      'That pairing code could not be read. Ask the desktop to show it again.';

  @override
  String get errorPairingAddress =>
      'That pairing code has an address this app cannot read.';

  @override
  String get errorPairingOtherApp => 'That code is for another app';

  @override
  String get errorAddHostNotHostPort =>
      'That is not a host and port. Write it as “machine:4770” — the address and the port the daemon listens on.';

  @override
  String get errorAddHostNeedsToken =>
      'EnvoyDev refuses anyone who is not on the machine itself, so this route needs the token from a pairing link. Use Scan QR or Paste link, or paste the token here as well.';

  @override
  String get errorAddHostSshHost =>
      'Which machine should the tunnel go through? Enter its SSH host.';

  @override
  String get errorAddHostSshPort =>
      'The SSH port has to be a number between 1 and 65535. It is 22 by default.';

  @override
  String get errorAddHostDaemon =>
      'The daemon on that machine is named as “host:port”. Write it as “127.0.0.1:4770” — that is what it is for almost every machine, and it is the address as seen *from* the machine.';

  @override
  String get pairingNameTitle => 'Name this connection';

  @override
  String get pairingNameField => 'Connection name';

  @override
  String get pairingNameHelper =>
      'Shown in the Connections list — the address is kept as well.';

  @override
  String nameTooLong(int count) {
    return 'Keep it to $count characters or fewer.';
  }

  @override
  String get settingsTitle => 'Settings';

  @override
  String get settingsLoadFailed => 'Could not load settings.';

  @override
  String get settingsSaveFailed => 'Could not save settings.';

  @override
  String get settingsSaveNoModel =>
      'Settings saved. Enter a model to save LLM settings.';

  @override
  String get settingsSavedOnComputer => 'Settings saved on the computer.';

  @override
  String get settingsSavedLlmFailed =>
      'Settings saved, but the LLM settings were not.';

  @override
  String get settingsComputerHeading => 'On the computer';

  @override
  String get settingsComputerDetail =>
      'These settings live on the paired machine. The phone only changes them.';

  @override
  String get settingsApprovals => 'Ask before anything destructive';

  @override
  String get settingsTranscripts => 'Keep transcripts after a task ends';

  @override
  String get settingsLanguage => 'Language';

  @override
  String get settingsLanguageSystem => 'System';

  @override
  String get settingsDefaultAgent => 'Default coding agent';

  @override
  String get settingsLlmHeading => 'LLM';

  @override
  String get settingsLlmDetail =>
      'Base URL, model and API key for Envoy Harness. Other agents keep their own sign-in.';

  @override
  String get settingsBaseUrl => 'Base URL';

  @override
  String get settingsBaseUrlHint =>
      'Optional — leave empty for the provider default';

  @override
  String get settingsModel => 'Model';

  @override
  String get settingsModelHint => 'gpt-4o or anthropic/claude-sonnet-4-5';

  @override
  String get settingsApiKeySaved => 'API key saved on this computer.';

  @override
  String get settingsApiKey => 'API key';

  @override
  String get settingsApiKeyHint => 'Paste a new key to replace the saved one';

  @override
  String get settingsLanguageDaemonFailed =>
      'The phone is now in this language, but the computer could not be updated.';

  @override
  String get networkTitle => 'Network status';

  @override
  String get networkCheckAgain => 'Check again';

  @override
  String get networkCopyReport => 'Copy report';

  @override
  String get networkCopied =>
      'Network report copied — paste it into the bug report.';

  @override
  String get networkTokenNote =>
      'The pairing token is never shown here — it is a credential.';

  @override
  String get networkComputer => 'Computer';

  @override
  String get networkActiveRoute => 'Active route';

  @override
  String get networkApp => 'App';

  @override
  String get networkPairingHeading => 'What the pairing gave us';

  @override
  String get networkDesktopPeerId => 'Desktop peer id';

  @override
  String get networkDialablePeers => 'Dialable peer addresses';

  @override
  String get networkPairingMissing =>
      'Both are needed for the peer-to-peer route, so this host has none. A pairing made before the desktop carried these fields has neither — the phone is left with the direct address and the relay.';

  @override
  String get networkLadderHeading => 'How this computer was tried';

  @override
  String get networkLadderNoCandidatesYet =>
      'No candidates yet — nothing has been dialled for this computer.';

  @override
  String get networkLadderNoCandidates =>
      'This pass produced no candidates: the walk is held back under dial pressure, or the pairing names no address at all.';

  @override
  String networkLadderLimit(int limit, int waiting, int total) {
    return 'This pass dials at most $limit: $waiting of $total wait for the next pass.';
  }

  @override
  String get networkAttemptConnected => 'connected';

  @override
  String get networkAttemptFailed => 'failed';

  @override
  String get networkAttemptNoAnswer => 'no answer';

  @override
  String get networkAttemptDialling => 'dialling';

  @override
  String get networkAttemptNotTried => 'not tried';

  @override
  String get networkAttemptPlanned => 'planned';

  @override
  String get networkLastRequestHeading => 'Last request to the desktop';

  @override
  String get networkNothingAsked =>
      'Nothing has been asked yet since the app started.';

  @override
  String get networkMethod => 'Method';

  @override
  String get networkOutcome => 'Outcome';

  @override
  String get networkAnswered => 'answered';

  @override
  String get networkTook => 'Took';

  @override
  String get networkLastWalk => 'Last walk';

  @override
  String get networkPhoneNodeHeading => 'This phone\'s libp2p node';

  @override
  String get networkNodeNotStarted =>
      'Not started — no peer-to-peer route has been dialled in this launch. It starts on the first such dial, and looking at this screen does not start it.';

  @override
  String get networkPeerId => 'Peer id';

  @override
  String get networkStarting => 'starting';

  @override
  String get networkRelayDialling => 'Relay dialling';

  @override
  String get networkEnabled => 'enabled';

  @override
  String get networkDisabled => 'disabled';

  @override
  String get networkRelayReservation => 'Relay reservation';

  @override
  String get networkConnectedPeers => 'Connected peers';

  @override
  String get networkConnectedPeersUnavailable =>
      'unavailable — the shared node exposes no connection view';

  @override
  String get networkLanPeers => 'LAN peers seen';

  @override
  String get networkMdns => 'mDNS';

  @override
  String get networkActive => 'active';

  @override
  String get networkInactive => 'inactive';

  @override
  String get networkRegisteredProtocols => 'Registered protocols';

  @override
  String get networkHostGeneration => 'Host generation';

  @override
  String get networkDesktopMeshHeading => 'What the desktop says about itself';

  @override
  String get networkNotAsked =>
      'Not asked yet. “Check again” asks the desktop for its own mesh status — the difference between “this phone cannot reach it” and “it has nothing to reach”.';

  @override
  String networkNoUsableAnswer(String reason) {
    return 'No usable answer: $reason';
  }

  @override
  String get networkUnreadable => 'unreadable';

  @override
  String get networkState => 'State';

  @override
  String get networkItsPeerId => 'Its peer id';

  @override
  String get networkItsDialable => 'Its dialable addresses';

  @override
  String get networkItsRelayHints => 'Its relay hints';

  @override
  String get networkPeersConnected => 'Peers it is connected to';

  @override
  String get networkItsReason => 'Its reason';

  @override
  String get explorerTitle => 'Explorer';

  @override
  String get explorerFiles => 'Files';

  @override
  String get explorerChanges => 'Changes';

  @override
  String get explorerFolderEmpty => 'This folder is empty.';

  @override
  String get explorerCouldNotList => 'Could not list this folder.';

  @override
  String get explorerNotRepo => 'This folder is not a git repository.';

  @override
  String get explorerNoChanges => 'No changes in this folder.';

  @override
  String get explorerCommitMessage => 'Commit message';

  @override
  String get explorerCommitCta => 'Commit';

  @override
  String get explorerCommitStageAll => 'Stage all';

  @override
  String explorerCommitDone(String sha) {
    return 'Committed $sha.';
  }

  @override
  String explorerStage(String path) {
    return 'Stage $path';
  }

  @override
  String explorerUnstage(String path) {
    return 'Unstage $path';
  }

  @override
  String get explorerCouldNotRead => 'Could not read the changes.';

  @override
  String get explorerKindAdded => 'Added';

  @override
  String get explorerKindModified => 'Modified';

  @override
  String get explorerKindDeleted => 'Deleted';

  @override
  String get explorerKindRenamed => 'Renamed';

  @override
  String get explorerKindNew => 'New';

  @override
  String get explorerKindConflict => 'Conflict';

  @override
  String get folderTitle => 'Choose project folder';

  @override
  String get folderUseThisFolder => 'Use this folder';

  @override
  String get folderComputer => 'Computer';

  @override
  String get folderDrives => 'Drives';

  @override
  String get folderHome => 'Home';

  @override
  String get folderParent => 'Parent folder';

  @override
  String get folderEmpty => 'No subfolders here';

  @override
  String get runStop => 'Stop';

  @override
  String get runStopping => 'Stopping…';

  @override
  String get runLive => 'Live';

  @override
  String get runToggleExplorer => 'Toggle Explorer sidebar';

  @override
  String get runCouldNotAnswer => 'Could not send that answer. Try again.';

  @override
  String get runCouldNotUpdateTask =>
      'Could not update the task on the computer.';

  @override
  String get runCouldNotSend => 'Could not send. Try again.';

  @override
  String get runCouldNotStop => 'Could not stop the run. Try again.';

  @override
  String get runNoFolder => 'This task has no folder yet.';

  @override
  String get runCouldNotOpen => 'Could not open this run.';

  @override
  String get runEarlierNotHere =>
      'The earlier conversation is not on this computer. A new message still starts here.';

  @override
  String get runHistoryGap =>
      'Some of this task\'s history did not arrive. What is here is in order.';

  @override
  String get runQueue => 'Queue';

  @override
  String get runSteer => 'Steer';

  @override
  String get runJoinsTurn => 'Joins the turn now';

  @override
  String get runWaitsTurn => 'Waits for this turn to finish';

  @override
  String get runPlaceholderAnswer => 'Answer the request above first';

  @override
  String get runPlaceholderFollowUp => 'Send a follow-up…';

  @override
  String get runPlaceholderContinue => 'Send a message to continue';

  @override
  String get runYou => 'You';

  @override
  String get runYouSteered => 'You · joined the turn';

  @override
  String get runYouQueued => 'You · waited for the turn';

  @override
  String get runThoughtTitle => 'How it thought about this';

  @override
  String get runAnswered => 'Answered';

  @override
  String runAnsweredWith(String option) {
    return 'Answered: $option';
  }

  @override
  String get runNeedsAnswer => 'The agent needs your answer';

  @override
  String approvalQuestionTool(String tool) {
    return 'Allow the agent to run “$tool”?';
  }

  @override
  String get approvalQuestionGeneric => 'Allow the agent to continue?';

  @override
  String get approvalQuestionAsk => 'The agent asked a question.';

  @override
  String get approvalDetail =>
      'It has stopped before this step and will not continue until you answer. Allowing it lets this same step run again in this project without asking.';

  @override
  String get approvalDetailPick =>
      'Pick one. This answer is only for this question.';

  @override
  String get approvalDetailMultiple =>
      'Tick every option that applies, then confirm. This answer is only for this question.';

  @override
  String get approvalDetailText =>
      'Type your answer. The agent will not continue until you send it.';

  @override
  String get approvalAllow => 'Allow';

  @override
  String get approvalDeny => 'Don\'t allow';

  @override
  String get runApprovalNeedsDecision => 'The agent needs a decision.';

  @override
  String get runNoLongerWaiting => 'No longer waiting.';

  @override
  String get runYourAnswer => 'Your answer';

  @override
  String get runToolFallback => 'tool';

  @override
  String runNoteDiff(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count files changed.',
      one: '1 file changed.',
    );
    return '$_temp0';
  }

  @override
  String runNoteContext(int percent) {
    return 'Context $percent% full.';
  }

  @override
  String get runNoteFinished => 'Finished.';

  @override
  String get runNoteStopped => 'Stopped.';

  @override
  String get runNoteStoppedBefore => 'Stopped before it finished.';

  @override
  String get runNoteEnded => 'Ended.';

  @override
  String get attachAdd => 'Add image';

  @override
  String get attachTooltip => 'Attach';

  @override
  String get attachPaste => 'Paste image';

  @override
  String get attachFile => 'Add file';

  @override
  String attachRemove(String name) {
    return 'Remove $name';
  }

  @override
  String get attachTooBig => 'That file is too large to attach.';

  @override
  String get attachBinary => 'Only images and text files can be attached.';

  @override
  String get attachUnreadable => 'That file could not be read.';

  @override
  String get attachEmpty => 'That file is empty.';

  @override
  String attachLimit(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'You can attach up to $count files.',
      one: 'You can attach 1 file.',
    );
    return '$_temp0';
  }

  @override
  String get attachClipboardMissing => 'No image was on the clipboard.';

  @override
  String get attachFailed => 'Could not attach that file.';

  @override
  String get attachImagesOnly => 'Look at the attached image.';

  @override
  String get attachImagesOnlyMany => 'Look at the attached images.';

  @override
  String attachNamed(String names) {
    return 'Attached: $names';
  }

  @override
  String get addProjectTitle => 'Add project';

  @override
  String get addProjectDetail =>
      'Pick a folder on this computer. Agents will run inside it.';

  @override
  String get addProjectFolder => 'Folder';

  @override
  String get addProjectFolderHint => '/Users/you/work/repo';

  @override
  String get addProjectBrowse => 'Browse';

  @override
  String get addProjectDefaultAgent => 'Default agent';

  @override
  String get addProjectChooseFolder => 'Choose a folder on this computer.';

  @override
  String get addProjectSubmit => 'Add project';

  @override
  String get markdownMermaid =>
      'Mermaid diagram — source shown here; the computer renders the chart in the desktop app.';

  @override
  String get markdownCopy => 'Copy';

  @override
  String get markdownCopied => 'Copied';

  @override
  String projectListAttention(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count need you',
      one: '1 needs you',
    );
    return '$_temp0';
  }

  @override
  String get projectListNoProjects =>
      'No projects yet — add a folder on this computer.';

  @override
  String get projectListNoMatch => 'Nothing matches that search.';

  @override
  String projectListCouldNotLoad(String detail) {
    return 'Could not load work from this computer. $detail';
  }

  @override
  String get commonConnectionFailed => 'The connection failed.';

  @override
  String get projectListCouldNotChangeAgent =>
      'Could not change the project agent.';

  @override
  String projectListRemoveTitle(String project) {
    return 'Remove $project?';
  }

  @override
  String get projectListRemoveMessage =>
      'The project leaves EnvoyDev and its tasks leave the list — they are archived, not deleted, and nothing in that folder is touched. Removing the project cannot be undone.';

  @override
  String projectListRemoveFailed(String project) {
    return 'Could not remove $project. It is still in the list.';
  }

  @override
  String projectListRemoved(String project) {
    return 'Removed $project.';
  }

  @override
  String projectListRemovedArchived(String project, int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count tasks were archived.',
      one: '1 task was archived.',
    );
    return 'Removed $project. $_temp0';
  }

  @override
  String taskRemoveTitle(String title) {
    return 'Remove $title?';
  }

  @override
  String get taskRemoveMessage =>
      'It leaves the task list. The folder, its files and the transcript stay on this computer — archiving is not deletion.';

  @override
  String projectListRemoveTaskFailed(String title) {
    return 'Could not remove $title. It is still in the list.';
  }

  @override
  String get runCouldNotRemove =>
      'Could not remove this task. It is still here.';

  @override
  String get projectListRenameTaskTitle => 'Rename task';

  @override
  String get projectListRenameTaskField => 'Task name';

  @override
  String get projectListRenameTaskEmpty => 'Enter a name for this task.';

  @override
  String projectListRenameTaskFailed(String title) {
    return 'Could not rename $title. The name is unchanged.';
  }

  @override
  String projectListNetworkStatusFor(String host, String state) {
    return 'Network status for $host — $state';
  }

  @override
  String projectListSwitchConnection(String host) {
    return 'Switch connection — current: $host';
  }

  @override
  String get projectListNoTasks => 'No tasks in this project yet';

  @override
  String projectListAgentFor(String project) {
    return 'Agent for $project';
  }

  @override
  String get projectListChangeAgent => 'Change agent';

  @override
  String gitBranchesAria(String project) {
    return 'Branches for $project';
  }

  @override
  String get gitBranchesTitle => 'Branches';

  @override
  String gitBranchesChip(String branch) {
    return 'Branch: $branch';
  }

  @override
  String get gitBranchesDetachedChip => 'No branch';

  @override
  String get gitBranchesDetached =>
      'This repository is on a detached HEAD, so no branch is current.';

  @override
  String get gitBranchesEmpty => 'This repository has no branches yet.';

  @override
  String get gitBranchesNew => 'New branch';

  @override
  String get gitBranchesName => 'Branch name';

  @override
  String get gitBranchesCreate => 'Create and switch';

  @override
  String gitBranchesSwitched(String branch) {
    return 'Switched to $branch.';
  }

  @override
  String gitBranchesCreated(String branch) {
    return 'Created $branch and switched to it.';
  }

  @override
  String gitMergeInto(String branch, String current) {
    return 'Merge $branch into $current';
  }

  @override
  String get gitMergeCta => 'Merge';

  @override
  String gitMergeDone(String branch, String into) {
    return 'Merged $branch into $into.';
  }

  @override
  String get gitFetchCta => 'Fetch';

  @override
  String gitFetchDone(String summary) {
    return 'Fetched. $summary';
  }

  @override
  String get gitFetchNothing => 'Fetched. Nothing new.';

  @override
  String get gitPullCta => 'Pull';

  @override
  String gitPullDone(String summary) {
    return 'Pulled. $summary';
  }

  @override
  String get gitPullNothing => 'Pulled. Already up to date.';

  @override
  String errorGitMergeConflict(String branch, String files) {
    return '$branch cannot be merged automatically. These files conflict: $files. Nothing was changed — your branch and your working tree are exactly as they were.';
  }

  @override
  String get errorGitPullDiverged =>
      'The branch on the computer and the one on the remote have both changed, so a pull cannot bring them together. Merge them, or push your branch.';

  @override
  String get gitStashTitle => 'Stashes';

  @override
  String get gitStashCta => 'Stash';

  @override
  String get gitStashDone => 'Stashed.';

  @override
  String get gitStashPop => 'Put back';

  @override
  String get gitStashDrop => 'Discard';

  @override
  String get gitStashConfirm => 'Discard this stash?';

  @override
  String get errorGitNothingToStash =>
      'There is nothing to stash — no file in this folder has uncommitted changes.';

  @override
  String get errorGitStashDirty =>
      'Putting a stash back needs a clean working tree. Commit or stash the changes in this folder first.';

  @override
  String errorGitStashConflict(String files) {
    return 'This stash cannot be put back cleanly. These files conflict: $files. Nothing was changed, and the stash is still there.';
  }

  @override
  String errorGitMergeUnresolved(String files) {
    return 'A merge is not finished: $files still has conflicts. Resolve them and finish the merge, or abort it.';
  }

  @override
  String get errorGitMergeNone =>
      'No merge is in progress, so there is nothing to finish or abort.';

  @override
  String errorGitConflicted(String files) {
    return 'This repository has unresolved conflicts in $files, from an operation EnvoyDev did not start. Finish or undo it there before doing anything else here.';
  }

  @override
  String errorGitMergeResolveFailed(String detail) {
    return 'The agent could not be started, so the merge was taken back and nothing changed: $detail';
  }

  @override
  String get gitMergeStopped => 'A merge stopped with conflicts.';

  @override
  String gitMergeStoppedFrom(String branch) {
    return 'The merge of $branch stopped with conflicts.';
  }

  @override
  String get gitMergeResolved =>
      'All conflicts are resolved. Finish the merge to record it.';

  @override
  String get gitMergeResolve => 'Resolve with an agent';

  @override
  String get gitMergeFinish => 'Finish the merge';

  @override
  String get gitMergeAbort => 'Abort the merge';

  @override
  String gitMergeResolving(String task) {
    return 'An agent is resolving this merge: $task.';
  }

  @override
  String get gitMergeAborted =>
      'The merge was aborted, and nothing was merged.';

  @override
  String get gitMergeRecorded => 'The merge was recorded.';

  @override
  String get gitBranchesConflictsChip => 'Conflicts';

  @override
  String get newTaskNoProjects =>
      'Add a project on the computer first, then try again.';

  @override
  String get newTaskProjectLabel => 'Project';

  @override
  String get newTaskPromptHint => 'Describe the task';

  @override
  String newTaskCouldNotStart(String detail) {
    return 'Could not start that task. $detail';
  }

  @override
  String get composerAgentDefault => 'Agent default';

  @override
  String get composerUse => 'Use';

  @override
  String get composerAgentBare => 'Agent';

  @override
  String composerModelValue(String value) {
    return 'Model: $value';
  }

  @override
  String composerModeValue(String value) {
    return 'Mode: $value';
  }

  @override
  String composerThinkingValue(String value) {
    return 'Thinking: $value';
  }

  @override
  String get projectListSearchHint => 'Search tasks, repos, paths';

  @override
  String get projectListRemoveConfirm => 'Remove project';

  @override
  String projectListNewTaskIn(Object project) {
    return 'New task in $project';
  }

  @override
  String get newTaskTitle => 'New task';

  @override
  String get newTaskSubmitting => 'Adding…';

  @override
  String get runRemoveTask => 'Remove task';

  @override
  String get composerDefault => 'Default';

  @override
  String get composerModeSheet => 'Mode';

  @override
  String get composerModeTooltip =>
      'What the agent is allowed to do in this task';

  @override
  String get composerModelSheet => 'Model';

  @override
  String get composerModelTooltip => 'Which model the agent uses for this task';

  @override
  String get composerModelHint => 'provider/model';

  @override
  String get composerThinkingSheet => 'Thinking';

  @override
  String get composerThinkingTooltip =>
      'How much the agent thinks before it answers';

  @override
  String get taskUntitled => 'Untitled task';

  @override
  String get projectUnknown => 'Unknown project';

  @override
  String get statusQueued => 'Queued';

  @override
  String get statusDone => 'Done';

  @override
  String get statusFailed => 'Failed';

  @override
  String get statusUnknown => 'Unknown';

  @override
  String get statusNeedsAnswer => 'Needs your answer';

  @override
  String get statusWorking => 'Working';

  @override
  String get statusIdle => 'Idle';

  @override
  String get statusStopped => 'Stopped';
}
