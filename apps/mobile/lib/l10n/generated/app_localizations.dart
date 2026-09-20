import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_de.dart';
import 'app_localizations_en.dart';
import 'app_localizations_fr.dart';
import 'app_localizations_it.dart';
import 'app_localizations_ja.dart';
import 'app_localizations_ko.dart';
import 'app_localizations_zh.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'generated/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
      : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
    delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
  ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('de'),
    Locale('fr'),
    Locale('it'),
    Locale('ja'),
    Locale('ko'),
    Locale('zh')
  ];

  /// appName — The product name. A brand, never translated.
  ///
  /// In en, this message translates to:
  /// **'EnvoyDev'**
  String get appName;

  /// common.add — Generic add button.
  ///
  /// In en, this message translates to:
  /// **'Add'**
  String get commonAdd;

  /// common.cancel — Dismisses a dialog without acting.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get commonCancel;

  /// common.clear — Forgets a stored secret.
  ///
  /// In en, this message translates to:
  /// **'Clear'**
  String get commonClear;

  /// common.confirm — Confirms an approval answer.
  ///
  /// In en, this message translates to:
  /// **'Confirm'**
  String get commonConfirm;

  /// common.continue — Accepts a typed value and closes the dialog.
  ///
  /// In en, this message translates to:
  /// **'Continue'**
  String get commonContinue;

  /// common.none — Stands in for a value that is absent, not zero.
  ///
  /// In en, this message translates to:
  /// **'none'**
  String get commonNone;

  /// common.notSet — A preference with no value chosen.
  ///
  /// In en, this message translates to:
  /// **'Not set'**
  String get commonNotSet;

  /// common.ok — Acknowledges a refusal.
  ///
  /// In en, this message translates to:
  /// **'OK'**
  String get commonOk;

  /// common.remove — Takes something out of a list without deleting it on disk.
  ///
  /// In en, this message translates to:
  /// **'Remove'**
  String get commonRemove;

  /// common.rename — Gives something a new name.
  ///
  /// In en, this message translates to:
  /// **'Rename'**
  String get commonRename;

  /// common.save — Writes the settings.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get commonSave;

  /// common.saving — In-flight state of Save.
  ///
  /// In en, this message translates to:
  /// **'Saving…'**
  String get commonSaving;

  /// connectionState.connected — The daemon is reachable now.
  ///
  /// In en, this message translates to:
  /// **'Connected'**
  String get connectionStateConnected;

  /// connectionState.connecting — A dial is in flight.
  ///
  /// In en, this message translates to:
  /// **'Connecting'**
  String get connectionStateConnecting;

  /// connectionState.reconnecting — The link dropped; the consequence matters more than the state.
  ///
  /// In en, this message translates to:
  /// **'Reconnecting — your tasks are still running'**
  String get connectionStateReconnecting;

  /// connectionState.failed — The dial failed.
  ///
  /// In en, this message translates to:
  /// **'Unreachable'**
  String get connectionStateFailed;

  /// connectionState.idle — Nothing has been tried.
  ///
  /// In en, this message translates to:
  /// **'Not connected yet'**
  String get connectionStateIdle;

  /// connections.title — Sheet title: the machines this phone can reach.
  ///
  /// In en, this message translates to:
  /// **'Connections'**
  String get connectionsTitle;

  /// connections.count — How many machines are paired.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 computer} other{{count} computers}}'**
  String connectionsCount(int count);

  /// connections.addHost — The sheet's one action.
  ///
  /// In en, this message translates to:
  /// **'Add host'**
  String get connectionsAddHost;

  /// connections.addHost.subtitle — What Add host leads to.
  ///
  /// In en, this message translates to:
  /// **'Scan a code, or enter an address'**
  String get connectionsAddHostSubtitle;

  /// connections.empty — Empty connections list.
  ///
  /// In en, this message translates to:
  /// **'No desktop paired yet.'**
  String get connectionsEmpty;

  /// connections.pairingRefused* — The pairing step offered where the refusal is read.
  ///
  /// In en, this message translates to:
  /// **'This computer refused this phone\'s pairing'**
  String get connectionsPairingRefused;

  /// connections.pairingRefused* — The pairing step offered where the refusal is read.
  ///
  /// In en, this message translates to:
  /// **'Pair again with {name}. This computer no longer accepts the pairing this phone holds.'**
  String connectionsPairingRefusedDetail(Object name);

  /// connections.pairingRefused* — The pairing step offered where the refusal is read.
  ///
  /// In en, this message translates to:
  /// **'Pair again'**
  String get connectionsPairingRePair;

  /// connections.current — Marks the active machine in the list.
  ///
  /// In en, this message translates to:
  /// **'{name} · current'**
  String connectionsCurrent(String name);

  /// connections.rowDetail — A row's second line: address and health.
  ///
  /// In en, this message translates to:
  /// **'{endpoint} · {state}'**
  String connectionsRowDetail(String endpoint, String state);

  /// connections.rowDetailVia — A row's second line when a route is in use.
  ///
  /// In en, this message translates to:
  /// **'{endpoint} · {state} · via {route}'**
  String connectionsRowDetailVia(String endpoint, String state, String route);

  /// connections.renameTitle — Dialog title for renaming a machine.
  ///
  /// In en, this message translates to:
  /// **'Rename connection'**
  String get connectionsRenameTitle;

  /// connections.renameField — Field label for the machine's name.
  ///
  /// In en, this message translates to:
  /// **'Connection name'**
  String get connectionsRenameField;

  /// connections.renameEmpty — Refusal when the name field is blank.
  ///
  /// In en, this message translates to:
  /// **'Enter a name for this connection.'**
  String get connectionsRenameEmpty;

  /// connections.forgetTitle — Confirmation title for forgetting a machine.
  ///
  /// In en, this message translates to:
  /// **'Forget {name}?'**
  String connectionsForgetTitle(String name);

  /// connections.forgetMessage — What forgetting costs and what it does not.
  ///
  /// In en, this message translates to:
  /// **'This phone will stop connecting to that computer and forget its pairing. Tasks already running there keep running.'**
  String get connectionsForgetMessage;

  /// connections.forget.confirm — The confirm button that forgets a machine.
  ///
  /// In en, this message translates to:
  /// **'Forget'**
  String get connectionsForgetConfirm;

  /// connections.menuAria — Accessible name of a row's overflow menu.
  ///
  /// In en, this message translates to:
  /// **'More actions for {name}'**
  String connectionsMenuAria(String name);

  /// connections.menuForget — Menu item that forgets a machine.
  ///
  /// In en, this message translates to:
  /// **'Forget host'**
  String get connectionsMenuForget;

  /// host.scanQr — Add-host row: scan the pairing code.
  ///
  /// In en, this message translates to:
  /// **'Scan QR'**
  String get hostScanQr;

  /// host.scanQrSubtitle — What Scan QR does.
  ///
  /// In en, this message translates to:
  /// **'Pair with the code on your computer'**
  String get hostScanQrSubtitle;

  /// host.pasteLink — Add-host row: paste a pairing link.
  ///
  /// In en, this message translates to:
  /// **'Paste link'**
  String get hostPasteLink;

  /// host.pasteLinkSubtitle — What Paste link does.
  ///
  /// In en, this message translates to:
  /// **'Paste the pairing link from EnvoyDev'**
  String get hostPasteLinkSubtitle;

  /// host.pasteLinkTitle — Dialog title for pasting a link.
  ///
  /// In en, this message translates to:
  /// **'Paste pairing link'**
  String get hostPasteLinkTitle;

  /// host.pasteLinkHint — Example of the link shape. Not translated.
  ///
  /// In en, this message translates to:
  /// **'envoy://pair?…'**
  String get hostPasteLinkHint;

  /// host.directTcp — Add-host row: dial an address directly.
  ///
  /// In en, this message translates to:
  /// **'Direct TCP'**
  String get hostDirectTcp;

  /// host.directTcpSubtitle — What Direct TCP needs.
  ///
  /// In en, this message translates to:
  /// **'Host, port, and optional token'**
  String get hostDirectTcpSubtitle;

  /// host.remoteSsh — Add-host row: reach the daemon through SSH.
  ///
  /// In en, this message translates to:
  /// **'Remote SSH'**
  String get hostRemoteSsh;

  /// host.remoteSshSubtitle — What Remote SSH does.
  ///
  /// In en, this message translates to:
  /// **'Reach the daemon through an SSH hop'**
  String get hostRemoteSshSubtitle;

  /// host.fieldHostPort — Address field label.
  ///
  /// In en, this message translates to:
  /// **'Host:port'**
  String get hostFieldHostPort;

  /// host.fieldToken — Optional credential field label.
  ///
  /// In en, this message translates to:
  /// **'Token (optional if already paired)'**
  String get hostFieldToken;

  /// host.fieldTokenHelper — Where the token lives.
  ///
  /// In en, this message translates to:
  /// **'Kept only on this phone — never shown in the list.'**
  String get hostFieldTokenHelper;

  /// host.fieldLabel — Optional name field label.
  ///
  /// In en, this message translates to:
  /// **'Label (optional)'**
  String get hostFieldLabel;

  /// host.fieldSshHost — SSH host field label.
  ///
  /// In en, this message translates to:
  /// **'SSH host'**
  String get hostFieldSshHost;

  /// host.fieldUser — SSH user field label.
  ///
  /// In en, this message translates to:
  /// **'User'**
  String get hostFieldUser;

  /// host.fieldSshPort — SSH port field label.
  ///
  /// In en, this message translates to:
  /// **'SSH port'**
  String get hostFieldSshPort;

  /// host.fieldPassword — SSH password field label.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get hostFieldPassword;

  /// host.fieldDaemon — Remote daemon address field label.
  ///
  /// In en, this message translates to:
  /// **'Daemon on remote (host:port)'**
  String get hostFieldDaemon;

  /// host.fieldDaemonHelper — Typical remote daemon address.
  ///
  /// In en, this message translates to:
  /// **'Usually 127.0.0.1:4770 on that machine'**
  String get hostFieldDaemonHelper;

  /// host.fieldPairingToken — Optional pairing token over SSH.
  ///
  /// In en, this message translates to:
  /// **'Pairing token (optional over SSH)'**
  String get hostFieldPairingToken;

  /// host.fieldPairingTokenHelper — Why the token is optional here.
  ///
  /// In en, this message translates to:
  /// **'The tunnel arrives as the machine itself, so it is trusted'**
  String get hostFieldPairingTokenHelper;

  /// host.refusedTitle — Title of a refusal dialog.
  ///
  /// In en, this message translates to:
  /// **'That did not add a machine'**
  String get hostRefusedTitle;

  /// host.scanTitle — App bar of the camera screen.
  ///
  /// In en, this message translates to:
  /// **'Scan pairing code'**
  String get hostScanTitle;

  /// host.scanHint — Camera instruction.
  ///
  /// In en, this message translates to:
  /// **'Point the camera at the QR on your computer.'**
  String get hostScanHint;

  /// host.noHostsTitle — The zero-host screen's headline.
  ///
  /// In en, this message translates to:
  /// **'No desktop paired yet'**
  String get hostNoHostsTitle;

  /// host.noHostsBody — The zero-host screen's explanation.
  ///
  /// In en, this message translates to:
  /// **'On your computer, open EnvoyDev → Pair a phone, then scan the code. Your agents keep running whether or not the phone is connected.'**
  String get hostNoHostsBody;

  /// error.pairingEmpty — A blank code was pasted.
  ///
  /// In en, this message translates to:
  /// **'That pairing code is empty.'**
  String get errorPairingEmpty;

  /// error.pairingMalformed — The code does not parse.
  ///
  /// In en, this message translates to:
  /// **'That does not look like a pairing code.'**
  String get errorPairingMalformed;

  /// error.pairingUnreadable — The code is the right shape but unreadable.
  ///
  /// In en, this message translates to:
  /// **'That pairing code could not be read. Ask the desktop to show it again.'**
  String get errorPairingUnreadable;

  /// error.pairingAddress — The address inside the code is unusable.
  ///
  /// In en, this message translates to:
  /// **'That pairing code has an address this app cannot read.'**
  String get errorPairingAddress;

  /// error.pairingOtherApp — The code's app claim names another product.
  ///
  /// In en, this message translates to:
  /// **'That code is for another app'**
  String get errorPairingOtherApp;

  /// error.addHostNotHostPort — Direct TCP: the endpoint is malformed.
  ///
  /// In en, this message translates to:
  /// **'That is not a host and port. Write it as “machine:4770” — the address and the port the daemon listens on.'**
  String get errorAddHostNotHostPort;

  /// error.addHostNeedsToken — Direct TCP without a token.
  ///
  /// In en, this message translates to:
  /// **'EnvoyDev refuses anyone who is not on the machine itself, so this route needs the token from a pairing link. Use Scan QR or Paste link, or paste the token here as well.'**
  String get errorAddHostNeedsToken;

  /// error.addHostSshHost — SSH: no host given.
  ///
  /// In en, this message translates to:
  /// **'Which machine should the tunnel go through? Enter its SSH host.'**
  String get errorAddHostSshHost;

  /// error.addHostSshPort — SSH: the port is not a port.
  ///
  /// In en, this message translates to:
  /// **'The SSH port has to be a number between 1 and 65535. It is 22 by default.'**
  String get errorAddHostSshPort;

  /// error.addHostDaemon — SSH: the remote daemon address is malformed.
  ///
  /// In en, this message translates to:
  /// **'The daemon on that machine is named as “host:port”. Write it as “127.0.0.1:4770” — that is what it is for almost every machine, and it is the address as seen *from* the machine.'**
  String get errorAddHostDaemon;

  /// pairing.nameTitle — Dialog title while pairing.
  ///
  /// In en, this message translates to:
  /// **'Name this connection'**
  String get pairingNameTitle;

  /// pairing.nameField — Field label while pairing.
  ///
  /// In en, this message translates to:
  /// **'Connection name'**
  String get pairingNameField;

  /// pairing.nameHelper — What the name is for.
  ///
  /// In en, this message translates to:
  /// **'Shown in the Connections list — the address is kept as well.'**
  String get pairingNameHelper;

  /// name.tooLong — The name field's validator refusal.
  ///
  /// In en, this message translates to:
  /// **'Keep it to {count} characters or fewer.'**
  String nameTooLong(int count);

  /// settings.title — Screen title.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get settingsTitle;

  /// settings.loadFailed — The daemon refused coder.getSettings.
  ///
  /// In en, this message translates to:
  /// **'Could not load settings.'**
  String get settingsLoadFailed;

  /// settings.saveFailed — The daemon refused coder.updateSettings.
  ///
  /// In en, this message translates to:
  /// **'Could not save settings.'**
  String get settingsSaveFailed;

  /// settings.saveNoModel — Settings landed but the LLM half had no model.
  ///
  /// In en, this message translates to:
  /// **'Settings saved. Enter a model to save LLM settings.'**
  String get settingsSaveNoModel;

  /// settings.savedOnComputer — Both halves landed.
  ///
  /// In en, this message translates to:
  /// **'Settings saved on the computer.'**
  String get settingsSavedOnComputer;

  /// settings.savedLlmFailed — Settings landed, the LLM call failed.
  ///
  /// In en, this message translates to:
  /// **'Settings saved, but the LLM settings were not.'**
  String get settingsSavedLlmFailed;

  /// settings.computerHeading — Section heading: these settings live on the paired daemon.
  ///
  /// In en, this message translates to:
  /// **'On the computer'**
  String get settingsComputerHeading;

  /// settings.computerDetail — What the section means.
  ///
  /// In en, this message translates to:
  /// **'These settings live on the paired machine. The phone only changes them.'**
  String get settingsComputerDetail;

  /// settings.pairing.heading — Pairing
  ///
  /// In en, this message translates to:
  /// **'Pairing'**
  String get settingsPairingHeading;

  /// settings.pairing.pairedWith — This phone is paired with {name}.
  ///
  /// In en, this message translates to:
  /// **'This phone is paired with {name}.'**
  String settingsPairingPairedWith(Object name);

  /// settings.pairing.notPaired — This phone holds no pairing for that computer. Scan the code on the computer to pair again.
  ///
  /// In en, this message translates to:
  /// **'This phone holds no pairing for that computer. Scan the code on the computer to pair again.'**
  String get settingsPairingNotPaired;

  /// settings.pairing.unavailable — This phone could not read its stored pairing.
  ///
  /// In en, this message translates to:
  /// **'This phone could not read its stored pairing.'**
  String get settingsPairingUnavailable;

  /// settings.pairing.notReached — Not connected on this phone yet.
  ///
  /// In en, this message translates to:
  /// **'Not connected on this phone yet.'**
  String get settingsPairingNotReached;

  /// settings.pairing.justNow — Last connected just now
  ///
  /// In en, this message translates to:
  /// **'Last connected just now'**
  String get settingsPairingJustNow;

  /// settings.pairing.phoneClock — Recorded on this phone, from this phone's clock.
  ///
  /// In en, this message translates to:
  /// **'Recorded on this phone, from this phone\'s clock.'**
  String get settingsPairingPhoneClock;

  /// settings.pairing.LastSeenRecent — Last connected just now. Recorded on this phone, from this phone's clock.
  ///
  /// In en, this message translates to:
  /// **'Last connected just now. Recorded on this phone, from this phone\'s clock.'**
  String get settingsPairingLastSeenRecent;

  /// settings.pairing.LastSeenOn — Last connected {date}. Recorded on this phone, from this phone's clock.
  ///
  /// In en, this message translates to:
  /// **'Last connected {date}. Recorded on this phone, from this phone\'s clock.'**
  String settingsPairingLastSeenOn(Object date);

  /// settings.approvals — The approval switch.
  ///
  /// In en, this message translates to:
  /// **'Ask before anything destructive'**
  String get settingsApprovals;

  /// settings.transcripts — The transcript switch.
  ///
  /// In en, this message translates to:
  /// **'Keep transcripts after a task ends'**
  String get settingsTranscripts;

  /// settings.language — The language picker's label.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get settingsLanguage;

  /// settings.languageSystem — Language preference that follows the phone.
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get settingsLanguageSystem;

  /// settings.defaultAgent — The default-agent picker's label.
  ///
  /// In en, this message translates to:
  /// **'Default coding agent'**
  String get settingsDefaultAgent;

  /// settings.llmHeading — Section heading.
  ///
  /// In en, this message translates to:
  /// **'LLM'**
  String get settingsLlmHeading;

  /// settings.llmDetail — What this section configures.
  ///
  /// In en, this message translates to:
  /// **'Base URL, model and API key for Envoy Harness. Other agents keep their own sign-in.'**
  String get settingsLlmDetail;

  /// settings.baseUrl — Field label.
  ///
  /// In en, this message translates to:
  /// **'Base URL'**
  String get settingsBaseUrl;

  /// settings.baseUrlHint — Empty base URL means the provider's own address.
  ///
  /// In en, this message translates to:
  /// **'Optional — leave empty for the provider default'**
  String get settingsBaseUrlHint;

  /// settings.model — Field label.
  ///
  /// In en, this message translates to:
  /// **'Model'**
  String get settingsModel;

  /// settings.modelHint — Example model ids. Not translated.
  ///
  /// In en, this message translates to:
  /// **'gpt-4o or anthropic/claude-sonnet-4-5'**
  String get settingsModelHint;

  /// settings.apiKeySaved — A key exists on the daemon.
  ///
  /// In en, this message translates to:
  /// **'API key saved on this computer.'**
  String get settingsApiKeySaved;

  /// settings.apiKey — Field label.
  ///
  /// In en, this message translates to:
  /// **'API key'**
  String get settingsApiKey;

  /// settings.apiKeyHint — Field hint.
  ///
  /// In en, this message translates to:
  /// **'Paste a new key to replace the saved one'**
  String get settingsApiKeyHint;

  /// settings.languageDaemonFailed — Says which half did not save.
  ///
  /// In en, this message translates to:
  /// **'The phone is now in this language, but the computer could not be updated.'**
  String get settingsLanguageDaemonFailed;

  /// network.title — Screen title.
  ///
  /// In en, this message translates to:
  /// **'Network status'**
  String get networkTitle;

  /// network.checkAgain — Asks the desktop what it sees.
  ///
  /// In en, this message translates to:
  /// **'Check again'**
  String get networkCheckAgain;

  /// network.copyReport — Icon control's tooltip and accessible name.
  ///
  /// In en, this message translates to:
  /// **'Copy report'**
  String get networkCopyReport;

  /// network.copied — Confirms what was copied.
  ///
  /// In en, this message translates to:
  /// **'Network report copied — paste it into the bug report.'**
  String get networkCopied;

  /// network.tokenNote — Why no token is displayed.
  ///
  /// In en, this message translates to:
  /// **'The pairing token is never shown here — it is a credential.'**
  String get networkTokenNote;

  /// network.computer — Row label: which machine this panel is about.
  ///
  /// In en, this message translates to:
  /// **'Computer'**
  String get networkComputer;

  /// network.activeRoute — Row label: the rung in use.
  ///
  /// In en, this message translates to:
  /// **'Active route'**
  String get networkActiveRoute;

  /// network.app — Row label: which app paired.
  ///
  /// In en, this message translates to:
  /// **'App'**
  String get networkApp;

  /// network.pairingHeading — Section heading.
  ///
  /// In en, this message translates to:
  /// **'What the pairing gave us'**
  String get networkPairingHeading;

  /// network.desktopPeerId — Row label.
  ///
  /// In en, this message translates to:
  /// **'Desktop peer id'**
  String get networkDesktopPeerId;

  /// network.dialablePeers — Row label.
  ///
  /// In en, this message translates to:
  /// **'Dialable peer addresses'**
  String get networkDialablePeers;

  /// network.pairingMissing — Why the peer rung is absent.
  ///
  /// In en, this message translates to:
  /// **'Both are needed for the peer-to-peer route, so this host has none. A pairing made before the desktop carried these fields has neither — the phone is left with the direct address and the relay.'**
  String get networkPairingMissing;

  /// network.ladderHeading — Section heading.
  ///
  /// In en, this message translates to:
  /// **'How this computer was tried'**
  String get networkLadderHeading;

  /// network.ladderNoCandidatesYet — Empty ladder before any walk.
  ///
  /// In en, this message translates to:
  /// **'No candidates yet — nothing has been dialled for this computer.'**
  String get networkLadderNoCandidatesYet;

  /// network.ladderNoCandidates — Empty ladder after a walk.
  ///
  /// In en, this message translates to:
  /// **'This pass produced no candidates: the walk is held back under dial pressure, or the pairing names no address at all.'**
  String get networkLadderNoCandidates;

  /// network.ladderLimit — Explains the per-pass cap.
  ///
  /// In en, this message translates to:
  /// **'This pass dials at most {limit}: {waiting} of {total} wait for the next pass.'**
  String networkLadderLimit(int limit, int waiting, int total);

  /// network.attemptConnected — Rung outcome.
  ///
  /// In en, this message translates to:
  /// **'connected'**
  String get networkAttemptConnected;

  /// network.attemptFailed — Rung outcome.
  ///
  /// In en, this message translates to:
  /// **'failed'**
  String get networkAttemptFailed;

  /// network.attemptNoAnswer — Rung outcome: transport opened, no reply.
  ///
  /// In en, this message translates to:
  /// **'no answer'**
  String get networkAttemptNoAnswer;

  /// network.attemptDialling — Rung outcome: in flight.
  ///
  /// In en, this message translates to:
  /// **'dialling'**
  String get networkAttemptDialling;

  /// network.attemptNotTried — Rung outcome: skipped.
  ///
  /// In en, this message translates to:
  /// **'not tried'**
  String get networkAttemptNotTried;

  /// network.attemptPlanned — Rung outcome: not started.
  ///
  /// In en, this message translates to:
  /// **'planned'**
  String get networkAttemptPlanned;

  /// network.lastRequestHeading — Section heading.
  ///
  /// In en, this message translates to:
  /// **'Last request to the desktop'**
  String get networkLastRequestHeading;

  /// network.nothingAsked — No RPC yet.
  ///
  /// In en, this message translates to:
  /// **'Nothing has been asked yet since the app started.'**
  String get networkNothingAsked;

  /// network.method — Row label.
  ///
  /// In en, this message translates to:
  /// **'Method'**
  String get networkMethod;

  /// network.outcome — Row label.
  ///
  /// In en, this message translates to:
  /// **'Outcome'**
  String get networkOutcome;

  /// network.answered — RPC outcome.
  ///
  /// In en, this message translates to:
  /// **'answered'**
  String get networkAnswered;

  /// network.took — Row label: elapsed time.
  ///
  /// In en, this message translates to:
  /// **'Took'**
  String get networkTook;

  /// network.lastWalk — Row label.
  ///
  /// In en, this message translates to:
  /// **'Last walk'**
  String get networkLastWalk;

  /// network.phoneNodeHeading — Section heading.
  ///
  /// In en, this message translates to:
  /// **'This phone\'s libp2p node'**
  String get networkPhoneNodeHeading;

  /// network.nodeNotStarted — The phone node is lazy.
  ///
  /// In en, this message translates to:
  /// **'Not started — no peer-to-peer route has been dialled in this launch. It starts on the first such dial, and looking at this screen does not start it.'**
  String get networkNodeNotStarted;

  /// network.peerId — Row label.
  ///
  /// In en, this message translates to:
  /// **'Peer id'**
  String get networkPeerId;

  /// network.starting — A value that has not arrived.
  ///
  /// In en, this message translates to:
  /// **'starting'**
  String get networkStarting;

  /// network.relayDialling — Row label.
  ///
  /// In en, this message translates to:
  /// **'Relay dialling'**
  String get networkRelayDialling;

  /// network.enabled — Boolean value.
  ///
  /// In en, this message translates to:
  /// **'enabled'**
  String get networkEnabled;

  /// network.disabled — Boolean value.
  ///
  /// In en, this message translates to:
  /// **'disabled'**
  String get networkDisabled;

  /// network.relayReservation — Row label.
  ///
  /// In en, this message translates to:
  /// **'Relay reservation'**
  String get networkRelayReservation;

  /// network.connectedPeers — Row label.
  ///
  /// In en, this message translates to:
  /// **'Connected peers'**
  String get networkConnectedPeers;

  /// network.connectedPeersUnavailable — The honest unknown.
  ///
  /// In en, this message translates to:
  /// **'unavailable — the shared node exposes no connection view'**
  String get networkConnectedPeersUnavailable;

  /// network.lanPeers — Row label.
  ///
  /// In en, this message translates to:
  /// **'LAN peers seen'**
  String get networkLanPeers;

  /// network.mdns — Row label. A protocol name.
  ///
  /// In en, this message translates to:
  /// **'mDNS'**
  String get networkMdns;

  /// network.active — Boolean value.
  ///
  /// In en, this message translates to:
  /// **'active'**
  String get networkActive;

  /// network.inactive — Boolean value.
  ///
  /// In en, this message translates to:
  /// **'inactive'**
  String get networkInactive;

  /// network.registeredProtocols — Row label.
  ///
  /// In en, this message translates to:
  /// **'Registered protocols'**
  String get networkRegisteredProtocols;

  /// network.hostGeneration — Row label.
  ///
  /// In en, this message translates to:
  /// **'Host generation'**
  String get networkHostGeneration;

  /// network.desktopMeshHeading — Section heading.
  ///
  /// In en, this message translates to:
  /// **'What the desktop says about itself'**
  String get networkDesktopMeshHeading;

  /// network.notAsked — The mesh section before a probe.
  ///
  /// In en, this message translates to:
  /// **'Not asked yet. “Check again” asks the desktop for its own mesh status — the difference between “this phone cannot reach it” and “it has nothing to reach”.'**
  String get networkNotAsked;

  /// network.noUsableAnswer — The probe failed.
  ///
  /// In en, this message translates to:
  /// **'No usable answer: {reason}'**
  String networkNoUsableAnswer(String reason);

  /// network.unreadable — Fallback reason.
  ///
  /// In en, this message translates to:
  /// **'unreadable'**
  String get networkUnreadable;

  /// network.state — Row label.
  ///
  /// In en, this message translates to:
  /// **'State'**
  String get networkState;

  /// network.itsPeerId — Row label.
  ///
  /// In en, this message translates to:
  /// **'Its peer id'**
  String get networkItsPeerId;

  /// network.itsDialable — Row label.
  ///
  /// In en, this message translates to:
  /// **'Its dialable addresses'**
  String get networkItsDialable;

  /// network.itsRelayHints — Row label.
  ///
  /// In en, this message translates to:
  /// **'Its relay hints'**
  String get networkItsRelayHints;

  /// network.peersConnected — Row label; the desktop's own count.
  ///
  /// In en, this message translates to:
  /// **'Peers it is connected to'**
  String get networkPeersConnected;

  /// network.itsReason — Row label.
  ///
  /// In en, this message translates to:
  /// **'Its reason'**
  String get networkItsReason;

  /// explorer.title — Screen title.
  ///
  /// In en, this message translates to:
  /// **'Explorer'**
  String get explorerTitle;

  /// explorer.files — Tab label.
  ///
  /// In en, this message translates to:
  /// **'Files'**
  String get explorerFiles;

  /// explorer.changes — Tab label.
  ///
  /// In en, this message translates to:
  /// **'Changes'**
  String get explorerChanges;

  /// explorer.folderEmpty — Empty file list.
  ///
  /// In en, this message translates to:
  /// **'This folder is empty.'**
  String get explorerFolderEmpty;

  /// explorer.couldNotList — The listing RPC failed.
  ///
  /// In en, this message translates to:
  /// **'Could not list this folder.'**
  String get explorerCouldNotList;

  /// explorer.notRepo — No worktree to diff.
  ///
  /// In en, this message translates to:
  /// **'This folder is not a git repository.'**
  String get explorerNotRepo;

  /// explorer.noChanges — Clean worktree.
  ///
  /// In en, this message translates to:
  /// **'No changes in this folder.'**
  String get explorerNoChanges;

  /// explorercommitmessage — Placeholder of the commit message field.
  ///
  /// In en, this message translates to:
  /// **'Commit message'**
  String get explorerCommitMessage;

  /// explorercommitcta — The button that commits what is staged.
  ///
  /// In en, this message translates to:
  /// **'Commit'**
  String get explorerCommitCta;

  /// explorercommitstageall — Stages every changed path from one press.
  ///
  /// In en, this message translates to:
  /// **'Stage all'**
  String get explorerCommitStageAll;

  /// explorercommitdone — After a commit, naming the short sha.
  ///
  /// In en, this message translates to:
  /// **'Committed {sha}.'**
  String explorerCommitDone(String sha);

  /// explorerstage — Stages one path, naming it.
  ///
  /// In en, this message translates to:
  /// **'Stage {path}'**
  String explorerStage(String path);

  /// explorerunstage — Unstages one path, naming it.
  ///
  /// In en, this message translates to:
  /// **'Unstage {path}'**
  String explorerUnstage(String path);

  /// explorer.couldNotRead — The changes RPC failed.
  ///
  /// In en, this message translates to:
  /// **'Could not read the changes.'**
  String get explorerCouldNotRead;

  /// explorer.kindAdded — Change kind.
  ///
  /// In en, this message translates to:
  /// **'Added'**
  String get explorerKindAdded;

  /// explorer.kindModified — Change kind.
  ///
  /// In en, this message translates to:
  /// **'Modified'**
  String get explorerKindModified;

  /// explorer.kindDeleted — Change kind.
  ///
  /// In en, this message translates to:
  /// **'Deleted'**
  String get explorerKindDeleted;

  /// explorer.kindRenamed — Change kind.
  ///
  /// In en, this message translates to:
  /// **'Renamed'**
  String get explorerKindRenamed;

  /// explorer.kindNew — Change kind: untracked.
  ///
  /// In en, this message translates to:
  /// **'New'**
  String get explorerKindNew;

  /// explorer.kindConflict — Change kind.
  ///
  /// In en, this message translates to:
  /// **'Conflict'**
  String get explorerKindConflict;

  /// folder.title — The browser's app bar.
  ///
  /// In en, this message translates to:
  /// **'Choose project folder'**
  String get folderTitle;

  /// folder.useThisFolder — Picks the folder shown.
  ///
  /// In en, this message translates to:
  /// **'Use this folder'**
  String get folderUseThisFolder;

  /// folder.computer — Jump to the filesystem root.
  ///
  /// In en, this message translates to:
  /// **'Computer'**
  String get folderComputer;

  /// folder.drives — Jump to the drive list (Windows).
  ///
  /// In en, this message translates to:
  /// **'Drives'**
  String get folderDrives;

  /// folder.home — Jump to the home folder.
  ///
  /// In en, this message translates to:
  /// **'Home'**
  String get folderHome;

  /// folder.parent — Go up one level.
  ///
  /// In en, this message translates to:
  /// **'Parent folder'**
  String get folderParent;

  /// folder.empty — Empty folder listing.
  ///
  /// In en, this message translates to:
  /// **'No subfolders here'**
  String get folderEmpty;

  /// run.stop — Cancels the live run.
  ///
  /// In en, this message translates to:
  /// **'Stop'**
  String get runStop;

  /// run.stopping — In-flight state of Stop.
  ///
  /// In en, this message translates to:
  /// **'Stopping…'**
  String get runStopping;

  /// run.live — Marks a run that is still going.
  ///
  /// In en, this message translates to:
  /// **'Live'**
  String get runLive;

  /// run.toggleExplorer — Icon control's tooltip and accessible name.
  ///
  /// In en, this message translates to:
  /// **'Toggle Explorer sidebar'**
  String get runToggleExplorer;

  /// run.couldNotAnswer — The approval RPC failed.
  ///
  /// In en, this message translates to:
  /// **'Could not send that answer. Try again.'**
  String get runCouldNotAnswer;

  /// run.couldNotUpdateTask — Persisting the composer selection failed.
  ///
  /// In en, this message translates to:
  /// **'Could not update the task on the computer.'**
  String get runCouldNotUpdateTask;

  /// run.couldNotSend — Sending a turn failed.
  ///
  /// In en, this message translates to:
  /// **'Could not send. Try again.'**
  String get runCouldNotSend;

  /// run.couldNotStop — Cancelling the run failed.
  ///
  /// In en, this message translates to:
  /// **'Could not stop the run. Try again.'**
  String get runCouldNotStop;

  /// run.noFolder — Explorer needs a working directory.
  ///
  /// In en, this message translates to:
  /// **'This task has no folder yet.'**
  String get runNoFolder;

  /// run.couldNotOpen — The tail RPC failed and no task id was known.
  ///
  /// In en, this message translates to:
  /// **'Could not open this run.'**
  String get runCouldNotOpen;

  /// run.earlierNotHere — History is gone but the task is not.
  ///
  /// In en, this message translates to:
  /// **'The earlier conversation is not on this computer. A new message still starts here.'**
  String get runEarlierNotHere;

  /// run.historyGap — A sequence number was missed.
  ///
  /// In en, this message translates to:
  /// **'Some of this task\'s history did not arrive. What is here is in order.'**
  String get runHistoryGap;

  /// run.queue — Send mode: wait for the turn.
  ///
  /// In en, this message translates to:
  /// **'Queue'**
  String get runQueue;

  /// run.steer — Send mode: join the turn now.
  ///
  /// In en, this message translates to:
  /// **'Steer'**
  String get runSteer;

  /// run.joinsTurn — What Steer means.
  ///
  /// In en, this message translates to:
  /// **'Joins the turn now'**
  String get runJoinsTurn;

  /// run.waitsTurn — What Queue means.
  ///
  /// In en, this message translates to:
  /// **'Waits for this turn to finish'**
  String get runWaitsTurn;

  /// run.placeholderAnswer — The composer is blocked on an approval.
  ///
  /// In en, this message translates to:
  /// **'Answer the request above first'**
  String get runPlaceholderAnswer;

  /// run.placeholderFollowUp — Composer hint while live.
  ///
  /// In en, this message translates to:
  /// **'Send a follow-up…'**
  String get runPlaceholderFollowUp;

  /// run.placeholderContinue — Composer hint when the run has ended.
  ///
  /// In en, this message translates to:
  /// **'Send a message to continue'**
  String get runPlaceholderContinue;

  /// run.you — Marks the user's own message.
  ///
  /// In en, this message translates to:
  /// **'You'**
  String get runYou;

  /// run.youSteered — A message that joined the live turn.
  ///
  /// In en, this message translates to:
  /// **'You · joined the turn'**
  String get runYouSteered;

  /// run.youQueued — A message that waited for the turn.
  ///
  /// In en, this message translates to:
  /// **'You · waited for the turn'**
  String get runYouQueued;

  /// run.thoughtTitle — Collapsed reasoning row.
  ///
  /// In en, this message translates to:
  /// **'How it thought about this'**
  String get runThoughtTitle;

  /// run.answered — An approval that has an answer.
  ///
  /// In en, this message translates to:
  /// **'Answered'**
  String get runAnswered;

  /// run.answeredWith — Which option was chosen.
  ///
  /// In en, this message translates to:
  /// **'Answered: {option}'**
  String runAnsweredWith(String option);

  /// run.needsAnswer — An approval that is still open.
  ///
  /// In en, this message translates to:
  /// **'The agent needs your answer'**
  String get runNeedsAnswer;

  /// approvalquestiontool — The permission the agent is asking for, naming the tool.
  ///
  /// In en, this message translates to:
  /// **'Allow the agent to run “{tool}”?'**
  String approvalQuestionTool(String tool);

  /// approvalquestiongeneric — The permission question when no tool name is known.
  ///
  /// In en, this message translates to:
  /// **'Allow the agent to continue?'**
  String get approvalQuestionGeneric;

  /// approvalquestionask — A question the model asked with no prompt of its own.
  ///
  /// In en, this message translates to:
  /// **'The agent asked a question.'**
  String get approvalQuestionAsk;

  /// approvaldetail — Under a permission question: what answering does.
  ///
  /// In en, this message translates to:
  /// **'It has stopped before this step and will not continue until you answer. Allowing it lets this same step run again in this project without asking.'**
  String get approvalDetail;

  /// approvaldetailpick — Under a single-choice question.
  ///
  /// In en, this message translates to:
  /// **'Pick one. This answer is only for this question.'**
  String get approvalDetailPick;

  /// approvaldetailmultiple — Under a checkbox question.
  ///
  /// In en, this message translates to:
  /// **'Tick every option that applies, then confirm. This answer is only for this question.'**
  String get approvalDetailMultiple;

  /// approvaldetailtext — Under a typed-answer question.
  ///
  /// In en, this message translates to:
  /// **'Type your answer. The agent will not continue until you send it.'**
  String get approvalDetailText;

  /// approvalallow — The permission button that lets the step run.
  ///
  /// In en, this message translates to:
  /// **'Allow'**
  String get approvalAllow;

  /// approvaldeny — The permission button that refuses.
  ///
  /// In en, this message translates to:
  /// **'Don\'t allow'**
  String get approvalDeny;

  /// runapprovalneedsdecision — Question line when the daemon sent none.
  ///
  /// In en, this message translates to:
  /// **'The agent needs a decision.'**
  String get runApprovalNeedsDecision;

  /// run.noLongerWaiting — The run ended while the card was open.
  ///
  /// In en, this message translates to:
  /// **'No longer waiting.'**
  String get runNoLongerWaiting;

  /// run.yourAnswer — Text-answer field hint.
  ///
  /// In en, this message translates to:
  /// **'Your answer'**
  String get runYourAnswer;

  /// run.toolFallback — A tool call with no name from the agent.
  ///
  /// In en, this message translates to:
  /// **'tool'**
  String get runToolFallback;

  /// run.noteDiff — A run.diff note.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 file changed.} other{{count} files changed.}}'**
  String runNoteDiff(int count);

  /// run.noteContext — A run.usage note.
  ///
  /// In en, this message translates to:
  /// **'Context {percent}% full.'**
  String runNoteContext(int percent);

  /// run.noteFinished — The run ended cleanly.
  ///
  /// In en, this message translates to:
  /// **'Finished.'**
  String get runNoteFinished;

  /// run.noteStopped — The run was cancelled.
  ///
  /// In en, this message translates to:
  /// **'Stopped.'**
  String get runNoteStopped;

  /// run.noteStoppedBefore — The run failed.
  ///
  /// In en, this message translates to:
  /// **'Stopped before it finished.'**
  String get runNoteStoppedBefore;

  /// run.noteEnded — The run ended without a known status.
  ///
  /// In en, this message translates to:
  /// **'Ended.'**
  String get runNoteEnded;

  /// attach.add — Attach menu item.
  ///
  /// In en, this message translates to:
  /// **'Add image'**
  String get attachAdd;

  /// attach.tooltip — Tooltip of the composer's attach button.
  ///
  /// In en, this message translates to:
  /// **'Attach'**
  String get attachTooltip;

  /// attach.paste — Attach menu item.
  ///
  /// In en, this message translates to:
  /// **'Paste image'**
  String get attachPaste;

  /// attach.file — Attach menu item.
  ///
  /// In en, this message translates to:
  /// **'Add file'**
  String get attachFile;

  /// attach.remove — Delete-button tooltip on an attachment chip.
  ///
  /// In en, this message translates to:
  /// **'Remove {name}'**
  String attachRemove(String name);

  /// attach.tooBig — Attachment refusal.
  ///
  /// In en, this message translates to:
  /// **'That file is too large to attach.'**
  String get attachTooBig;

  /// attach.binary — Attachment refusal.
  ///
  /// In en, this message translates to:
  /// **'Only images and text files can be attached.'**
  String get attachBinary;

  /// attach.unreadable — Attachment refusal.
  ///
  /// In en, this message translates to:
  /// **'That file could not be read.'**
  String get attachUnreadable;

  /// attach.empty — Attachment refusal.
  ///
  /// In en, this message translates to:
  /// **'That file is empty.'**
  String get attachEmpty;

  /// attach.limit — Attachment limit reached.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{You can attach 1 file.} other{You can attach up to {count} files.}}'**
  String attachLimit(int count);

  /// attach.clipboardMissing — The clipboard held no image.
  ///
  /// In en, this message translates to:
  /// **'No image was on the clipboard.'**
  String get attachClipboardMissing;

  /// attach.failed — Reading the chosen file failed.
  ///
  /// In en, this message translates to:
  /// **'Could not attach that file.'**
  String get attachFailed;

  /// attach.imagesOnly — The prompt sent when only a picture is attached.
  ///
  /// In en, this message translates to:
  /// **'Look at the attached image.'**
  String get attachImagesOnly;

  /// attach.imagesOnlyMany — The prompt sent when several pictures are attached.
  ///
  /// In en, this message translates to:
  /// **'Look at the attached images.'**
  String get attachImagesOnlyMany;

  /// attach.named — The prompt sent with named attachments.
  ///
  /// In en, this message translates to:
  /// **'Attached: {names}'**
  String attachNamed(String names);

  /// addProject.title — Sheet title.
  ///
  /// In en, this message translates to:
  /// **'Add project'**
  String get addProjectTitle;

  /// addProject.detail — What a project is.
  ///
  /// In en, this message translates to:
  /// **'Pick a folder on this computer. Agents will run inside it.'**
  String get addProjectDetail;

  /// addProject.folder — Folder field label.
  ///
  /// In en, this message translates to:
  /// **'Folder'**
  String get addProjectFolder;

  /// addProject.folderHint — Example path. Not translated.
  ///
  /// In en, this message translates to:
  /// **'/Users/you/work/repo'**
  String get addProjectFolderHint;

  /// addProject.browse — Opens the folder picker.
  ///
  /// In en, this message translates to:
  /// **'Browse'**
  String get addProjectBrowse;

  /// addProject.defaultAgent — The agent picker's label.
  ///
  /// In en, this message translates to:
  /// **'Default agent'**
  String get addProjectDefaultAgent;

  /// addProject.chooseFolder — Refusal when no folder was chosen.
  ///
  /// In en, this message translates to:
  /// **'Choose a folder on this computer.'**
  String get addProjectChooseFolder;

  /// addProject.submit — Submit button.
  ///
  /// In en, this message translates to:
  /// **'Add project'**
  String get addProjectSubmit;

  /// markdown.mermaid — Why a diagram is shown as source on the phone.
  ///
  /// In en, this message translates to:
  /// **'Mermaid diagram — source shown here; the computer renders the chart in the desktop app.'**
  String get markdownMermaid;

  /// markdown.copy — Copy button on a code block.
  ///
  /// In en, this message translates to:
  /// **'Copy'**
  String get markdownCopy;

  /// markdown.copied — Confirmation after copying.
  ///
  /// In en, this message translates to:
  /// **'Copied'**
  String get markdownCopied;

  /// projectlistattention — The top-bar attention badge.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 needs you} other{{count} need you}}'**
  String projectListAttention(int count);

  /// projectlistnoprojects — Empty project list, no search active.
  ///
  /// In en, this message translates to:
  /// **'No projects yet — add a folder on this computer.'**
  String get projectListNoProjects;

  /// projectlistnomatch — Empty project list while searching.
  ///
  /// In en, this message translates to:
  /// **'Nothing matches that search.'**
  String get projectListNoMatch;

  /// projectlistcouldnotload — The project/task list RPC failed.
  ///
  /// In en, this message translates to:
  /// **'Could not load work from this computer. {detail}'**
  String projectListCouldNotLoad(String detail);

  /// commonconnectionfailed — A refusal whose detail named a credential; the detail is hidden.
  ///
  /// In en, this message translates to:
  /// **'The connection failed.'**
  String get commonConnectionFailed;

  /// projectlistcouldnotchangeagent — coder.updateProject failed.
  ///
  /// In en, this message translates to:
  /// **'Could not change the project agent.'**
  String get projectListCouldNotChangeAgent;

  /// projectlistremovetitle — Confirmation title for removing a project.
  ///
  /// In en, this message translates to:
  /// **'Remove {project}?'**
  String projectListRemoveTitle(String project);

  /// projectlistremovemessage — What removing a project costs and what it does not.
  ///
  /// In en, this message translates to:
  /// **'The project leaves EnvoyDev and its tasks leave the list — they are archived, not deleted, and nothing in that folder is touched. Removing the project cannot be undone.'**
  String get projectListRemoveMessage;

  /// projectlistremovefailed — coder.removeProject failed.
  ///
  /// In en, this message translates to:
  /// **'Could not remove {project}. It is still in the list.'**
  String projectListRemoveFailed(String project);

  /// projectlistremoved — The project left the list; no tasks were archived.
  ///
  /// In en, this message translates to:
  /// **'Removed {project}.'**
  String projectListRemoved(String project);

  /// projectlistremovedarchived — The project left the list and its tasks were archived.
  ///
  /// In en, this message translates to:
  /// **'Removed {project}. {count, plural, =1{1 task was archived.} other{{count} tasks were archived.}}'**
  String projectListRemovedArchived(String project, int count);

  /// taskremovetitle — Confirmation title for removing a task from the list.
  ///
  /// In en, this message translates to:
  /// **'Remove {title}?'**
  String taskRemoveTitle(String title);

  /// taskremovemessage — What removing a task costs and what it does not.
  ///
  /// In en, this message translates to:
  /// **'It leaves the task list. The folder, its files and the transcript stay on this computer — archiving is not deletion.'**
  String get taskRemoveMessage;

  /// projectlistremovetaskfailed — coder.archiveTask failed from the project row.
  ///
  /// In en, this message translates to:
  /// **'Could not remove {title}. It is still in the list.'**
  String projectListRemoveTaskFailed(String title);

  /// runcouldnotremove — coder.archiveTask failed from the run screen.
  ///
  /// In en, this message translates to:
  /// **'Could not remove this task. It is still here.'**
  String get runCouldNotRemove;

  /// projectlistrenametasktitle — Dialog title for renaming a task.
  ///
  /// In en, this message translates to:
  /// **'Rename task'**
  String get projectListRenameTaskTitle;

  /// projectlistrenametaskfield — The task-name field's label.
  ///
  /// In en, this message translates to:
  /// **'Task name'**
  String get projectListRenameTaskField;

  /// projectlistrenametaskempty — Refusal when the task-name field is blank.
  ///
  /// In en, this message translates to:
  /// **'Enter a name for this task.'**
  String get projectListRenameTaskEmpty;

  /// projectlistrenametaskfailed — coder.updateTask failed.
  ///
  /// In en, this message translates to:
  /// **'Could not rename {title}. The name is unchanged.'**
  String projectListRenameTaskFailed(String title);

  /// projectlistnetworkstatusfor — Accessible name and tooltip of the top bar's cell tower.
  ///
  /// In en, this message translates to:
  /// **'Network status for {host} — {state}'**
  String projectListNetworkStatusFor(String host, String state);

  /// projectlistswitchconnection — Accessible name of the top bar's connection name.
  ///
  /// In en, this message translates to:
  /// **'Switch connection — current: {host}'**
  String projectListSwitchConnection(String host);

  /// projectlistnotasks — A project with an empty task list.
  ///
  /// In en, this message translates to:
  /// **'No tasks in this project yet'**
  String get projectListNoTasks;

  /// projectlistagentfor — Sheet title when picking a project's agent.
  ///
  /// In en, this message translates to:
  /// **'Agent for {project}'**
  String projectListAgentFor(String project);

  /// projectlistchangeagent — Menu item that opens the project's agent picker.
  ///
  /// In en, this message translates to:
  /// **'Change agent'**
  String get projectListChangeAgent;

  /// gitbranchesaria — The branch control's accessible name, naming the project.
  ///
  /// In en, this message translates to:
  /// **'Branches for {project}'**
  String gitBranchesAria(String project);

  /// gitbranchestitle — Heading of the branch sheet.
  ///
  /// In en, this message translates to:
  /// **'Branches'**
  String get gitBranchesTitle;

  /// gitbrancheschip — The rail chip: the word Branch and the branch it is on.
  ///
  /// In en, this message translates to:
  /// **'Branch: {branch}'**
  String gitBranchesChip(String branch);

  /// gitbranchesdetachedchip — The rail chip when HEAD is detached.
  ///
  /// In en, this message translates to:
  /// **'No branch'**
  String get gitBranchesDetachedChip;

  /// gitbranchesdetached — Says out loud that no branch is current.
  ///
  /// In en, this message translates to:
  /// **'This repository is on a detached HEAD, so no branch is current.'**
  String get gitBranchesDetached;

  /// gitbranchesempty — A repository with no branches yet.
  ///
  /// In en, this message translates to:
  /// **'This repository has no branches yet.'**
  String get gitBranchesEmpty;

  /// gitbranchesnew — Label of the new-branch field.
  ///
  /// In en, this message translates to:
  /// **'New branch'**
  String get gitBranchesNew;

  /// gitbranchesname — Placeholder of the new-branch field.
  ///
  /// In en, this message translates to:
  /// **'Branch name'**
  String get gitBranchesName;

  /// gitbranchescreate — The button that creates a branch and switches to it.
  ///
  /// In en, this message translates to:
  /// **'Create and switch'**
  String get gitBranchesCreate;

  /// gitbranchesswitched — After switching, naming the branch.
  ///
  /// In en, this message translates to:
  /// **'Switched to {branch}.'**
  String gitBranchesSwitched(String branch);

  /// gitbranchescreated — After creating, naming the branch.
  ///
  /// In en, this message translates to:
  /// **'Created {branch} and switched to it.'**
  String gitBranchesCreated(String branch);

  /// gitmergeinto — Merges a branch into the one the project is on, naming both.
  ///
  /// In en, this message translates to:
  /// **'Merge {branch} into {current}'**
  String gitMergeInto(String branch, String current);

  /// gitmergecta — The merge button in the branch sheet.
  ///
  /// In en, this message translates to:
  /// **'Merge'**
  String get gitMergeCta;

  /// gitmergedone — After a merge, naming the branch and where it landed.
  ///
  /// In en, this message translates to:
  /// **'Merged {branch} into {into}.'**
  String gitMergeDone(String branch, String into);

  /// gitfetchcta — Fetches the remote.
  ///
  /// In en, this message translates to:
  /// **'Fetch'**
  String get gitFetchCta;

  /// gitfetchdone — After a fetch, with git's own summary.
  ///
  /// In en, this message translates to:
  /// **'Fetched. {summary}'**
  String gitFetchDone(String summary);

  /// gitfetchnothing — A fetch that brought nothing new.
  ///
  /// In en, this message translates to:
  /// **'Fetched. Nothing new.'**
  String get gitFetchNothing;

  /// gitpullcta — Pulls the current branch.
  ///
  /// In en, this message translates to:
  /// **'Pull'**
  String get gitPullCta;

  /// gitpulldone — After a pull, with git's own summary.
  ///
  /// In en, this message translates to:
  /// **'Pulled. {summary}'**
  String gitPullDone(String summary);

  /// gitpullnothing — A pull that was already up to date.
  ///
  /// In en, this message translates to:
  /// **'Pulled. Already up to date.'**
  String get gitPullNothing;

  /// errorgitmergeconflict — A merge stopped on conflicts and was undone.
  ///
  /// In en, this message translates to:
  /// **'{branch} cannot be merged automatically. These files conflict: {files}. Nothing was changed — your branch and your working tree are exactly as they were.'**
  String errorGitMergeConflict(String branch, String files);

  /// errorgitpulldiverged — A pull could not fast-forward.
  ///
  /// In en, this message translates to:
  /// **'The branch on the computer and the one on the remote have both changed, so a pull cannot bring them together. Merge them, or push your branch.'**
  String get errorGitPullDiverged;

  /// gitstashtitle — The heading of the list of work this project has set aside.
  ///
  /// In en, this message translates to:
  /// **'Stashes'**
  String get gitStashTitle;

  /// gitstashcta — Sets the whole working tree aside, untracked files included.
  ///
  /// In en, this message translates to:
  /// **'Stash'**
  String get gitStashCta;

  /// gitstashdone — Confirms that the working tree was set aside.
  ///
  /// In en, this message translates to:
  /// **'Stashed.'**
  String get gitStashDone;

  /// git.stash.pop — Puts one stash back into the working tree.
  ///
  /// In en, this message translates to:
  /// **'Put back'**
  String get gitStashPop;

  /// git.stash.drop — Discards one stash for good; the only stash action that destroys work.
  ///
  /// In en, this message translates to:
  /// **'Discard'**
  String get gitStashDrop;

  /// git.stash.confirm — The question shown before a stash is discarded.
  ///
  /// In en, this message translates to:
  /// **'Discard this stash?'**
  String get gitStashConfirm;

  /// errorgitnothingtostash — A stash was asked for on a working tree that has nothing to set aside.
  ///
  /// In en, this message translates to:
  /// **'There is nothing to stash — no file in this folder has uncommitted changes.'**
  String get errorGitNothingToStash;

  /// errorgitstashdirty — A stash cannot be put back onto a working tree that has changes.
  ///
  /// In en, this message translates to:
  /// **'Putting a stash back needs a clean working tree. Commit or stash the changes in this folder first.'**
  String get errorGitStashDirty;

  /// errorgitstashconflict — A stash could not be put back cleanly, and the attempt was undone.
  ///
  /// In en, this message translates to:
  /// **'This stash cannot be put back cleanly. These files conflict: {files}. Nothing was changed, and the stash is still there.'**
  String errorGitStashConflict(String files);

  /// errorgitmergeunresolved — A merge is in progress and its conflicts are not all resolved.
  ///
  /// In en, this message translates to:
  /// **'A merge is not finished: {files} still has conflicts. Resolve them and finish the merge, or abort it.'**
  String errorGitMergeUnresolved(String files);

  /// errorgitmergenone — A merge was to be finished or aborted, and none is in progress.
  ///
  /// In en, this message translates to:
  /// **'No merge is in progress, so there is nothing to finish or abort.'**
  String get errorGitMergeNone;

  /// errorgitconflicted — Unresolved conflicts from an operation EnvoyDev did not start.
  ///
  /// In en, this message translates to:
  /// **'This repository has unresolved conflicts in {files}, from an operation EnvoyDev did not start. Finish or undo it there before doing anything else here.'**
  String errorGitConflicted(String files);

  /// errorgitmergeresolvefailed — The agent that was to resolve a merge could not be started, so the merge was taken back.
  ///
  /// In en, this message translates to:
  /// **'The agent could not be started, so the merge was taken back and nothing changed: {detail}'**
  String errorGitMergeResolveFailed(String detail);

  /// gitmergestopped — A merge stopped with conflicts, and git could not name the branch.
  ///
  /// In en, this message translates to:
  /// **'A merge stopped with conflicts.'**
  String get gitMergeStopped;

  /// gitmergestoppedfrom — A merge of this branch stopped with conflicts.
  ///
  /// In en, this message translates to:
  /// **'The merge of {branch} stopped with conflicts.'**
  String gitMergeStoppedFrom(String branch);

  /// gitmergeresolved — Every conflict is resolved and the merge can be recorded.
  ///
  /// In en, this message translates to:
  /// **'All conflicts are resolved. Finish the merge to record it.'**
  String get gitMergeResolved;

  /// gitmergeresolve — Merges again, keeping the conflict, and lets an agent resolve it.
  ///
  /// In en, this message translates to:
  /// **'Resolve with an agent'**
  String get gitMergeResolve;

  /// gitmergefinish — Records a merge whose conflicts are resolved.
  ///
  /// In en, this message translates to:
  /// **'Finish the merge'**
  String get gitMergeFinish;

  /// gitmergeabort — Takes a merge in progress back.
  ///
  /// In en, this message translates to:
  /// **'Abort the merge'**
  String get gitMergeAbort;

  /// gitmergeresolving — Names the task an agent is resolving the merge in.
  ///
  /// In en, this message translates to:
  /// **'An agent is resolving this merge: {task}.'**
  String gitMergeResolving(String task);

  /// gitmergeaborted — Confirms that a merge in progress was taken back.
  ///
  /// In en, this message translates to:
  /// **'The merge was aborted, and nothing was merged.'**
  String get gitMergeAborted;

  /// gitmergerecorded — Confirms that a resolved merge was committed.
  ///
  /// In en, this message translates to:
  /// **'The merge was recorded.'**
  String get gitMergeRecorded;

  /// gitbranchesconflictschip — The branch chip while a merge has unresolved conflicts.
  ///
  /// In en, this message translates to:
  /// **'Conflicts'**
  String get gitBranchesConflictsChip;

  /// newtasknoprojects — The new-task sheet with no project to add to.
  ///
  /// In en, this message translates to:
  /// **'Add a project on the computer first, then try again.'**
  String get newTaskNoProjects;

  /// newtaskprojectlabel — The project picker's label on the latent no-project path.
  ///
  /// In en, this message translates to:
  /// **'Project'**
  String get newTaskProjectLabel;

  /// newtaskprompthint — The new-task field's hint.
  ///
  /// In en, this message translates to:
  /// **'Describe the task'**
  String get newTaskPromptHint;

  /// newtaskcouldnotstart — Creating or starting the task failed.
  ///
  /// In en, this message translates to:
  /// **'Could not start that task. {detail}'**
  String newTaskCouldNotStart(String detail);

  /// composeragentdefault — The picker's item for 'the agent's own default'.
  ///
  /// In en, this message translates to:
  /// **'Agent default'**
  String get composerAgentDefault;

  /// composeruse — Accepts the typed model in the free-text picker.
  ///
  /// In en, this message translates to:
  /// **'Use'**
  String get composerUse;

  /// composeragentbare — The Agent chip before the harness list arrives.
  ///
  /// In en, this message translates to:
  /// **'Agent'**
  String get composerAgentBare;

  /// composermodelvalue — The Model chip: category and current value.
  ///
  /// In en, this message translates to:
  /// **'Model: {value}'**
  String composerModelValue(String value);

  /// composermodevalue — The Mode chip: category and current value.
  ///
  /// In en, this message translates to:
  /// **'Mode: {value}'**
  String composerModeValue(String value);

  /// composerthinkingvalue — The Thinking chip: category and current value.
  ///
  /// In en, this message translates to:
  /// **'Thinking: {value}'**
  String composerThinkingValue(String value);

  /// projectlistsearchhint — Reused from desktop sidebar.search.placeholder
  ///
  /// In en, this message translates to:
  /// **'Search tasks, repos, paths'**
  String get projectListSearchHint;

  /// projectlistremoveconfirm — Reused from desktop sidebar.project.remove.cta
  ///
  /// In en, this message translates to:
  /// **'Remove project'**
  String get projectListRemoveConfirm;

  /// projectlistnewtaskin — Reused from desktop palette.newTask.title
  ///
  /// In en, this message translates to:
  /// **'New task in {project}'**
  String projectListNewTaskIn(Object project);

  /// newtasktitle — Reused from desktop sidebar.project.menu.newTask
  ///
  /// In en, this message translates to:
  /// **'New task'**
  String get newTaskTitle;

  /// newtasksubmitting — Reused from desktop settings.agents.row.adding
  ///
  /// In en, this message translates to:
  /// **'Adding…'**
  String get newTaskSubmitting;

  /// runremovetask — Reused from desktop task.remove
  ///
  /// In en, this message translates to:
  /// **'Remove task'**
  String get runRemoveTask;

  /// composerdefault — Reused from desktop task.composer.value.default
  ///
  /// In en, this message translates to:
  /// **'Default'**
  String get composerDefault;

  /// composermodesheet — Reused from desktop task.composer.agentMode.label
  ///
  /// In en, this message translates to:
  /// **'Mode'**
  String get composerModeSheet;

  /// composermodetooltip — Reused from desktop task.composer.agentMode.title
  ///
  /// In en, this message translates to:
  /// **'What the agent is allowed to do in this task'**
  String get composerModeTooltip;

  /// composermodelsheet — Reused from desktop task.composer.model.label
  ///
  /// In en, this message translates to:
  /// **'Model'**
  String get composerModelSheet;

  /// composermodeltooltip — Reused from desktop task.composer.model.title
  ///
  /// In en, this message translates to:
  /// **'Which model the agent uses for this task'**
  String get composerModelTooltip;

  /// composermodelhint — Reused from desktop task.composer.model.placeholder
  ///
  /// In en, this message translates to:
  /// **'provider/model'**
  String get composerModelHint;

  /// composerthinkingsheet — Reused from desktop task.composer.thinking.label
  ///
  /// In en, this message translates to:
  /// **'Thinking'**
  String get composerThinkingSheet;

  /// composerthinkingtooltip — Reused from desktop task.composer.thinking.title
  ///
  /// In en, this message translates to:
  /// **'How much the agent thinks before it answers'**
  String get composerThinkingTooltip;

  /// taskuntitled — A task the daemon gave no title.
  ///
  /// In en, this message translates to:
  /// **'Untitled task'**
  String get taskUntitled;

  /// projectunknown — Tasks whose project is not in the project list.
  ///
  /// In en, this message translates to:
  /// **'Unknown project'**
  String get projectUnknown;

  /// statusqueued — Task status: waiting to start.
  ///
  /// In en, this message translates to:
  /// **'Queued'**
  String get statusQueued;

  /// statusdone — Task status: finished successfully.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get statusDone;

  /// statusfailed — Task status: stopped with an error.
  ///
  /// In en, this message translates to:
  /// **'Failed'**
  String get statusFailed;

  /// statusunknown — Task status that is empty or unrecognised.
  ///
  /// In en, this message translates to:
  /// **'Unknown'**
  String get statusUnknown;

  /// statusneedsanswer — Reused from desktop status.needsAttention
  ///
  /// In en, this message translates to:
  /// **'Needs your answer'**
  String get statusNeedsAnswer;

  /// statusworking — Reused from desktop status.running
  ///
  /// In en, this message translates to:
  /// **'Working'**
  String get statusWorking;

  /// statusidle — Reused from desktop status.idle
  ///
  /// In en, this message translates to:
  /// **'Idle'**
  String get statusIdle;

  /// statusstopped — Reused from desktop status.cancelled
  ///
  /// In en, this message translates to:
  /// **'Stopped'**
  String get statusStopped;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) => <String>[
        'de',
        'en',
        'fr',
        'it',
        'ja',
        'ko',
        'zh'
      ].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'de':
      return AppLocalizationsDe();
    case 'en':
      return AppLocalizationsEn();
    case 'fr':
      return AppLocalizationsFr();
    case 'it':
      return AppLocalizationsIt();
    case 'ja':
      return AppLocalizationsJa();
    case 'ko':
      return AppLocalizationsKo();
    case 'zh':
      return AppLocalizationsZh();
  }

  throw FlutterError(
      'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
      'an issue with the localizations generation tool. Please file an issue '
      'on GitHub with a reproducible sample app and the gen-l10n configuration '
      'that was used.');
}
