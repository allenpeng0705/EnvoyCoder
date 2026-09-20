// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Italian (`it`).
class AppLocalizationsIt extends AppLocalizations {
  AppLocalizationsIt([String locale = 'it']) : super(locale);

  @override
  String get appName => 'EnvoyDev';

  @override
  String get commonAdd => 'Aggiungi';

  @override
  String get commonCancel => 'Annulla';

  @override
  String get commonClear => 'Cancella';

  @override
  String get commonConfirm => 'Conferma';

  @override
  String get commonContinue => 'Continua';

  @override
  String get commonNone => 'nessuno';

  @override
  String get commonNotSet => 'Non impostata';

  @override
  String get commonOk => 'Va bene';

  @override
  String get commonRemove => 'Rimuovi';

  @override
  String get commonRename => 'Rinomina';

  @override
  String get commonSave => 'Salva';

  @override
  String get commonSaving => 'Salvataggio…';

  @override
  String get connectionStateConnected => 'Connesso';

  @override
  String get connectionStateConnecting => 'Connessione…';

  @override
  String get connectionStateReconnecting =>
      'Riconnessione — le tue attività continuano a girare';

  @override
  String get connectionStateFailed => 'Irraggiungibile';

  @override
  String get connectionStateIdle => 'Non ancora connesso';

  @override
  String get connectionsTitle => 'Connessioni';

  @override
  String connectionsCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count computer',
      one: '1 computer',
    );
    return '$_temp0';
  }

  @override
  String get connectionsAddHost => 'Aggiungi host';

  @override
  String get connectionsAddHostSubtitle =>
      'Scansiona un codice o digita un indirizzo';

  @override
  String get connectionsEmpty => 'Nessun computer ancora abbinato.';

  @override
  String connectionsCurrent(String name) {
    return '$name · attuale';
  }

  @override
  String connectionsRowDetail(String endpoint, String state) {
    return '$endpoint — $state';
  }

  @override
  String connectionsRowDetailVia(String endpoint, String state, String route) {
    return '$endpoint — $state — tramite $route';
  }

  @override
  String get connectionsRenameTitle => 'Rinomina connessione';

  @override
  String get connectionsRenameField => 'Nome della connessione';

  @override
  String get connectionsRenameEmpty => 'Dai un nome a questa connessione.';

  @override
  String connectionsForgetTitle(String name) {
    return 'Dimenticare $name?';
  }

  @override
  String get connectionsForgetMessage =>
      'Questo telefono smetterà di connettersi a quel computer e dimenticherà l\'abbinamento. Le attività già in corso lì continuano a girare.';

  @override
  String get connectionsForgetConfirm => 'Dimentica';

  @override
  String connectionsMenuAria(String name) {
    return 'Altre azioni per $name';
  }

  @override
  String get connectionsMenuForget => 'Dimentica host';

  @override
  String get hostScanQr => 'Scansiona QR';

  @override
  String get hostScanQrSubtitle => 'Abbina con il codice sul tuo computer';

  @override
  String get hostPasteLink => 'Incolla link';

  @override
  String get hostPasteLinkSubtitle =>
      'Incolla il link di abbinamento da EnvoyDev';

  @override
  String get hostPasteLinkTitle => 'Incolla il link di abbinamento';

  @override
  String get hostPasteLinkHint => 'envoy://pair?…';

  @override
  String get hostDirectTcp => 'TCP diretto';

  @override
  String get hostDirectTcpSubtitle => 'Host, porta e token facoltativo';

  @override
  String get hostRemoteSsh => 'SSH remoto';

  @override
  String get hostRemoteSshSubtitle => 'Raggiungi il servizio con un salto SSH';

  @override
  String get hostFieldHostPort => 'Host:porta';

  @override
  String get hostFieldToken => 'Token (facoltativo se già abbinato)';

  @override
  String get hostFieldTokenHelper =>
      'Resta solo su questo telefono — non compare mai nell\'elenco.';

  @override
  String get hostFieldLabel => 'Etichetta (facoltativa)';

  @override
  String get hostFieldSshHost => 'Host SSH';

  @override
  String get hostFieldUser => 'Utente';

  @override
  String get hostFieldSshPort => 'Porta SSH';

  @override
  String get hostFieldPassword => 'Password SSH';

  @override
  String get hostFieldDaemon => 'Servizio remoto (host:porta)';

  @override
  String get hostFieldDaemonHelper =>
      'Di solito 127.0.0.1:4770 su quella macchina';

  @override
  String get hostFieldPairingToken =>
      'Token di abbinamento (facoltativo via SSH)';

  @override
  String get hostFieldPairingTokenHelper =>
      'Il tunnel arriva come la macchina stessa, quindi il servizio se ne fida';

  @override
  String get hostRefusedTitle => 'Non è stata aggiunta alcuna macchina';

  @override
  String get hostScanTitle => 'Scansiona il codice di abbinamento';

  @override
  String get hostScanHint => 'Inquadra il codice QR sul tuo computer.';

  @override
  String get hostNoHostsTitle => 'Nessun computer ancora abbinato';

  @override
  String get hostNoHostsBody =>
      'Sul tuo computer, apri EnvoyDev → Abbina un telefono, poi scansiona il codice. I tuoi agenti continuano a girare, che il telefono sia connesso o no.';

  @override
  String get errorPairingEmpty => 'Il codice di abbinamento è vuoto.';

  @override
  String get errorPairingMalformed => 'Non sembra un codice di abbinamento.';

  @override
  String get errorPairingUnreadable =>
      'Impossibile leggere il codice di abbinamento. Chiedi al computer di mostrarlo di nuovo.';

  @override
  String get errorPairingAddress =>
      'Il codice di abbinamento contiene un indirizzo che questa app non sa leggere.';

  @override
  String get errorPairingOtherApp => 'Quel codice è per un\'altra app';

  @override
  String get errorAddHostNotHostPort =>
      'Non è un host e una porta. Scrivilo come “machine:4770” — l\'indirizzo e la porta su cui ascolta il servizio.';

  @override
  String get errorAddHostNeedsToken =>
      'EnvoyDev rifiuta chiunque non sia sulla macchina stessa, quindi questa rotta richiede il token da un link di abbinamento. Usa Scansiona QR o Incolla link, oppure incolla qui anche il token.';

  @override
  String get errorAddHostSshHost =>
      'Attraverso quale macchina deve passare il tunnel? Digita il suo host SSH.';

  @override
  String get errorAddHostSshPort =>
      'La porta SSH deve essere un numero tra 1 e 65535. Per impostazione predefinita è 22.';

  @override
  String get errorAddHostDaemon =>
      'Il servizio su quella macchina si indica come “host:porta”. Scrivilo come “127.0.0.1:4770” — è così quasi per ogni macchina, ed è l\'indirizzo visto *da* quella macchina.';

  @override
  String get pairingNameTitle => 'Dai un nome a questa connessione';

  @override
  String get pairingNameField => 'Nome della connessione';

  @override
  String get pairingNameHelper =>
      'Compare nell\'elenco Connessioni — anche l\'indirizzo viene conservato.';

  @override
  String nameTooLong(int count) {
    return 'Massimo $count caratteri.';
  }

  @override
  String get settingsTitle => 'Impostazioni';

  @override
  String get settingsLoadFailed => 'Impossibile caricare le impostazioni.';

  @override
  String get settingsSaveFailed => 'Impossibile salvare le impostazioni.';

  @override
  String get settingsSaveNoModel =>
      'Impostazioni salvate. Inserisci un modello per salvare le impostazioni LLM.';

  @override
  String get settingsSavedOnComputer => 'Impostazioni salvate sul computer.';

  @override
  String get settingsSavedLlmFailed =>
      'Impostazioni salvate, ma non quelle LLM.';

  @override
  String get settingsComputerHeading => 'Sul computer';

  @override
  String get settingsComputerDetail =>
      'Queste impostazioni vivono sulla macchina abbinata. Il telefono si limita a modificarle.';

  @override
  String get settingsApprovals =>
      'Chiedi prima di qualsiasi azione distruttiva';

  @override
  String get settingsTranscripts =>
      'Conserva le trascrizioni dopo la fine di un\'attività';

  @override
  String get settingsLanguage => 'Lingua';

  @override
  String get settingsLanguageSystem => 'Come il telefono';

  @override
  String get settingsDefaultAgent =>
      'L\'agente con cui partono le nuove attività';

  @override
  String get settingsLlmHeading => 'LLM';

  @override
  String get settingsLlmDetail =>
      'URL di base, modello e chiave API per Envoy Harness.';

  @override
  String get settingsBaseUrl => 'URL di base';

  @override
  String get settingsBaseUrlHint =>
      'Opzionale — lascia vuoto per l\'indirizzo del fornitore';

  @override
  String get settingsModel => 'Modello';

  @override
  String get settingsModelHint => 'gpt-4o or anthropic/claude-sonnet-4-5';

  @override
  String get settingsApiKeySaved => 'Chiave API salvata su questa macchina.';

  @override
  String get settingsApiKey => 'Chiave API';

  @override
  String get settingsApiKeyHint =>
      'Incolla una nuova chiave per sostituire quella salvata';

  @override
  String get settingsLanguageDaemonFailed =>
      'Ora il telefono è in questa lingua, ma il computer non è stato aggiornato.';

  @override
  String get networkTitle => 'Stato della rete';

  @override
  String get networkCheckAgain => 'Controlla di nuovo';

  @override
  String get networkCopyReport => 'Copia il rapporto';

  @override
  String get networkCopied =>
      'Rapporto di rete copiato — incollalo nella segnalazione di bug.';

  @override
  String get networkTokenNote =>
      'Il token di abbinamento non viene mai mostrato qui — è una credenziale.';

  @override
  String get networkComputer => 'Macchina';

  @override
  String get networkActiveRoute => 'Rotta attiva';

  @override
  String get networkApp => 'App abbinata';

  @override
  String get networkPairingHeading => 'Cosa ci ha dato l\'abbinamento';

  @override
  String get networkDesktopPeerId => 'Id peer del desktop';

  @override
  String get networkDialablePeers => 'Indirizzi peer raggiungibili';

  @override
  String get networkPairingMissing =>
      'Servono entrambi per la rotta peer-to-peer, quindi questo host non ne ha nessuno. Un abbinamento fatto prima che il desktop portasse questi campi non ha né l\'uno né l\'altro — al telefono restano l\'indirizzo diretto e il relay.';

  @override
  String get networkLadderHeading => 'Come è stato provato questo computer';

  @override
  String get networkLadderNoCandidatesYet =>
      'Ancora nessun candidato — per questo computer non è stata tentata alcuna connessione.';

  @override
  String get networkLadderNoCandidates =>
      'Questo passaggio non ha prodotto candidati: la ricerca è trattenuta per la pressione delle connessioni, oppure l\'abbinamento non indica alcun indirizzo.';

  @override
  String networkLadderLimit(int limit, int waiting, int total) {
    return 'Questo passaggio contatta al massimo $limit: $waiting di $total aspettano il passaggio successivo.';
  }

  @override
  String get networkAttemptConnected => 'connesso';

  @override
  String get networkAttemptFailed => 'fallito';

  @override
  String get networkAttemptNoAnswer => 'nessuna risposta';

  @override
  String get networkAttemptDialling => 'connessione in corso';

  @override
  String get networkAttemptNotTried => 'non provato';

  @override
  String get networkAttemptPlanned => 'pianificato';

  @override
  String get networkLastRequestHeading => 'Ultima richiesta al desktop';

  @override
  String get networkNothingAsked =>
      'Da quando l\'app è partita non è stato chiesto ancora nulla.';

  @override
  String get networkMethod => 'Metodo';

  @override
  String get networkOutcome => 'Esito';

  @override
  String get networkAnswered => 'risposto';

  @override
  String get networkTook => 'Durata';

  @override
  String get networkLastWalk => 'Ultima ricerca';

  @override
  String get networkPhoneNodeHeading => 'Il nodo libp2p di questo telefono';

  @override
  String get networkNodeNotStarted =>
      'Non avviato — in questa sessione non è stata contattata alcuna rotta peer-to-peer. Parte alla prima connessione di quel tipo, e guardare questa schermata non lo avvia.';

  @override
  String get networkPeerId => 'Id peer';

  @override
  String get networkStarting => 'in avvio';

  @override
  String get networkRelayDialling => 'Connessione relay';

  @override
  String get networkEnabled => 'abilitato';

  @override
  String get networkDisabled => 'disabilitato';

  @override
  String get networkRelayReservation => 'Prenotazione relay';

  @override
  String get networkConnectedPeers => 'Peer connessi';

  @override
  String get networkConnectedPeersUnavailable =>
      'non disponibile — il nodo condiviso non espone una vista delle connessioni';

  @override
  String get networkLanPeers => 'Peer LAN visti';

  @override
  String get networkMdns => 'mDNS';

  @override
  String get networkActive => 'attivo';

  @override
  String get networkInactive => 'inattivo';

  @override
  String get networkRegisteredProtocols => 'Protocolli registrati';

  @override
  String get networkHostGeneration => 'Generazione host';

  @override
  String get networkDesktopMeshHeading => 'Cosa dice il desktop di sé';

  @override
  String get networkNotAsked =>
      'Non ancora chiesto. “Controlla di nuovo” chiede al desktop il suo stato della mesh — la differenza tra “questo telefono non lo raggiunge” e “non ha nulla da raggiungere”.';

  @override
  String networkNoUsableAnswer(String reason) {
    return 'Nessuna risposta utilizzabile: $reason';
  }

  @override
  String get networkUnreadable => 'illeggibile';

  @override
  String get networkState => 'Stato';

  @override
  String get networkItsPeerId => 'Il suo id peer';

  @override
  String get networkItsDialable => 'I suoi indirizzi raggiungibili';

  @override
  String get networkItsRelayHints => 'I suoi suggerimenti relay';

  @override
  String get networkPeersConnected => 'Peer a cui è connesso';

  @override
  String get networkItsReason => 'Il suo motivo';

  @override
  String get explorerTitle => 'Esplora file';

  @override
  String get explorerFiles => 'File';

  @override
  String get explorerChanges => 'Modifiche';

  @override
  String get explorerFolderEmpty => 'Questa cartella è vuota.';

  @override
  String get explorerCouldNotList => 'Impossibile elencare questa cartella.';

  @override
  String get explorerNotRepo => 'Questa cartella non è un repository Git.';

  @override
  String get explorerNoChanges => 'Nessuna modifica in questa cartella.';

  @override
  String get explorerCouldNotRead => 'Impossibile leggere le modifiche.';

  @override
  String get explorerKindAdded => 'Aggiunto';

  @override
  String get explorerKindModified => 'Modificato';

  @override
  String get explorerKindDeleted => 'Eliminato';

  @override
  String get explorerKindRenamed => 'Rinominato';

  @override
  String get explorerKindNew => 'Nuovo';

  @override
  String get explorerKindConflict => 'Conflitto';

  @override
  String get folderTitle => 'Scegli una cartella di progetto';

  @override
  String get folderUseThisFolder => 'Usa questa cartella';

  @override
  String get folderComputer => 'Questo computer';

  @override
  String get folderDrives => 'Unità';

  @override
  String get folderHome => 'Cartella home';

  @override
  String get folderParent => 'Cartella superiore';

  @override
  String get folderEmpty => 'Nessuna sottocartella qui';

  @override
  String get runStop => 'Ferma';

  @override
  String get runStopping => 'Arresto…';

  @override
  String get runLive => 'In corso';

  @override
  String get runToggleExplorer => 'Mostra o nascondi l’esplora file';

  @override
  String get runCouldNotAnswer =>
      'Impossibile inviare quella risposta. Riprova.';

  @override
  String get runCouldNotUpdateTask =>
      'Impossibile aggiornare l\'attività sul computer.';

  @override
  String get runCouldNotSend => 'Impossibile inviare. Riprova.';

  @override
  String get runCouldNotStop => 'Impossibile fermare l\'esecuzione. Riprova.';

  @override
  String get runNoFolder => 'Questa attività non ha ancora una cartella.';

  @override
  String get runCouldNotOpen => 'Impossibile aprire questa esecuzione.';

  @override
  String get runEarlierNotHere =>
      'La conversazione precedente non è su questo computer. Un nuovo messaggio parte comunque da qui.';

  @override
  String get runHistoryGap =>
      'Una parte della cronologia di questa attività non è arrivata. Ciò che c\'è è in ordine.';

  @override
  String get runQueue => 'Coda';

  @override
  String get runSteer => 'Orienta';

  @override
  String get runJoinsTurn => 'Si inserisce subito nel turno';

  @override
  String get runWaitsTurn => 'Attende la fine di questo turno';

  @override
  String get runPlaceholderAnswer => 'Rispondi prima alla richiesta qui sopra';

  @override
  String get runPlaceholderFollowUp => 'Aggiungi un seguito…';

  @override
  String get runPlaceholderContinue => 'Invia un messaggio per continuare';

  @override
  String get runYou => 'Tu';

  @override
  String get runYouSteered => 'Tu · ti sei inserito nel turno';

  @override
  String get runYouQueued => 'Tu · hai atteso il turno';

  @override
  String get runThoughtTitle => 'Come ci ha riflettuto';

  @override
  String get runAnswered => 'Risposto';

  @override
  String runAnsweredWith(String option) {
    return 'Risposto: $option';
  }

  @override
  String get runNeedsAnswer => 'L\'agente attende la tua risposta';

  @override
  String approvalQuestionTool(String tool) {
    return 'Consentire all\'agente di eseguire «$tool»?';
  }

  @override
  String get approvalQuestionGeneric => 'Consentire all\'agente di proseguire?';

  @override
  String get approvalQuestionAsk => 'L\'agente ha fatto una domanda.';

  @override
  String get approvalDetail =>
      'Si è fermato prima di questo passo e non proseguirà finché non rispondi. Autorizzarlo fa ripetere lo stesso passo in questo progetto senza chiedere di nuovo.';

  @override
  String get approvalDetailPick =>
      'Scegline una. Questa risposta vale solo per questa domanda.';

  @override
  String get approvalDetailMultiple =>
      'Seleziona ogni opzione che vale, poi conferma. Questa risposta vale solo per questa domanda.';

  @override
  String get approvalDetailText =>
      'Scrivi la risposta. L\'agente non prosegue finché non la invii.';

  @override
  String get approvalAllow => 'Consenti';

  @override
  String get approvalDeny => 'Non consentire';

  @override
  String get runApprovalNeedsDecision => 'L\'agente attende una decisione.';

  @override
  String get runNoLongerWaiting => 'Non è più in attesa.';

  @override
  String get runYourAnswer => 'La tua risposta';

  @override
  String get runToolFallback => 'strumento';

  @override
  String runNoteDiff(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count file modificati.',
      one: '1 file modificato.',
    );
    return '$_temp0';
  }

  @override
  String runNoteContext(int percent) {
    return 'Contesto pieno al $percent%.';
  }

  @override
  String get runNoteFinished => 'Completato.';

  @override
  String get runNoteStopped => 'Fermato.';

  @override
  String get runNoteStoppedBefore => 'Fermato prima di finire.';

  @override
  String get runNoteEnded => 'Concluso.';

  @override
  String get attachAdd => 'Aggiungi immagine';

  @override
  String get attachTooltip => 'Allega';

  @override
  String get attachPaste => 'Incolla immagine';

  @override
  String get attachFile => 'Aggiungi file';

  @override
  String attachRemove(String name) {
    return 'Rimuovi $name';
  }

  @override
  String get attachTooBig => 'Questo file è troppo grande per essere allegato.';

  @override
  String get attachBinary =>
      'Si possono allegare solo immagini e file di testo.';

  @override
  String get attachUnreadable => 'Impossibile leggere questo file.';

  @override
  String get attachEmpty => 'Questo file è vuoto.';

  @override
  String attachLimit(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Puoi allegare al massimo $count file.',
      one: 'Puoi allegare 1 file.',
    );
    return '$_temp0';
  }

  @override
  String get attachClipboardMissing => 'Nessuna immagine negli appunti.';

  @override
  String get attachFailed => 'Impossibile allegare il file.';

  @override
  String get attachImagesOnly => 'Guarda l\'immagine allegata.';

  @override
  String get attachImagesOnlyMany => 'Guarda le immagini allegate.';

  @override
  String attachNamed(String names) {
    return 'Allegato: $names';
  }

  @override
  String get addProjectTitle => 'Aggiungi progetto';

  @override
  String get addProjectDetail =>
      'Scegli una cartella su questo computer. Gli agenti gireranno al suo interno.';

  @override
  String get addProjectFolder => 'Cartella';

  @override
  String get addProjectFolderHint => '/Users/you/work/repo';

  @override
  String get addProjectBrowse => 'Scegli…';

  @override
  String get addProjectDefaultAgent => 'Agente predefinito';

  @override
  String get addProjectChooseFolder =>
      'Scegli una cartella su questo computer.';

  @override
  String get addProjectSubmit => 'Aggiungi progetto';

  @override
  String get markdownMermaid =>
      'Diagramma Mermaid — qui è mostrata la sorgente; il computer disegna il grafico nell\'app desktop.';

  @override
  String get markdownCopy => 'Copia';

  @override
  String get markdownCopied => 'Copiato';

  @override
  String projectListAttention(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count attività ti aspettano',
      one: '1 attività ti aspetta',
    );
    return '$_temp0';
  }

  @override
  String get projectListNoProjects =>
      'Ancora nessun progetto — aggiungi una cartella su questo computer.';

  @override
  String get projectListNoMatch => 'Nessuna corrispondenza con quella ricerca.';

  @override
  String projectListCouldNotLoad(String detail) {
    return 'Impossibile leggere il lavoro da questo computer. $detail';
  }

  @override
  String get commonConnectionFailed => 'La connessione non è riuscita.';

  @override
  String get projectListCouldNotChangeAgent =>
      'Impossibile cambiare l\'agente del progetto.';

  @override
  String projectListRemoveTitle(String project) {
    return 'Rimuovere “$project”?';
  }

  @override
  String get projectListRemoveMessage =>
      'Il progetto lascia EnvoyDev e le sue attività lasciano l\'elenco — vengono archiviate, non eliminate, e nella cartella non viene toccato nulla. La rimozione del progetto non può essere annullata.';

  @override
  String projectListRemoveFailed(String project) {
    return 'Impossibile rimuovere $project. È ancora nell\'elenco.';
  }

  @override
  String projectListRemoved(String project) {
    return 'Rimosso $project.';
  }

  @override
  String projectListRemovedArchived(String project, int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count attività sono state archiviate.',
      one: '1 attività è stata archiviata.',
    );
    return 'Rimosso $project. $_temp0';
  }

  @override
  String taskRemoveTitle(String title) {
    return 'Rimuovere “$title”?';
  }

  @override
  String get taskRemoveMessage =>
      'Lascia l\'elenco delle attività. La cartella, i suoi file e la trascrizione restano su questo computer — archiviare non è eliminare.';

  @override
  String projectListRemoveTaskFailed(String title) {
    return 'Impossibile rimuovere $title. È ancora nell\'elenco.';
  }

  @override
  String get runCouldNotRemove =>
      'Impossibile rimuovere questa attività. È ancora qui.';

  @override
  String get projectListRenameTaskTitle => 'Rinomina attività';

  @override
  String get projectListRenameTaskField => 'Nome dell\'attività';

  @override
  String get projectListRenameTaskEmpty =>
      'Inserisci un nome per questa attività.';

  @override
  String projectListRenameTaskFailed(String title) {
    return 'Impossibile rinominare $title. Il nome non è cambiato.';
  }

  @override
  String projectListNetworkStatusFor(String host, String state) {
    return 'Stato della rete per $host — $state';
  }

  @override
  String projectListSwitchConnection(String host) {
    return 'Cambia connessione — attuale: $host';
  }

  @override
  String get projectListNoTasks => 'Ancora nessuna attività in questo progetto';

  @override
  String projectListAgentFor(String project) {
    return 'Agente per $project';
  }

  @override
  String get projectListChangeAgent => 'Cambia agente';

  @override
  String get newTaskNoProjects =>
      'Aggiungi prima un progetto sul computer, poi riprova.';

  @override
  String get newTaskProjectLabel => 'Progetto';

  @override
  String get newTaskPromptHint => 'Descrivi l\'attività';

  @override
  String newTaskCouldNotStart(String detail) {
    return 'Impossibile avviare l\'attività. $detail';
  }

  @override
  String get composerAgentDefault => 'Predefinito dell\'agente';

  @override
  String get composerUse => 'Usa';

  @override
  String get composerAgentBare => 'Agente';

  @override
  String composerModelValue(String value) {
    return 'Modello: $value';
  }

  @override
  String composerModeValue(String value) {
    return 'Modalità: $value';
  }

  @override
  String composerThinkingValue(String value) {
    return 'Ragionamento: $value';
  }

  @override
  String get projectListSearchHint => 'Cerca attività, repository, percorsi';

  @override
  String get projectListRemoveConfirm => 'Rimuovi progetto';

  @override
  String projectListNewTaskIn(Object project) {
    return 'Nuova attività in $project';
  }

  @override
  String get newTaskTitle => 'Nuova attività';

  @override
  String get newTaskSubmitting => 'Aggiunta…';

  @override
  String get runRemoveTask => 'Rimuovi attività';

  @override
  String get composerDefault => 'Predefinito';

  @override
  String get composerModeSheet => 'Modalità';

  @override
  String get composerModeTooltip =>
      'Che cosa l\'agente può fare in questa attività';

  @override
  String get composerModelSheet => 'Modello';

  @override
  String get composerModelTooltip =>
      'Quale modello usa l\'agente per questa attività';

  @override
  String get composerModelHint => 'fornitore/modello';

  @override
  String get composerThinkingSheet => 'Ragionamento';

  @override
  String get composerThinkingTooltip =>
      'Quanto l\'agente ragiona prima di rispondere';

  @override
  String get taskUntitled => 'Attività senza titolo';

  @override
  String get projectUnknown => 'Progetto sconosciuto';

  @override
  String get statusQueued => 'In coda';

  @override
  String get statusDone => 'Completato';

  @override
  String get statusFailed => 'Non riuscito';

  @override
  String get statusUnknown => 'Sconosciuto';

  @override
  String get statusNeedsAnswer => 'Attende la tua risposta';

  @override
  String get statusWorking => 'In esecuzione';

  @override
  String get statusIdle => 'Inattivo';

  @override
  String get statusStopped => 'Fermato';
}
