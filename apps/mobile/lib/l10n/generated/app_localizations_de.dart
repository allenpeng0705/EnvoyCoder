// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for German (`de`).
class AppLocalizationsDe extends AppLocalizations {
  AppLocalizationsDe([String locale = 'de']) : super(locale);

  @override
  String get appName => 'EnvoyDev';

  @override
  String get commonAdd => 'Hinzufügen';

  @override
  String get commonCancel => 'Abbrechen';

  @override
  String get commonClear => 'Löschen';

  @override
  String get commonConfirm => 'Bestätigen';

  @override
  String get commonContinue => 'Weiter';

  @override
  String get commonNone => 'Keine';

  @override
  String get commonNotSet => 'Nicht gesetzt';

  @override
  String get commonOk => 'Verstanden';

  @override
  String get commonRemove => 'Entfernen';

  @override
  String get commonRename => 'Umbenennen';

  @override
  String get commonSave => 'Speichern';

  @override
  String get commonSaving => 'Speichert…';

  @override
  String get connectionStateConnected => 'Verbunden';

  @override
  String get connectionStateConnecting => 'Verbindet…';

  @override
  String get connectionStateReconnecting =>
      'Neuverbindung — deine Aufgaben laufen weiter';

  @override
  String get connectionStateFailed => 'Nicht erreichbar';

  @override
  String get connectionStateIdle => 'Noch nicht verbunden';

  @override
  String get connectionsTitle => 'Verbindungen';

  @override
  String connectionsCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count Rechner',
      one: '1 Rechner',
    );
    return '$_temp0';
  }

  @override
  String get connectionsAddHost => 'Host hinzufügen';

  @override
  String get connectionsAddHostSubtitle => 'Code scannen oder Adresse eingeben';

  @override
  String get connectionsEmpty => 'Noch kein Rechner gekoppelt.';

  @override
  String get connectionsPairingRefused =>
      'Dieser Rechner hat die Kopplung dieses Telefons abgelehnt';

  @override
  String connectionsPairingRefusedDetail(Object name) {
    return 'Erneut mit $name koppeln. Dieser Rechner akzeptiert die Kopplung dieses Telefons nicht mehr.';
  }

  @override
  String get connectionsPairingRePair => 'Erneut koppeln';

  @override
  String connectionsCurrent(String name) {
    return '$name · aktuell';
  }

  @override
  String connectionsRowDetail(String endpoint, String state) {
    return '$state · $endpoint';
  }

  @override
  String connectionsRowDetailVia(String endpoint, String state, String route) {
    return '$state · $endpoint · über $route';
  }

  @override
  String get connectionsRenameTitle => 'Verbindung umbenennen';

  @override
  String get connectionsRenameField => 'Name der Verbindung';

  @override
  String get connectionsRenameEmpty => 'Gib dieser Verbindung einen Namen.';

  @override
  String connectionsForgetTitle(String name) {
    return '$name vergessen?';
  }

  @override
  String get connectionsForgetMessage =>
      'Dieses Telefon verbindet sich nicht mehr mit diesem Rechner und vergisst die Kopplung. Aufgaben, die dort laufen, laufen weiter.';

  @override
  String get connectionsForgetConfirm => 'Verwerfen';

  @override
  String connectionsMenuAria(String name) {
    return 'Weitere Aktionen für $name';
  }

  @override
  String get connectionsMenuForget => 'Host vergessen';

  @override
  String get hostScanQr => 'QR scannen';

  @override
  String get hostScanQrSubtitle => 'Mit dem Code auf deinem Rechner koppeln';

  @override
  String get hostPasteLink => 'Link einfügen';

  @override
  String get hostPasteLinkSubtitle => 'Den Kopplungslink aus EnvoyDev einfügen';

  @override
  String get hostPasteLinkTitle => 'Kopplungslink einfügen';

  @override
  String get hostPasteLinkHint => 'envoy://pair?…';

  @override
  String get hostDirectTcp => 'Direktes TCP';

  @override
  String get hostDirectTcpSubtitle => 'Host, Port und optionales Token';

  @override
  String get hostRemoteSsh => 'SSH';

  @override
  String get hostRemoteSshSubtitle => 'Dienst über einen SSH-Sprung erreichen';

  @override
  String get hostFieldHostPort => 'Host:Port';

  @override
  String get hostFieldToken => 'Token (optional, wenn bereits gekoppelt)';

  @override
  String get hostFieldTokenHelper =>
      'Bleibt nur auf diesem Telefon — wird nie in der Liste gezeigt.';

  @override
  String get hostFieldLabel => 'Bezeichnung (optional)';

  @override
  String get hostFieldSshHost => 'SSH-Host';

  @override
  String get hostFieldUser => 'Benutzer';

  @override
  String get hostFieldSshPort => 'SSH-Port';

  @override
  String get hostFieldPassword => 'Passwort';

  @override
  String get hostFieldDaemon => 'Dienst-Adresse (Host:Port)';

  @override
  String get hostFieldDaemonHelper => 'Auf jenem Rechner meist 127.0.0.1:4770';

  @override
  String get hostFieldPairingToken => 'Kopplungstoken (über SSH optional)';

  @override
  String get hostFieldPairingTokenHelper =>
      'Der Tunnel kommt als der Rechner selbst an, deshalb wird ihm vertraut';

  @override
  String get hostRefusedTitle => 'Das hat keinen Rechner hinzugefügt';

  @override
  String get hostScanTitle => 'Kopplungscode scannen';

  @override
  String get hostScanHint =>
      'Halte die Kamera auf den QR-Code auf deinem Rechner.';

  @override
  String get hostNoHostsTitle => 'Noch kein Rechner gekoppelt';

  @override
  String get hostNoHostsBody =>
      'Öffne auf deinem Rechner EnvoyDev → Telefon koppeln und scanne dann den Code. Deine Agenten laufen weiter, ob das Telefon verbunden ist oder nicht.';

  @override
  String get errorPairingEmpty => 'Dieser Kopplungscode ist leer.';

  @override
  String get errorPairingMalformed =>
      'Das sieht nicht wie ein Kopplungscode aus.';

  @override
  String get errorPairingUnreadable =>
      'Dieser Kopplungscode konnte nicht gelesen werden. Lass ihn dir auf dem Rechner erneut anzeigen.';

  @override
  String get errorPairingAddress =>
      'Dieser Kopplungscode enthält eine Adresse, die diese App nicht lesen kann.';

  @override
  String get errorPairingOtherApp => 'Dieser Code ist für eine andere App';

  @override
  String get errorAddHostNotHostPort =>
      'Das ist kein Host und kein Port. Schreibe es als „rechner:4770“ — die Adresse und der Port, auf dem der Dienst lauscht.';

  @override
  String get errorAddHostNeedsToken =>
      'EnvoyDev weist jeden ab, der nicht an der Maschine selbst ist, deshalb braucht diese Route das Token aus einem Kopplungslink. Nutze QR scannen oder Link einfügen, oder füge das Token hier ebenfalls ein.';

  @override
  String get errorAddHostSshHost =>
      'Über welchen Rechner soll der Tunnel laufen? Gib seinen SSH-Host ein.';

  @override
  String get errorAddHostSshPort =>
      'Der SSH-Port muss eine Zahl zwischen 1 und 65535 sein. Standard ist 22.';

  @override
  String get errorAddHostDaemon =>
      'Der Dienst auf jenem Rechner wird als „host:port“ angegeben. Schreibe es als „127.0.0.1:4770“ — so ist es auf fast jedem Rechner, und es ist die Adresse, wie sie *von* dem Rechner aus gesehen wird.';

  @override
  String get pairingNameTitle => 'Diese Verbindung benennen';

  @override
  String get pairingNameField => 'Name der Verbindung';

  @override
  String get pairingNameHelper =>
      'Wird in der Liste „Verbindungen“ angezeigt — die Adresse bleibt ebenfalls erhalten.';

  @override
  String nameTooLong(int count) {
    return 'Höchstens $count Zeichen.';
  }

  @override
  String get settingsTitle => 'Einstellungen';

  @override
  String get settingsLoadFailed =>
      'Einstellungen konnten nicht geladen werden.';

  @override
  String get settingsSaveFailed =>
      'Einstellungen konnten nicht gespeichert werden.';

  @override
  String get settingsSaveNoModel =>
      'Einstellungen gespeichert. Gib ein Modell ein, um die LLM-Einstellungen zu speichern.';

  @override
  String get settingsSavedOnComputer =>
      'Einstellungen auf dem Rechner gespeichert.';

  @override
  String get settingsSavedLlmFailed =>
      'Einstellungen gespeichert, die LLM-Einstellungen jedoch nicht.';

  @override
  String get settingsComputerHeading => 'Auf dem Rechner';

  @override
  String get settingsComputerDetail =>
      'Diese Einstellungen liegen auf dem gekoppelten Rechner. Das Telefon ändert sie nur.';

  @override
  String get settingsPairingHeading => 'Kopplung';

  @override
  String settingsPairingPairedWith(Object name) {
    return 'Dieses Telefon ist mit $name gekoppelt.';
  }

  @override
  String get settingsPairingNotPaired =>
      'Dieses Telefon hat keine Kopplung für diesen Rechner. Scanne den Code auf dem Rechner, um erneut zu koppeln.';

  @override
  String get settingsPairingUnavailable =>
      'Dieses Telefon konnte seine gespeicherte Kopplung nicht lesen.';

  @override
  String get settingsPairingNotReached =>
      'Auf diesem Telefon noch nicht verbunden.';

  @override
  String settingsPairingMinutesAgo(num count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Vor $count Minuten verbunden',
      one: 'Vor 1 Minute verbunden',
    );
    return '$_temp0';
  }

  @override
  String settingsPairingHoursAgo(num count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Vor $count Stunden verbunden',
      one: 'Vor 1 Stunde verbunden',
    );
    return '$_temp0';
  }

  @override
  String get settingsPairingJustNow => 'Gerade eben verbunden';

  @override
  String get settingsPairingPhoneClock =>
      'Auf diesem Telefon vermerkt, nach der Uhr dieses Telefons.';

  @override
  String settingsPairingOnDate(Object date) {
    return 'Zuletzt verbunden am $date';
  }

  @override
  String get settingsApprovals => 'Vor allem Destruktiven fragen';

  @override
  String get settingsTranscripts =>
      'Transkripte nach dem Ende einer Aufgabe behalten';

  @override
  String get settingsLanguage => 'Sprache';

  @override
  String get settingsLanguageSystem => 'Wie dieses Telefon';

  @override
  String get settingsDefaultAgent => 'Der Agent, mit dem neue Aufgaben starten';

  @override
  String get settingsLlmHeading => 'LLM';

  @override
  String get settingsLlmDetail =>
      'Basis-URL, Modell und API-Schlüssel für Envoy Harness.';

  @override
  String get settingsBaseUrl => 'Basis-URL';

  @override
  String get settingsBaseUrlHint =>
      'Optional — leer lassen für die Vorgabe des Anbieters';

  @override
  String get settingsModel => 'Modell';

  @override
  String get settingsModelHint => 'gpt-4o or anthropic/claude-sonnet-4-5';

  @override
  String get settingsApiKeySaved =>
      'API-Schlüssel auf diesem Rechner gespeichert.';

  @override
  String get settingsApiKey => 'API-Schlüssel';

  @override
  String get settingsApiKeyHint =>
      'Neuen Schlüssel einfügen, um den gespeicherten zu ersetzen';

  @override
  String get settingsLanguageDaemonFailed =>
      'Das Telefon ist jetzt in dieser Sprache, der Rechner konnte aber nicht aktualisiert werden.';

  @override
  String get networkTitle => 'Netzwerkstatus';

  @override
  String get networkCheckAgain => 'Erneut prüfen';

  @override
  String get networkCopyReport => 'Bericht kopieren';

  @override
  String get networkCopied =>
      'Netzwerkbericht kopiert — füge ihn in den Fehlerbericht ein.';

  @override
  String get networkTokenNote =>
      'Das Kopplungstoken wird hier nie gezeigt — es ist ein Geheimnis.';

  @override
  String get networkComputer => 'Rechner';

  @override
  String get networkActiveRoute => 'Aktive Route';

  @override
  String get networkApp => 'Anwendung';

  @override
  String get networkPairingHeading => 'Was die Kopplung ergeben hat';

  @override
  String get networkDesktopPeerId => 'Peer-ID des Rechners';

  @override
  String get networkDialablePeers => 'Wählbare Peer-Adressen';

  @override
  String get networkPairingMissing =>
      'Beides wird für die Peer-to-Peer-Route gebraucht, deshalb hat dieser Host nichts davon. Eine Kopplung, die entstand, bevor der Rechner diese Felder trug, hat nichts davon — dem Telefon bleiben die direkte Adresse und das Relay.';

  @override
  String get networkLadderHeading => 'Wie dieser Rechner versucht wurde';

  @override
  String get networkLadderNoCandidatesYet =>
      'Noch keine Kandidaten — für diesen Rechner wurde noch nichts angewählt.';

  @override
  String get networkLadderNoCandidates =>
      'Dieser Durchlauf hat keine Kandidaten ergeben: Die Suche wird bei zu vielen gleichzeitigen Versuchen zurückgehalten, oder die Kopplung nennt gar keine Adresse.';

  @override
  String networkLadderLimit(int limit, int waiting, int total) {
    return 'Dieser Durchlauf wählt höchstens $limit: $waiting von $total warten auf den nächsten Durchlauf.';
  }

  @override
  String get networkAttemptConnected => 'verbunden';

  @override
  String get networkAttemptFailed => 'fehlgeschlagen';

  @override
  String get networkAttemptNoAnswer => 'keine Antwort';

  @override
  String get networkAttemptDialling => 'wird angewählt';

  @override
  String get networkAttemptNotTried => 'nicht versucht';

  @override
  String get networkAttemptPlanned => 'geplant';

  @override
  String get networkLastRequestHeading => 'Letzte Anfrage an den Rechner';

  @override
  String get networkNothingAsked =>
      'Seit dem Start der App wurde noch keine Anfrage gesendet.';

  @override
  String get networkMethod => 'Methode';

  @override
  String get networkOutcome => 'Ergebnis';

  @override
  String get networkAnswered => 'beantwortet';

  @override
  String get networkTook => 'Dauer';

  @override
  String get networkLastWalk => 'Letzter Durchlauf';

  @override
  String get networkPhoneNodeHeading => 'Der libp2p-Knoten dieses Telefons';

  @override
  String get networkNodeNotStarted =>
      'Nicht gestartet — in diesem Start wurde keine Peer-to-Peer-Route angewählt. Er startet beim ersten solchen Versuch, und ein Blick auf diesen Bildschirm startet ihn nicht.';

  @override
  String get networkPeerId => 'Peer-ID';

  @override
  String get networkStarting => 'startet';

  @override
  String get networkRelayDialling => 'Relay-Anwahl';

  @override
  String get networkEnabled => 'Ein';

  @override
  String get networkDisabled => 'Aus';

  @override
  String get networkRelayReservation => 'Relay-Reservierung';

  @override
  String get networkConnectedPeers => 'Verbundene Peers';

  @override
  String get networkConnectedPeersUnavailable =>
      'nicht verfügbar — der gemeinsame Knoten bietet keine Verbindungsansicht';

  @override
  String get networkLanPeers => 'Gesehene LAN-Peers';

  @override
  String get networkMdns => 'mDNS';

  @override
  String get networkActive => 'aktiv';

  @override
  String get networkInactive => 'inaktiv';

  @override
  String get networkRegisteredProtocols => 'Registrierte Protokolle';

  @override
  String get networkHostGeneration => 'Host-Generation';

  @override
  String get networkDesktopMeshHeading =>
      'Was der Rechner über sich selbst sagt';

  @override
  String get networkNotAsked =>
      'Noch nicht gefragt. „Erneut prüfen“ fragt den Rechner nach seinem eigenen Mesh-Status — der Unterschied zwischen „dieses Telefon erreicht ihn nicht“ und „er hat nichts zu erreichen“.';

  @override
  String networkNoUsableAnswer(String reason) {
    return 'Keine brauchbare Antwort: $reason';
  }

  @override
  String get networkUnreadable => 'nicht lesbar';

  @override
  String get networkState => 'Zustand';

  @override
  String get networkItsPeerId => 'Seine Peer-ID';

  @override
  String get networkItsDialable => 'Seine wählbaren Adressen';

  @override
  String get networkItsRelayHints => 'Seine Relay-Hinweise';

  @override
  String get networkPeersConnected => 'Peers, mit denen es verbunden ist';

  @override
  String get networkItsReason => 'Sein Grund';

  @override
  String get explorerTitle => 'Explorer';

  @override
  String get explorerFiles => 'Dateien';

  @override
  String get explorerChanges => 'Änderungen';

  @override
  String get explorerFolderEmpty => 'Dieser Ordner ist leer.';

  @override
  String get explorerCouldNotList =>
      'Dieser Ordner konnte nicht aufgelistet werden.';

  @override
  String get explorerNotRepo => 'Dieser Ordner ist kein Git-Repository.';

  @override
  String get explorerNoChanges => 'Keine Änderungen in diesem Ordner.';

  @override
  String get explorerCommitMessage => 'Commit-Nachricht';

  @override
  String get explorerCommitCta => 'Committen';

  @override
  String get explorerCommitStageAll => 'Alles bereitstellen';

  @override
  String explorerCommitDone(String sha) {
    return '$sha committet.';
  }

  @override
  String explorerStage(String path) {
    return '$path bereitstellen';
  }

  @override
  String explorerUnstage(String path) {
    return '$path zurücknehmen';
  }

  @override
  String get explorerCouldNotRead =>
      'Die Änderungen konnten nicht gelesen werden.';

  @override
  String get explorerKindAdded => 'Hinzugefügt';

  @override
  String get explorerKindModified => 'Geändert';

  @override
  String get explorerKindDeleted => 'Gelöscht';

  @override
  String get explorerKindRenamed => 'Umbenannt';

  @override
  String get explorerKindNew => 'Neu';

  @override
  String get explorerKindConflict => 'Konflikt';

  @override
  String get folderTitle => 'Projektordner wählen';

  @override
  String get folderUseThisFolder => 'Diesen Ordner verwenden';

  @override
  String get folderComputer => 'Rechner';

  @override
  String get folderDrives => 'Laufwerke';

  @override
  String get folderHome => 'Zuhause';

  @override
  String get folderParent => 'Übergeordneter Ordner';

  @override
  String get folderEmpty => 'Keine Unterordner hier';

  @override
  String get runStop => 'Stoppen';

  @override
  String get runStopping => 'Stoppt…';

  @override
  String get runLive => 'Läuft';

  @override
  String get runToggleExplorer => 'Explorer-Seitenleiste umschalten';

  @override
  String get runCouldNotAnswer =>
      'Die Antwort konnte nicht gesendet werden. Versuche es erneut.';

  @override
  String get runCouldNotUpdateTask =>
      'Die Aufgabe konnte auf dem Rechner nicht aktualisiert werden.';

  @override
  String get runCouldNotSend =>
      'Konnte nicht gesendet werden. Versuche es erneut.';

  @override
  String get runCouldNotStop =>
      'Der Lauf konnte nicht gestoppt werden. Versuche es erneut.';

  @override
  String get runNoFolder => 'Diese Aufgabe hat noch keinen Ordner.';

  @override
  String get runCouldNotOpen => 'Dieser Lauf konnte nicht geöffnet werden.';

  @override
  String get runEarlierNotHere =>
      'Der frühere Verlauf ist nicht auf diesem Rechner. Eine neue Nachricht startet trotzdem hier.';

  @override
  String get runHistoryGap =>
      'Ein Teil des Verlaufs dieser Aufgabe ist nicht angekommen. Was hier steht, ist in der richtigen Reihenfolge.';

  @override
  String get runQueue => 'Warteschlange';

  @override
  String get runSteer => 'Lenken';

  @override
  String get runJoinsTurn => 'Springt jetzt in den Durchgang';

  @override
  String get runWaitsTurn => 'Wartet auf das Ende dieses Durchgangs';

  @override
  String get runPlaceholderAnswer => 'Beantworte zuerst die Anfrage oben';

  @override
  String get runPlaceholderFollowUp => 'Ergänze etwas…';

  @override
  String get runPlaceholderContinue => 'Nachricht senden, um fortzufahren';

  @override
  String get runYou => 'Du';

  @override
  String get runYouSteered => 'Du · in den Durchgang gesprungen';

  @override
  String get runYouQueued => 'Du · wartete auf den Durchgang';

  @override
  String get runThoughtTitle => 'Wie es darüber nachgedacht hat';

  @override
  String get runAnswered => 'Beantwortet';

  @override
  String runAnsweredWith(String option) {
    return 'Beantwortet: $option';
  }

  @override
  String get runNeedsAnswer => 'Der Agent braucht deine Antwort';

  @override
  String approvalQuestionTool(String tool) {
    return 'Dem Agenten erlauben, „$tool“ auszuführen?';
  }

  @override
  String get approvalQuestionGeneric => 'Dem Agenten erlauben, fortzufahren?';

  @override
  String get approvalQuestionAsk => 'Der Agent hat eine Frage gestellt.';

  @override
  String get approvalDetail =>
      'Er hat vor diesem Schritt angehalten und macht erst weiter, wenn du antwortest. Erlaubst du ihn, läuft derselbe Schritt in diesem Projekt danach ohne Nachfrage.';

  @override
  String get approvalDetailPick =>
      'Wähle eine. Diese Antwort gilt nur für diese Frage.';

  @override
  String get approvalDetailMultiple =>
      'Wähle jede passende Option und bestätige. Diese Antwort gilt nur für diese Frage.';

  @override
  String get approvalDetailText =>
      'Schreib deine Antwort. Der Agent macht erst weiter, wenn du sie sendest.';

  @override
  String get approvalAllow => 'Erlauben';

  @override
  String get approvalDeny => 'Nicht erlauben';

  @override
  String get runApprovalNeedsDecision => 'Der Agent braucht eine Entscheidung.';

  @override
  String get runNoLongerWaiting => 'Wartet nicht mehr.';

  @override
  String get runYourAnswer => 'Deine Antwort';

  @override
  String get runToolFallback => 'Werkzeug';

  @override
  String runNoteDiff(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count Dateien geändert.',
      one: '1 Datei geändert.',
    );
    return '$_temp0';
  }

  @override
  String runNoteContext(int percent) {
    return 'Kontext zu $percent % voll.';
  }

  @override
  String get runNoteFinished => 'Fertig.';

  @override
  String get runNoteStopped => 'Gestoppt.';

  @override
  String get runNoteStoppedBefore => 'Gestoppt, bevor es fertig war.';

  @override
  String get runNoteEnded => 'Beendet.';

  @override
  String get attachAdd => 'Bild hinzufügen';

  @override
  String get attachTooltip => 'Anhängen';

  @override
  String get attachPaste => 'Bild einfügen';

  @override
  String get attachFile => 'Datei hinzufügen';

  @override
  String attachRemove(String name) {
    return '$name entfernen';
  }

  @override
  String get attachTooBig => 'Diese Datei ist zu groß zum Anhängen.';

  @override
  String get attachBinary =>
      'Nur Bilder und Textdateien können angehängt werden.';

  @override
  String get attachUnreadable => 'Diese Datei konnte nicht gelesen werden.';

  @override
  String get attachEmpty => 'Diese Datei ist leer.';

  @override
  String attachLimit(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Du kannst höchstens $count Dateien anhängen.',
      one: 'Du kannst 1 Datei anhängen.',
    );
    return '$_temp0';
  }

  @override
  String get attachClipboardMissing =>
      'Es war kein Bild in der Zwischenablage.';

  @override
  String get attachFailed => 'Diese Datei konnte nicht angehängt werden.';

  @override
  String get attachImagesOnly => 'Sieh dir das angehängte Bild an.';

  @override
  String get attachImagesOnlyMany => 'Sieh dir die angehängten Bilder an.';

  @override
  String attachNamed(String names) {
    return 'Angehängt: $names';
  }

  @override
  String get addProjectTitle => 'Projekt hinzufügen';

  @override
  String get addProjectDetail =>
      'Wähle einen Ordner auf diesem Rechner. Darin laufen die Agenten.';

  @override
  String get addProjectFolder => 'Ordner';

  @override
  String get addProjectFolderHint => '/Users/you/work/repo';

  @override
  String get addProjectBrowse => 'Auswählen…';

  @override
  String get addProjectDefaultAgent => 'Standard-Agent';

  @override
  String get addProjectChooseFolder => 'Wähle einen Ordner auf diesem Rechner.';

  @override
  String get addProjectSubmit => 'Projekt hinzufügen';

  @override
  String get markdownMermaid =>
      'Mermaid-Diagramm — hier wird die Quelle gezeigt; das Diagramm zeichnet der Rechner in der Desktop-App.';

  @override
  String get markdownCopy => 'Kopieren';

  @override
  String get markdownCopied => 'Kopiert';

  @override
  String projectListAttention(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count brauchen dich',
      one: '1 braucht dich',
    );
    return '$_temp0';
  }

  @override
  String get projectListNoProjects =>
      'Noch keine Projekte — füge einen Ordner auf diesem Rechner hinzu.';

  @override
  String get projectListNoMatch => 'Nichts passt zu dieser Suche.';

  @override
  String projectListCouldNotLoad(String detail) {
    return 'Die Projekte und Aufgaben konnten von diesem Rechner nicht geladen werden. $detail';
  }

  @override
  String get commonConnectionFailed => 'Die Verbindung ist fehlgeschlagen.';

  @override
  String get projectListCouldNotChangeAgent =>
      'Der Agent des Projekts konnte nicht geändert werden.';

  @override
  String projectListRemoveTitle(String project) {
    return '„$project“ entfernen?';
  }

  @override
  String get projectListRemoveMessage =>
      'Das Projekt verlässt EnvoyDev, seine Aufgaben verlassen die Liste — sie werden archiviert, nicht gelöscht, und in diesem Ordner wird nichts angefasst. Das Entfernen des Projekts lässt sich nicht rückgängig machen.';

  @override
  String projectListRemoveFailed(String project) {
    return '„$project“ konnte nicht entfernt werden. Es ist weiterhin in der Liste.';
  }

  @override
  String projectListRemoved(String project) {
    return '„$project“ entfernt.';
  }

  @override
  String projectListRemovedArchived(String project, int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count Aufgaben wurden archiviert.',
      one: '1 Aufgabe wurde archiviert.',
    );
    return '„$project“ entfernt. $_temp0';
  }

  @override
  String taskRemoveTitle(String title) {
    return '„$title“ entfernen?';
  }

  @override
  String get taskRemoveMessage =>
      'Die Aufgabe verlässt die Liste. Der Ordner, seine Dateien und das Transkript bleiben auf diesem Rechner — Archivieren ist kein Löschen.';

  @override
  String projectListRemoveTaskFailed(String title) {
    return '„$title“ konnte nicht entfernt werden. Sie ist noch in der Liste.';
  }

  @override
  String get runCouldNotRemove =>
      'Diese Aufgabe konnte nicht entfernt werden. Sie ist noch hier.';

  @override
  String get projectListRenameTaskTitle => 'Aufgabe umbenennen';

  @override
  String get projectListRenameTaskField => 'Name der Aufgabe';

  @override
  String get projectListRenameTaskEmpty => 'Gib dieser Aufgabe einen Namen.';

  @override
  String projectListRenameTaskFailed(String title) {
    return '„$title“ konnte nicht umbenannt werden. Der Name ist unverändert.';
  }

  @override
  String projectListNetworkStatusFor(String host, String state) {
    return 'Netzwerkstatus für $host — $state';
  }

  @override
  String projectListSwitchConnection(String host) {
    return 'Verbindung wechseln — aktuell: $host';
  }

  @override
  String get projectListNoTasks => 'Noch keine Aufgaben in diesem Projekt';

  @override
  String projectListAgentFor(String project) {
    return 'Agent für $project';
  }

  @override
  String get projectListChangeAgent => 'Agent ändern';

  @override
  String gitBranchesAria(String project) {
    return 'Branches für $project';
  }

  @override
  String get gitBranchesTitle => 'Branches';

  @override
  String gitBranchesChip(String branch) {
    return 'Branch: $branch';
  }

  @override
  String get gitBranchesDetachedChip => 'Kein Branch';

  @override
  String get gitBranchesDetached =>
      'Dieses Repository hat einen losgelösten HEAD, deshalb ist kein Branch aktuell.';

  @override
  String get gitBranchesEmpty => 'Dieses Repository hat noch keine Branches.';

  @override
  String get gitBranchesNew => 'Neuer Branch';

  @override
  String get gitBranchesName => 'Branch-Name';

  @override
  String get gitBranchesCreate => 'Anlegen und wechseln';

  @override
  String gitBranchesSwitched(String branch) {
    return 'Zu $branch gewechselt.';
  }

  @override
  String gitBranchesCreated(String branch) {
    return '$branch angelegt und dorthin gewechselt.';
  }

  @override
  String gitMergeInto(String branch, String current) {
    return '$branch in $current mergen';
  }

  @override
  String get gitMergeCta => 'Merge';

  @override
  String gitMergeDone(String branch, String into) {
    return '$branch in $into gemergt.';
  }

  @override
  String get gitFetchCta => 'Fetch';

  @override
  String gitFetchDone(String summary) {
    return 'Gefetcht. $summary';
  }

  @override
  String get gitFetchNothing => 'Gefetcht. Nichts Neues.';

  @override
  String get gitPullCta => 'Pull';

  @override
  String gitPullDone(String summary) {
    return 'Gepullt. $summary';
  }

  @override
  String get gitPullNothing => 'Gepullt. Schon aktuell.';

  @override
  String errorGitMergeConflict(String branch, String files) {
    return '$branch kann nicht automatisch gemergt werden. Diese Dateien stehen im Konflikt: $files. Es wurde nichts geändert — dein Branch und dein Arbeitsverzeichnis sind genau wie vorher.';
  }

  @override
  String get errorGitPullDiverged =>
      'Der Branch auf dem Rechner und der auf dem Remote haben sich beide geändert, ein Pull kann sie also nicht zusammenbringen. Merge sie, oder pushe deinen Branch.';

  @override
  String get gitStashTitle => 'Stashes';

  @override
  String get gitStashCta => 'Beiseitelegen';

  @override
  String get gitStashDone => 'Beiseitegelegt.';

  @override
  String get gitStashPop => 'Zurücklegen';

  @override
  String get gitStashDrop => 'Verwerfen';

  @override
  String get gitStashConfirm => 'Diesen Stash verwerfen?';

  @override
  String get errorGitNothingToStash =>
      'Es gibt nichts beiseitezulegen — in diesem Ordner hat keine Datei unversionierte Änderungen.';

  @override
  String get errorGitStashDirty =>
      'Ein Stash lässt sich nur auf einen sauberen Arbeitsbaum zurücklegen. Committe oder stashe zuerst die Änderungen in diesem Ordner.';

  @override
  String errorGitStashConflict(String files) {
    return 'Dieser Stash lässt sich nicht sauber zurücklegen. Diese Dateien stehen im Konflikt: $files. Es wurde nichts geändert, und der Stash ist noch da.';
  }

  @override
  String errorGitMergeUnresolved(String files) {
    return 'Ein Merge ist nicht abgeschlossen: In $files gibt es noch Konflikte. Löse sie und schließe den Merge ab, oder brich ihn ab.';
  }

  @override
  String get errorGitMergeNone =>
      'Es läuft kein Merge, also gibt es nichts abzuschließen oder abzubrechen.';

  @override
  String errorGitConflicted(String files) {
    return 'In diesem Repository gibt es ungelöste Konflikte in $files, aus einem Vorgang, den EnvoyDev nicht gestartet hat. Schließe ihn dort ab oder mache ihn dort rückgängig, bevor du hier etwas anderes tust.';
  }

  @override
  String errorGitMergeResolveFailed(String detail) {
    return 'Der Agent konnte nicht gestartet werden, deshalb wurde der Merge zurückgenommen und nichts hat sich geändert: $detail';
  }

  @override
  String get gitMergeStopped =>
      'Ein Merge ist mit Konflikten stehen geblieben.';

  @override
  String gitMergeStoppedFrom(String branch) {
    return 'Der Merge von $branch ist mit Konflikten stehen geblieben.';
  }

  @override
  String get gitMergeResolved =>
      'Alle Konflikte sind gelöst. Schließe den Merge ab, um ihn festzuhalten.';

  @override
  String get gitMergeResolve => 'Mit einem Agenten lösen';

  @override
  String get gitMergeFinish => 'Merge abschließen';

  @override
  String get gitMergeAbort => 'Merge abbrechen';

  @override
  String gitMergeResolving(String task) {
    return 'Ein Agent löst diesen Merge: $task.';
  }

  @override
  String get gitMergeAborted =>
      'Der Merge wurde abgebrochen, es wurde nichts gemergt.';

  @override
  String get gitMergeRecorded => 'Der Merge wurde festgehalten.';

  @override
  String get gitBranchesConflictsChip => 'Konflikte';

  @override
  String get newTaskNoProjects =>
      'Füge zuerst auf dem Rechner ein Projekt hinzu und versuche es dann erneut.';

  @override
  String get newTaskProjectLabel => 'Projekt';

  @override
  String get newTaskPromptHint => 'Beschreibe die Aufgabe';

  @override
  String newTaskCouldNotStart(String detail) {
    return 'Die Aufgabe konnte nicht gestartet werden. $detail';
  }

  @override
  String get composerAgentDefault => 'Standard des Agenten';

  @override
  String get composerUse => 'Verwenden';

  @override
  String get composerAgentBare => 'Agent';

  @override
  String composerModelValue(String value) {
    return 'Modell: $value';
  }

  @override
  String composerModeValue(String value) {
    return 'Modus: $value';
  }

  @override
  String composerThinkingValue(String value) {
    return 'Denken: $value';
  }

  @override
  String get projectListSearchHint => 'Aufgaben, Repos, Pfade durchsuchen';

  @override
  String get projectListRemoveConfirm => 'Projekt entfernen';

  @override
  String projectListNewTaskIn(Object project) {
    return 'Neue Aufgabe in $project';
  }

  @override
  String get newTaskTitle => 'Neue Aufgabe';

  @override
  String get newTaskSubmitting => 'Wird hinzugefügt…';

  @override
  String get runRemoveTask => 'Aufgabe entfernen';

  @override
  String get composerDefault => 'Standard';

  @override
  String get composerModeSheet => 'Modus';

  @override
  String get composerModeTooltip => 'Was der Agent in dieser Aufgabe tun darf';

  @override
  String get composerModelSheet => 'Modell';

  @override
  String get composerModelTooltip =>
      'Welches Modell der Agent für diese Aufgabe verwendet';

  @override
  String get composerModelHint => 'anbieter/modell';

  @override
  String get composerThinkingSheet => 'Denken';

  @override
  String get composerThinkingTooltip =>
      'Wie viel der Agent vor der Antwort nachdenkt';

  @override
  String get taskUntitled => 'Unbenannte Aufgabe';

  @override
  String get projectUnknown => 'Unbekanntes Projekt';

  @override
  String get statusQueued => 'In Warteschlange';

  @override
  String get statusDone => 'Fertig';

  @override
  String get statusFailed => 'Fehlgeschlagen';

  @override
  String get statusUnknown => 'Unbekannt';

  @override
  String get statusNeedsAnswer => 'Braucht deine Antwort';

  @override
  String get statusWorking => 'Läuft';

  @override
  String get statusIdle => 'Bereit';

  @override
  String get statusStopped => 'Gestoppt';
}
